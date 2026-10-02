import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<number> {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL search_path TO public");
    await client.query('SELECT pg_advisory_xact_lock(704021, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = await client.query<{name: string; checksum: string}>('SELECT name, checksum FROM schema_migrations');
    if (applied.rows.some(row => !files.includes(row.name))) throw new Error('Migration history is incomplete.');
    const history = applied.rows.map(row => row.name).sort();
    if (history.some((name, index) => files[index] !== name)) throw new Error('Migration history is out of order.');
    let count = 0;
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = applied.rows.find(row => row.name === name);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error('Applied migration checksum changed.');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      count++;
    }
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
