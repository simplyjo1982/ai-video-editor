import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { createDatabasePool, getProject, LOCAL_OWNER_ID } from '../packages/db/dist/index.js';

async function startWeb(overrides = {}) {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore', env: {...process.env, ...overrides},
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await globalThis.fetch(base); return {base, child}; } catch { await delay(200); }
  }
  child.kill();
  throw new Error('Test web server did not start.');
}
function create(base, name, origin = base) {
  return globalThis.fetch(`${base}/api/projects`, {method: 'POST', redirect: 'manual',
    headers: {Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({name})});
}

test('web project create/list/detail/refresh, validation, missing IDs and origin checks', async () => {
  const {base, child} = await startWeb();
  const pool = createDatabasePool();
  let id;
  try {
    assert.equal((await globalThis.fetch(base)).status, 200);
    for (const name of ['', '  ', 'a'.repeat(121)]) {
      const response = await create(base, name);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/projects/new?error=invalid');
    }
    assert.equal((await create(base, 'Blocked', 'https://example.com')).status, 403);
    const response = await create(base, '  Web verification project  ');
    assert.equal(response.status, 303);
    const location = response.headers.get('location');
    assert.match(location, /^\/projects\/[0-9a-f-]{36}$/);
    id = location.split('/').at(-1);
    assert.equal((await getProject(pool, id))?.name, 'Web verification project');
    const listing = await (await globalThis.fetch(base)).text();
    assert.ok(listing.includes('Web verification project'));
    for (let refresh = 0; refresh < 2; refresh++) {
      const detail = await (await globalThis.fetch(base + location)).text();
      assert.ok(detail.includes('Web verification project') && detail.includes(id) && detail.includes('No footage uploaded yet.'));
    }
    for (const missing of ['not-a-uuid', randomUUID()]) {
      const response = await globalThis.fetch(`${base}/projects/${missing}`);
      assert.equal(response.status, 404);
      assert.ok((await response.text()).includes('Project not found'));
    }
  } finally {
    if (id) await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [id, LOCAL_OWNER_ID]);
    await pool.end();
    child.kill();
  }
});

test('database failures produce safe library, detail and creation errors', async () => {
  const {base, child} = await startWeb({DATABASE_URL: 'postgresql://unavailable:failure-test-password@localhost:5432/ai_video_editor'});
  try {
    for (const path of ['', `/projects/${randomUUID()}`]) {
      const body = await (await globalThis.fetch(base + path)).text();
      assert.ok(body.includes('Projects are temporarily unavailable'));
      assert.ok(!body.includes('failure-test-password') && !body.includes('postgresql://') && !body.includes('password authentication failed'));
    }
    const response = await create(base, 'Cannot save');
    assert.equal(response.headers.get('location'), '/projects/new?error=unavailable');
    const body = await (await globalThis.fetch(base + response.headers.get('location'))).text();
    assert.ok(body.includes('save your project'));
    assert.ok(!body.includes('failure-test-password'));
  } finally { child.kill(); }
});
