import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool, createProject, getProject, listProjects, validateProjectName, ProjectNameError } from './index.js';

test('project names require trimmed single-line text, at most 120 characters', () => {
  assert.equal(validateProjectName('  My video  '), 'My video');
  assert.equal(validateProjectName('วิดีโอแรก'), 'วิดีโอแรก');
  assert.equal(validateProjectName('a'.repeat(120)).length, 120);
  for (const value of [null, undefined, 12, '', ' \t\n ', 'a'.repeat(121), 'bad\u0000name', 'two\nlines']) {
    assert.throws(() => validateProjectName(value), ProjectNameError);
  }
});

test('project creation persists, lists and retrieves only the selected owner', async () => {
  const pool = createDatabasePool();
  const owner = randomUUID();
  let id: string | undefined;
  try {
    assert.deepEqual(await listProjects(pool, owner), []);
    for (const value of ['', '  ', 'x'.repeat(121)]) await assert.rejects(createProject(pool, value, owner), ProjectNameError);
    const created = await createProject(pool, '  Persistent test  ', owner);
    id = created.id;
    assert.equal(created.name, 'Persistent test');
    assert.equal(created.status, 'active');
    // A separate pool proves committed persistence across connections.
    const other = createDatabasePool();
    try { assert.equal((await getProject(other, id, owner))?.name, 'Persistent test'); }
    finally { await other.end(); }
    const listed = await listProjects(pool, owner);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.media_count, '0');
    assert.equal(await getProject(pool, id, randomUUID()), null);
    assert.equal(await getProject(pool, 'invalid', owner), null);
    assert.equal(await getProject(pool, randomUUID(), owner), null);
    assert.equal(created.created_at instanceof Date, true);
  } finally {
    if (id) await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [id, owner]);
    await pool.end();
  }
});
