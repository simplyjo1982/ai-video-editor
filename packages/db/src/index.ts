import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";
import pg from "pg";

export function databaseUrl(): string {
  // Resolve at runtime: a static import.meta URL can bundle a private .env as an asset.
  let directory = process.cwd();
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'ai-video-editor') {
      const envFile = join(directory, '.env');
      if (existsSync(envFile)) loadEnvFile(envFile);
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const value = process.env.DATABASE_URL;
  try {
    const url = new URL(value ?? "");
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        (url.port && url.port !== '5432') || url.pathname !== '/ai_video_editor' ||
        !url.username || url.search || url.hash) throw new Error();
  } catch {
    throw new Error("Configure DATABASE_URL for local PostgreSQL on port 5432, database ai_video_editor (no query parameters).");
  }
  return value!;
}

export function createDatabasePool(): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 5,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000,
    options: '-c search_path=public -c timezone=UTC' });
  pool.on('error', () => console.error('[db] Idle database connection failed.'));
  return pool;
}

export async function verifyConnection(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export type JobStatus = 'queued' | 'running' | 'retry_wait' | 'pause_requested' |
  'paused' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled';
export interface ProjectRow { id: string; owner_id: string; name: string; status: 'active' | 'archived'; created_at: Date; updated_at: Date }
export { createProject, listProjects, getProject, validateProjectName, ProjectNameError, LOCAL_OWNER_ID } from './projects.js';
export type { ProjectSummary } from './projects.js';
export interface MediaAssetRow { id: string; project_id: string; original_filename: string;
  storage_backend: string; storage_namespace: string; storage_path: string;
  media_type: string; file_size_bytes: string; duration_ms: string | null;
  width: number | null; height: number | null; codec: string | null;
  status: 'uploading' | 'uploaded' | 'validating' | 'analyzing' | 'ready' | 'partial' | 'failed' | 'rejected';
  created_at: Date; updated_at: Date }
export interface JobRow { id: string; project_id: string; media_asset_id: string | null;
  job_type: string; status: JobStatus; attempt_count: number; max_attempts: number;
  available_at: Date; locked_at: Date | null; locked_by: string | null; last_error: string | null;
  lease_token: string | null; lease_expires_at: Date | null; heartbeat_at: Date | null;
  pause_reason: 'user' | 'budget' | 'capacity' | 'dependency' | null; idempotency_key: string | null;
  created_at: Date; updated_at: Date }
export interface AnalysisRunRow { id: string; project_id: string; media_asset_id: string;
  analysis_type: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  revision: number; pipeline_version: string; schema_version: number;
  model_provider: string | null; model_identifier: string | null; prompt_version: string | null;
  input_hash: string | null; cache_key: string | null; created_at: Date; updated_at: Date }
