import 'server-only';
import { createDatabasePool, verifyConnection } from '@ai-video-editor/db';

const state = globalThis as typeof globalThis & { databasePool?: ReturnType<typeof createDatabasePool> };
export async function checkDatabase(): Promise<void> {
  await verifyConnection(getDatabase());
}
export function getDatabase(): ReturnType<typeof createDatabasePool> {
  state.databasePool ??= createDatabasePool();
  return state.databasePool;
}
