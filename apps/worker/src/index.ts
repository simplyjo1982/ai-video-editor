import { createInterface } from 'node:readline';
import { foundation } from '@ai-video-editor/contracts';
import { createDatabasePool, verifyConnection } from '@ai-video-editor/db';
import { startTechnicalWorker } from './technical-worker.js';

async function main(): Promise<void> {
  const pool = createDatabasePool();
  try { await verifyConnection(pool); }
  catch { await pool.end(); throw new Error('Database unavailable'); }
  console.log(`[worker] ${foundation.productName} | Phase 0E | Database connected.`);
  if (process.argv.includes('--check-db')) { await pool.end(); return; }
  const technical = await startTechnicalWorker(pool);
  const terminal = createInterface({input: process.stdin, output: process.stdout});
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    technical.stop();
    terminal.close();
    process.stdin.pause();
    await technical.done;
    await pool.end();
    console.log('[worker] Graceful shutdown complete.');
  }
  const stop = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  terminal.on('SIGINT', stop);
  terminal.on('line', line => { if (line.trim() === 'exit') stop(); });
  void technical.done.catch(() => { console.error('[worker] Technical polling stopped.'); stop(); });
  console.log('[worker] Started. Polling PostgreSQL for technical media jobs. Press Ctrl+C or type exit to stop.');
}
main().catch(() => {
  console.error('[worker] Startup failed. Check local database configuration and availability.');
  process.exitCode = 1;
});
