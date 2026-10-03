import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool, createProject, LOCAL_OWNER_ID, enqueueTechnical,
  claimTechnicalJob, heartbeatTechnicalJob, failTechnicalJob } from '../packages/db/dist/index.js';
import { technicalConfig } from '../packages/media/dist/index.js';
import { migrate } from '../packages/db/dist/migrate.js';

test('Phase 0E migration repeats safely and installs only technical tables',async()=>{
  const pool=createDatabasePool();
  try{
    assert.equal(await migrate(pool),0);
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(row=>row.tablename);
    for(const name of ['artifacts','media_metadata','temporal_segments','representative_frames'])assert.ok(tables.includes(name));
    for(const name of ['transcripts','semantic_roles','storyboards','edls','best_takes'])assert.ok(!tables.includes(name));
    const migration=(await pool.query("SELECT count(*)::integer AS count FROM schema_migrations WHERE name='0004_phase_0e_technical.sql'")).rows[0];
    assert.equal(migration.count,1);
  }finally{await pool.end();}
});

test('technical jobs claim atomically, recover expired leases, and stop after bounded retries',
  {timeout:30000},async()=>{
    const pool=createDatabasePool();
    const config=technicalConfig();
    const project=await createProject(pool,'Technical job test');
    let assetId;
    try{
      assetId=(await pool.query(`INSERT INTO media_assets(project_id,original_filename,storage_path,media_type,file_size_bytes)
        VALUES($1,'missing.mp4','temporary/fixture.mp4','video/mp4',10) RETURNING id`,[project.id])).rows[0].id;
      const first=await enqueueTechnical(pool,project.id,assetId,config,'test-toolchain-v1');
      const duplicate=await enqueueTechnical(pool,project.id,assetId,config,'test-toolchain-v1');
      assert.equal(first.jobId,duplicate.jobId);
      const simultaneous=await Promise.all([claimTechnicalJob(pool,'test-a'),claimTechnicalJob(pool,'test-b')]);
      const claimed=simultaneous.filter(Boolean);
      assert.equal(claimed.length,1);
      assert.equal(claimed[0].id,first.jobId);
      assert.equal(claimed[0].attempt_count,1);
      assert.equal(await heartbeatTechnicalJob(pool,claimed[0]),true);
      await pool.query("UPDATE jobs SET locked_at=now()-interval '40 seconds',heartbeat_at=now()-interval '40 seconds',lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.jobId]);
      const recovered=await claimTechnicalJob(pool,'test-recovery');
      assert.equal(recovered?.id,first.jobId);
      assert.equal(recovered.attempt_count,2);
      assert.notEqual(recovered.lease_token,claimed[0].lease_token);
      assert.equal(await heartbeatTechnicalJob(pool,claimed[0]),false);
      await failTechnicalJob(pool,recovered,null,'missing_original');
      let state=(await pool.query('SELECT status,attempt_count,last_error FROM jobs WHERE id=$1',[first.jobId])).rows[0];
      assert.equal(state.status,'retry_wait');assert.equal(state.last_error,'missing_original');
      await pool.query('UPDATE jobs SET available_at=now() WHERE id=$1',[first.jobId]);
      const finalAttempt=await claimTechnicalJob(pool,'test-final');
      assert.equal(finalAttempt?.attempt_count,3);
      await failTechnicalJob(pool,finalAttempt,null,'missing_original');
      state=(await pool.query('SELECT status,attempt_count FROM jobs WHERE id=$1',[first.jobId])).rows[0];
      assert.deepEqual(state,{status:'failed',attempt_count:3});
      assert.equal((await pool.query('SELECT status,technical_error FROM media_assets WHERE id=$1',[assetId])).rows[0].technical_error,'missing_original');
      const retry=await enqueueTechnical(pool,project.id,assetId,config,'test-toolchain-v1');
      assert.equal(retry.jobId,first.jobId);
      const afterRetry=await claimTechnicalJob(pool,'test-user-retry');
      assert.equal(afterRetry?.attempt_count,1);
      await failTechnicalJob(pool,afterRetry,null,'missing_original');
      const upgraded=await enqueueTechnical(pool,project.id,assetId,config,'test-toolchain-v2');
      assert.notEqual(upgraded.jobId,first.jobId);
    }finally{
      if(assetId){
        await pool.query('DELETE FROM jobs WHERE media_asset_id=$1',[assetId]);
        await pool.query('DELETE FROM media_assets WHERE id=$1',[assetId]);
      }
      await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2',[project.id,LOCAL_OWNER_ID]);
      await pool.end();
    }
  });
