import { createInterface } from 'node:readline';
import { foundation } from '@ai-video-editor/contracts';
import { createDatabasePool, verifyConnection } from '@ai-video-editor/db';

async function main(): Promise<void> {
  const pool = createDatabasePool();
  try { await verifyConnection(pool); }
  catch { await pool.end(); throw new Error('Database unavailable'); }
  console.log(`[worker] ${foundation.productName} | Phase 0B | Database connected.`);
  if (process.argv.includes('--check-db')) { await pool.end(); return; }
  const keepAlive = setInterval(() => undefined, 60_000);
  const terminal = createInterface({input: process.stdin, output: process.stdout});
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    terminal.close();
    process.stdin.pause();
    await pool.end();
    console.log('[worker] Graceful shutdown complete.');
  }
  const stop = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  terminal.on('SIGINT', stop);
  terminal.on('line', line => { if (line.trim() === 'exit') stop(); });
  console.log('[worker] Started. No job claiming or processing. Press Ctrl+C or type exit to stop.');
}
main().catch(() => {
  console.error('[worker] Startup failed. Check local database configuration and availability.');
  process.exitCode = 1;
});
