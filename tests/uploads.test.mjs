import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createDatabasePool, createProject, UploadRepository, listMediaAssets, LOCAL_OWNER_ID } from '../packages/db/dist/index.js';
import { LocalMediaStorage, uploadPolicy, UploadError, CHUNK_BYTES } from '../packages/media/dist/index.js';

// Small deterministic ISO BMFF header fixture; decoder/codec validation belongs to Phase 0E.
const video = Buffer.concat([Buffer.from('000000186674797069736f6d0000000069736f6d6d7034320000000c6d64617401020304','hex')]);
async function fixture(run) {
  const parent = resolve('.local/upload-tests');
  await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'case-'));
  const db=createDatabasePool();
  const project=await createProject(db,'Upload test '+randomUUID());
  const storage=new LocalMediaStorage(root);
  const policy=uploadPolicy({MAX_FILES_PER_PROJECT:'10',MAX_FILE_SIZE_BYTES:'10000000',MAX_PROJECT_STORAGE_BYTES:'20000000'});
  const repo=new UploadRepository(db,storage,policy);
  try { await run({root,db,project,storage,policy,repo}); }
  finally {
    await db.query('DELETE FROM upload_reservations WHERE project_id=$1',[project.id]);
    await db.query('DELETE FROM media_assets WHERE project_id=$1',[project.id]);
    await db.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2',[project.id,LOCAL_OWNER_ID]);
    await db.end();
    // root is a freshly created, dedicated test directory under .local/upload-tests.
    assert.equal(resolve(root).startsWith(parent+ '\\') || resolve(root).startsWith(parent+'/'),true);
    await rm(root,{recursive:true,force:true});
  }
}
const input=(name='clip.mp4',size=video.length)=>({name,size,type:'video/mp4',key:randomUUID()});
async function send(repo,projectId,body=video,descriptor=input()) {
  const upload=await repo.reserve(projectId,descriptor);
  await repo.append(projectId,upload.id,0,Readable.from([body]));
  await repo.finalize(projectId,upload.id);
  return upload.id;
}
function bad(status) { return error=>error instanceof UploadError && error.status===status; }

test('multiple MP4 uploads preserve filename, bytes, nullable metadata and unique paths without jobs', {timeout:30000}, async()=>fixture(async({repo,project,db,root})=>{
  const ids=await Promise.all([send(repo,project.id),send(repo,project.id)]);
  assert.notEqual(ids[0],ids[1]);
  const rows=await listMediaAssets(db,project.id);
  assert.equal(rows.length,2);
  assert.notEqual(rows[0].storage_path,rows[1].storage_path);
  for(const row of rows){
    assert.equal(row.original_filename,'clip.mp4');assert.equal(row.status,'uploaded');
    assert.equal(row.file_size_bytes,String(video.length));
    for(const field of ['duration_ms','width','height','codec'])assert.equal(row[field],null);
    assert.deepEqual(await readFile(join(root,'originals',row.storage_path)),video);
  }
  assert.equal((await db.query('SELECT count(*) FROM jobs WHERE project_id=$1',[project.id])).rows[0].count,'0');
  const separate=createDatabasePool();try{assert.equal((await listMediaAssets(separate,project.id)).length,2);}finally{await separate.end();}
}));

test('extension, MIME, size, unsafe filenames, invalid projects and fake container are rejected', async()=>fixture(async({repo,project,storage,policy,db,root})=>{
  for(const name of ['clip.txt','clip.exe'])await assert.rejects(repo.reserve(project.id,input(name)),bad(415));
  for(const name of ['../clip.mp4','..\\clip.mp4','C:\\clip.mp4','a\u0000.mp4'])await assert.rejects(repo.reserve(project.id,input(name)),bad(400));
  await assert.rejects(repo.reserve(project.id,{...input(),type:'text/plain'}),bad(415));
  await assert.rejects(repo.reserve(project.id,input('clip.mp4',policy.maxFileBytes+1)),bad(413));
  await assert.rejects(repo.reserve('bad-id',input()),bad(404));
  await assert.rejects(repo.reserve(randomUUID(),input()),bad(404));
  const invalid=await repo.reserve(project.id,input());
  await repo.append(project.id,invalid.id,0,Readable.from([Buffer.alloc(video.length)]));
  await assert.rejects(repo.finalize(project.id,invalid.id),bad(415));
  assert.equal((await listMediaAssets(db,project.id)).length,0);
  assert.equal((await db.query('SELECT state FROM upload_reservations WHERE id=$1',[invalid.id])).rows[0].state,'rejected');
  await assert.rejects(stat(join(root,'temp',project.id,invalid.id+'.part')));
  await assert.rejects(storage.publish(project.id,'../bad','mp4'));
}));

