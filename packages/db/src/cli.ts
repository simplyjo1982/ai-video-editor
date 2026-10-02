import pg from 'pg';
import { createDatabasePool, databaseUrl, verifyConnection } from './index.js';
import { migrate } from './migrate.js';

try {
  const command = process.argv[2];
  if (command === 'create') {
    const url = new URL(databaseUrl());
    url.pathname = '/postgres';
    const client = new pg.Client({connectionString: url.toString(), connectionTimeoutMillis: 5000});
    try {
      await client.connect();
      const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', ['ai_video_editor']);
      if (!result.rowCount) {
        try { await client.query('CREATE DATABASE ai_video_editor'); }
        catch (error) { if ((error as {code?: string}).code !== '42P04') throw error; }
      }
      console.log('[db] ai_video_editor is available.');
    } finally { await client.end(); }
  } else if (command === 'migrate' || command === 'verify') {
    const pool = createDatabasePool();
    try {
      await verifyConnection(pool);
      if (command === 'migrate') console.log(`[db] Applied ${await migrate(pool)} migration(s).`);
      else console.log('[db] Database connection successful.');
    } finally { await pool.end(); }
  } else throw new Error('Unknown command');
} catch {
  console.error('[db] Command failed. Check local DATABASE_URL, server availability, permissions, and migration integrity. Credentials are not logged.');
  process.exitCode = 1;
}
