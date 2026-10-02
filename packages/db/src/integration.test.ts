import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool, type ProjectRow, type MediaAssetRow, type JobRow } from './index.js';
import { migrate } from './migrate.js';

test('Phase 0B migrations, relational integrity, and record round trips', async () => {
  const pool = createDatabasePool();
  try {
    await migrate(pool);
    assert.equal(await migrate(pool), 0, 'Repeat migrations are a no-op');
    const tables = await pool.query<{tablename: string}>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const table of ['projects','media_assets','jobs','analysis_runs','schema_migrations']) {
      assert.ok(tables.rows.some(row => row.tablename === table), `Missing table ${table}`);
    }
    const indexes = await pool.query<{indexname: string}>("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    for (const index of ['projects_owner_idx','media_assets_project_idx','jobs_project_idx','jobs_media_idx',
      'jobs_claim_idx','jobs_lease_idx','jobs_idempotency_idx','analysis_runs_project_idx','analysis_runs_cache_idx']) {
      assert.ok(indexes.rows.some(row => row.indexname === index), `Missing index ${index}`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const project = (await client.query<ProjectRow>("INSERT INTO projects(name) VALUES ('Phase 0B test') RETURNING *")).rows[0]!;
      const other = (await client.query<ProjectRow>("INSERT INTO projects(name) VALUES ('Boundary test') RETURNING *")).rows[0]!;
      const media = (await client.query<MediaAssetRow>(`INSERT INTO media_assets
        (project_id,original_filename,storage_path,media_type,file_size_bytes)
        VALUES ($1,'fixture.mp4','test/fixture.mp4','video/mp4',42) RETURNING *`, [project.id])).rows[0]!;
      const job = (await client.query<JobRow>(`INSERT INTO jobs(project_id,media_asset_id,job_type,max_attempts,idempotency_key)
        VALUES ($1,$2,'foundation-test',3,'fixture') RETURNING *`, [project.id, media.id])).rows[0]!;
      await client.query(`INSERT INTO analysis_runs(project_id,media_asset_id,analysis_type,revision,pipeline_version)
        VALUES ($1,$2,'foundation-test',1,'test-v1')`, [project.id,media.id]);
      assert.equal(media.file_size_bytes, '42');
      assert.equal(job.status, 'queued');
      assert.equal(job.attempt_count, 0);
      const rows = await client.query(`SELECT p.name FROM projects p JOIN media_assets m ON m.project_id=p.id
        JOIN jobs j ON j.media_asset_id=m.id JOIN analysis_runs a ON a.media_asset_id=m.id WHERE j.id=$1`, [job.id]);
      assert.equal(rows.rows[0]?.name, 'Phase 0B test');
      async function rejects(sql: string, values: unknown[], code: string): Promise<void> {
        await client.query('SAVEPOINT invalid_record');
        await assert.rejects(client.query(sql, values), (error: unknown) => (error as {code?: string}).code === code);
        await client.query('ROLLBACK TO SAVEPOINT invalid_record');
      }
      await rejects('UPDATE jobs SET project_id=$1 WHERE id=$2', [other.id,job.id], '23503');
      await rejects('UPDATE analysis_runs SET project_id=$1 WHERE media_asset_id=$2', [other.id,media.id], '23503');
      await rejects('UPDATE media_assets SET project_id=gen_random_uuid() WHERE id=$1', [media.id], '23503');
      await rejects("UPDATE jobs SET status='unknown' WHERE id=$1", [job.id], '23514');
      await rejects('UPDATE jobs SET attempt_count=4 WHERE id=$1', [job.id], '23514');
      await rejects('UPDATE media_assets SET file_size_bytes=-1 WHERE id=$1', [media.id], '23514');
      await rejects("UPDATE media_assets SET storage_path='../escape.mp4' WHERE id=$1", [media.id], '23514');
      await rejects(`INSERT INTO jobs(project_id,job_type,max_attempts,idempotency_key)
        VALUES ($1,'test',3,'fixture')`, [project.id], '23505');
      await rejects('DELETE FROM media_assets WHERE id=$1', [media.id], '23503');
      for (const status of ['queued','running','retry_wait','pause_requested','paused','succeeded','failed','cancel_requested','cancelled']) {
        await client.query('UPDATE jobs SET status=$1 WHERE id=$2', [status,job.id]);
      }
      const updated = await client.query<{updated_at: Date}>('UPDATE projects SET name=$1 WHERE id=$2 RETURNING updated_at', ['Updated',project.id]);
      assert.ok(updated.rows[0]!.updated_at >= project.updated_at);
    } finally { await client.query('ROLLBACK'); client.release(); }
  } catch {
    // Keep driver error details (which can include connection information) out of test output.
    throw new Error('Database integration verification failed. Check local configuration, migration integrity, and constraints.');
  } finally { await pool.end(); }
});