test('atomic quota reservations enforce file count and storage limits including concurrent requests', async()=>fixture(async({db,storage,project,policy})=>{
  const countRepo=new UploadRepository(db,storage,{...policy,maxFiles:1});
  const results=await Promise.allSettled([countRepo.reserve(project.id,input()),countRepo.reserve(project.id,input())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  await db.query("UPDATE upload_reservations SET expires_at=now()-interval '1 second' WHERE project_id=$1",[project.id]);
  const sizeRepo=new UploadRepository(db,storage,{...policy,maxProjectBytes:video.length});
  await send(sizeRepo,project.id);
  await assert.rejects(sizeRepo.reserve(project.id,input()),bad(413));
}));

test('resumes interrupted chunks, idempotent reserve/finalize, rejects excess bytes and stale offsets', {timeout:30000}, async()=>fixture(async({repo,project,root})=>{
  const descriptor=input();
  const upload=await repo.reserve(project.id,descriptor);
  assert.equal((await repo.reserve(project.id,descriptor)).id,upload.id);
  const broken=Readable.from((async function*(){yield video.subarray(0,8);throw new Error('Simulated disconnect');})());
  await assert.rejects(repo.append(project.id,upload.id,0,broken));
  assert.equal((await repo.reserve(project.id,descriptor)).offset,0);
  assert.equal((await stat(join(root,'temp',project.id,upload.id+'.part'))).size,0);
  await assert.rejects(repo.append(project.id,upload.id,0,Readable.from([Buffer.alloc(video.length+1)])),bad(413));
  await repo.append(project.id,upload.id,0,Readable.from([video.subarray(0,16)]));
  assert.equal((await repo.reserve(project.id,descriptor)).offset,16);
  await assert.rejects(repo.append(project.id,upload.id,0,Readable.from([video])),bad(409));
  await assert.rejects(repo.finalize(project.id,upload.id),bad(409));
  // Simulates bytes written just before a crash without committing the database offset.
  await writeFile(join(root,'temp',project.id,upload.id+'.part'),Buffer.concat([video.subarray(0,16),Buffer.from('garbage')]));
  await repo.append(project.id,upload.id,16,Readable.from([video.subarray(16)]));
  await repo.finalize(project.id,upload.id);
  await repo.finalize(project.id,upload.id);
  assert.equal((await repo.reserve(project.id,descriptor)).status,'uploaded');
}));

test('expired reservations remove partial files before releasing quota', async()=>fixture(async({repo,project,db,root})=>{
  const upload=await repo.reserve(project.id,input());
  await repo.append(project.id,upload.id,0,Readable.from([video.subarray(0,8)]));
  await db.query("UPDATE upload_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",[upload.id]);
  await repo.reserve(project.id,input());
  await assert.rejects(stat(join(root,'temp',project.id,upload.id+'.part')));
  assert.equal((await db.query('SELECT state FROM upload_reservations WHERE id=$1',[upload.id])).rows[0].state,'expired');
}));

test('publication failure rolls back media registration and never overwrites a collision', async()=>fixture(async({repo,project,db,root})=>{
  const upload=await repo.reserve(project.id,input());
  await repo.append(project.id,upload.id,0,Readable.from([video]));
  const directory=join(root,'originals',project.id);await mkdir(directory,{recursive:true});
  const existing=join(directory,upload.id+'.mp4');await writeFile(existing,'do not overwrite');
  await assert.rejects(repo.finalize(project.id,upload.id));
  assert.equal((await listMediaAssets(db,project.id)).length,0);
  assert.equal(await readFile(existing,'utf8'),'do not overwrite');
  await db.query("UPDATE upload_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",[upload.id]);
  await assert.rejects(repo.reserve(project.id,input()));
  assert.equal(await readFile(existing,'utf8'),'do not overwrite');
}));

test('directory junctions cannot redirect writes outside the storage class', async()=>fixture(async({repo,project,root})=>{
  const upload=await repo.reserve(project.id,input());
  const external=join(root,'exports');
  await symlink(external,join(root,'temp',project.id),'junction');
  await assert.rejects(repo.append(project.id,upload.id,0,Readable.from([video])));
  assert.deepEqual(await readdir(external),[]);
}));

test('database failure after file publication cleans the orphan and preserves resumable data', async()=>fixture(async({repo,project,db,storage,policy,root})=>{
  const upload=await repo.reserve(project.id,input());await repo.append(project.id,upload.id,0,Readable.from([video]));
  const faulty={connect:async()=>{const client=await db.connect();return {release:()=>client.release(),query:(sql,values)=>{
    if(sql.startsWith("UPDATE upload_reservations SET state='uploaded'"))throw new Error('Injected persistence failure');
    return client.query(sql,values);
  }};}};
  await assert.rejects(new UploadRepository(faulty,storage,policy).finalize(project.id,upload.id));
  assert.equal((await listMediaAssets(db,project.id)).length,0);
  await assert.rejects(stat(join(root,'originals',project.id,upload.id+'.mp4')));
  assert.deepEqual(await readFile(join(root,'temp',project.id,upload.id+'.part')),video);
  await repo.finalize(project.id,upload.id);
}));

test('lost commit acknowledgement preserves the committed original and permits safe retry', async()=>fixture(async({repo,project,db,storage,policy,root})=>{
  const upload=await repo.reserve(project.id,input());await repo.append(project.id,upload.id,0,Readable.from([video]));
  const faulty={connect:async()=>{const client=await db.connect();return {release:()=>client.release(),query:async(sql,values)=>{
    const result=await client.query(sql,values);if(sql==='COMMIT')throw new Error('Injected lost acknowledgement');return result;
  }};}};
  await assert.rejects(new UploadRepository(faulty,storage,policy).finalize(project.id,upload.id));
  await repo.finalize(project.id,upload.id);
  assert.equal((await listMediaAssets(db,project.id)).length,1);
  assert.deepEqual(await readFile(join(root,'originals',project.id,upload.id+'.mp4')),video);
}));

test('large requests are bounded by chunk size', async()=>fixture(async({repo,project})=>{
  const upload=await repo.reserve(project.id,input('large.mp4',CHUNK_BYTES+1));
  await assert.rejects(repo.append(project.id,upload.id,0,Readable.from([Buffer.alloc(CHUNK_BYTES+1)])),bad(413));
}));

test('alternate MOV and M4V MIME types are accepted, with header checks still required', async()=>fixture(async({repo,project,db,root})=>{
  await send(repo,project.id,video,{...input('clip.mov'),type:'video/quicktime'});
  await send(repo,project.id,video,{...input('clip.m4v'),type:'video/x-m4v'});
  assert.equal((await listMediaAssets(db,project.id)).length,2);
  assert.deepEqual((await readdir(root)).sort(),['exports','originals','temp','working']);
}));
