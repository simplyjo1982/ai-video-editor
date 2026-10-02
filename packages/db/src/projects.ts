import type { Pool, PoolClient } from 'pg';
import type { ProjectRow } from './index.js';

// Persisted Phase 0 local identity; future identity adapters supply an owner explicitly.
export const LOCAL_OWNER_ID = '00000000-0000-4000-8000-000000000001';
export class ProjectNameError extends Error {}
export function validateProjectName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProjectNameError('Enter a project name.');
  const name = value.trim();
  if (name.length > 120) throw new ProjectNameError('Use 120 characters or fewer.');
  if ([...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ProjectNameError('Use a single line of text for the project name.');
  return name;
}
type Database = Pool | PoolClient;
export interface ProjectSummary extends ProjectRow { media_count: string }
export async function createProject(db: Database, input: unknown, ownerId = LOCAL_OWNER_ID): Promise<ProjectRow> {
  const name = validateProjectName(input);
  const result = await db.query<ProjectRow>('INSERT INTO projects(name, owner_id) VALUES ($1,$2) RETURNING *', [name, ownerId]);
  return result.rows[0]!;
}
export async function listProjects(db: Database, ownerId = LOCAL_OWNER_ID): Promise<ProjectSummary[]> {
  const result = await db.query<ProjectSummary>(`SELECT p.*,
    (SELECT count(*) FROM media_assets m WHERE m.project_id=p.id) AS media_count
    FROM projects p WHERE p.owner_id=$1 ORDER BY p.updated_at DESC, p.id`, [ownerId]);
  return result.rows;
}
export async function getProject(db: Database, id: string, ownerId = LOCAL_OWNER_ID): Promise<ProjectRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const result = await db.query<ProjectRow>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2', [id, ownerId]);
  return result.rows[0] ?? null;
}
