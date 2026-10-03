import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDatabasePool, createProject, listMediaAssets } from '../packages/db/dist/index.js';

test('upload HTTP flow: multiple files, per-file failures, resume, collision, persistence and safe errors', {timeout:60000}, async()=>{
  const parent=resolve('.local/upload-web-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port',String(port)],
    {stdio:'ignore',env:{...process.env,MEDIA_ROOT:root,MAX_FILES_PER_PROJECT:'2',MAX_FILE_SIZE_BYTES:'2000000',MAX_PROJECT_STORAGE_BYTES:'3000000'}});
  const base=`http://127.0.0.1:${port}`;
  const db=createDatabasePool();const project=await createProject(db,'Upload HTTP test '+randomUUID());
  let collisionProject;
  const video=await readFile('references/reference-video.mp4');
  const start=`${base}/api/projects/${project.id}/uploads`;
  const request=(url,method,body,headers={})=>globalThis.fetch(url,{method,body,headers:{Origin:base,...headers}});
  const reserve=(name='reference.mp4',size=video.length,key=randomUUID(),url=start)=>request(url,'POST',JSON.stringify({name,size,type:'video/mp4',key}),{'Content-Type':'application/json'});
  try {
    let started=false;for(let i=0;i<50;i++){try{await globalThis.fetch(base);started=true;break;}catch{await delay(200);}}assert.ok(started);
    const wrongOrigin=await globalThis.fetch(start,{method:'POST',headers:{Origin:'https://example.com'}});assert.equal(wrongOrigin.status,403);
    assert.equal((await reserve('../evil.mp4')).status,400);
    assert.equal((await reserve('bad.txt')).status,415);
    assert.equal((await reserve('too-big.mp4',2000001)).status,413);
    assert.equal((await reserve('valid.mp4',video.length,randomUUID(),`${base}/api/projects/${randomUUID()}/uploads`)).status,404);
    const key=randomUUID();const first=await (await reserve('reference.mp4',video.length,key)).json();
    assert.equal(typeof first.id,'string');
    const endpoint=`${start}/${first.id}`;
    const partial=await request(endpoint,'PUT',video.subarray(0,64),{'Content-Type':'application/octet-stream','Upload-Offset':'0'});
    assert.equal(partial.status,200);
    const resumed=await (await reserve('reference.mp4',video.length,key)).json();assert.equal(resumed.offset,64);
    assert.equal((await request(endpoint,'PUT',video.subarray(64),{'Content-Type':'application/octet-stream','Upload-Offset':'64'})).status,200);
    assert.equal((await request(endpoint,'POST')).status,200);
    assert.equal((await request(endpoint,'POST')).status,200);
    assert.equal((await reserve('unsupported.exe')).status,415); // A failure does not hide the successful file.
    const second=await (await reserve()).json();assert.notEqual(first.id,second.id);
    assert.equal((await request(`${start}/${second.id}`,'PUT',video,{'Content-Type':'application/octet-stream','Upload-Offset':'0'})).status,200);
    assert.equal((await request(`${start}/${second.id}`,'POST')).status,200);
    assert.equal((await reserve()).status,409);
    const assets=await listMediaAssets(db,project.id);assert.equal(assets.length,2);
    for(const asset of assets){assert.deepEqual(await readFile(join(root,'originals',asset.storage_path)),video);assert.equal(asset.duration_ms,null);}
    for(let refresh=0;refresh<2;refresh++){
      const page=await (await globalThis.fetch(`${base}/projects/${project.id}`)).text();
      assert.ok(page.includes('reference.mp4') && page.includes('Uploaded'));
      assert.ok(!page.includes(root) && !page.includes('DATABASE_URL'));
    }
    // Missing-session errors must not leak an absolute storage path.
    const error=await request(`${start}/${randomUUID()}`,'POST');assert.equal(error.status,404);
    const message=await error.text();assert.ok(!message.includes(root) && !message.includes('postgresql://') && !message.includes(' at '));
    assert.ok((await stat(join(root,'originals',assets[0].storage_path))).size>0);
    collisionProject=await createProject(db,'Upload failure HTTP test '+randomUUID());
    const collisionBase=`${base}/api/projects/${collisionProject.id}/uploads`;
    const reservation=await (await reserve('reference.mp4',video.length,randomUUID(),collisionBase)).json();
    const collisionEndpoint=`${collisionBase}/${reservation.id}`;
    assert.equal((await request(collisionEndpoint,'PUT',video,{'Content-Type':'application/octet-stream','Upload-Offset':'0'})).status,200);
    const directory=join(root,'originals',collisionProject.id);await mkdir(directory,{recursive:true});
    await writeFile(join(directory,reservation.id+'.mp4'),'collision');
    const failed=await request(collisionEndpoint,'POST');assert.equal(failed.status,503);
    const safe=await failed.text();assert.ok(safe.includes('Upload could not be saved'));
    assert.ok(!safe.includes(root) && !safe.includes('EEXIST') && !safe.includes('postgresql://') && !safe.includes('stack'));
    assert.equal((await listMediaAssets(db,collisionProject.id)).length,0);
  } finally {
    child.kill();
    await db.query('DELETE FROM upload_reservations WHERE project_id=$1',[project.id]);
    await db.query('DELETE FROM media_assets WHERE project_id=$1',[project.id]);
    await db.query('DELETE FROM projects WHERE id=$1',[project.id]);
    if(collisionProject){await db.query('DELETE FROM upload_reservations WHERE project_id=$1',[collisionProject.id]);await db.query('DELETE FROM media_assets WHERE project_id=$1',[collisionProject.id]);await db.query('DELETE FROM projects WHERE id=$1',[collisionProject.id]);}
    await db.end();
    assert.ok(root.startsWith(parent));await rm(root,{recursive:true,force:true});
  }
});
