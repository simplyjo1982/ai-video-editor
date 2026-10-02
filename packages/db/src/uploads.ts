import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Readable } from 'node:stream';
import { UploadError, validateUpload, CHUNK_BYTES, uuid, type UploadPolicy, type UploadStorage } from '@ai-video-editor/media';
import { LOCAL_OWNER_ID } from './projects.js';
import type { MediaAssetRow } from './index.js';

interface Reservation { id: string; project_id: string; original_filename: string; extension: string; media_type: string;
  file_size_bytes: string; received_bytes: string; state: string; expires_at: Date }
export class UploadRepository {
  constructor(private readonly pool: Pool, private readonly storage: UploadStorage, private readonly policy: UploadPolicy) {}
  private async transaction<T>(projectId: string, action: (db: PoolClient) => Promise<T>): Promise<T> {
    if (!uuid(projectId)) throw new UploadError('Project not found.', 404);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      // One lock order across all upload operations; quota reservations cannot race.
      const project = await db.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 AND status=$3 FOR UPDATE', [projectId, LOCAL_OWNER_ID, 'active']);
      if (!project.rowCount) throw new UploadError('Project not found or unavailable for upload.', 404);
      const result = await action(db);
      await db.query('COMMIT');
      return result;
    } catch (error) { await db.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { db.release(); }
  }
  private receipt(row: Reservation) {
    return {id: row.id, offset: Number(row.received_bytes), size: Number(row.file_size_bytes), status: row.state, chunkBytes: CHUNK_BYTES};
  }
  private async expired(db: PoolClient, projectId: string): Promise<void> {
    const expired = await db.query<Reservation>(`SELECT * FROM upload_reservations WHERE project_id=$1
      AND state IN ('reserved','uploading') AND expires_at <= now() FOR UPDATE`, [projectId]);
    for (const row of expired.rows) {
      // A ledger entry pins orphan data until cleanup succeeds; never sweep unrelated media.
      const asset = await db.query('SELECT id FROM media_assets WHERE id=$1', [row.id]);
      if (asset.rowCount) throw new Error('Upload ledger inconsistency');
      await this.storage.discard(projectId, row.id, row.extension);
      await db.query("UPDATE upload_reservations SET state='expired' WHERE id=$1", [row.id]);
    }
    const finished = await db.query<Reservation>("SELECT * FROM upload_reservations WHERE project_id=$1 AND state='uploaded'", [projectId]);
    for (const row of finished.rows) await this.storage.removeTemporary(projectId, row.id);
  }
  async reserve(projectId: string, input: {name?: unknown; size?: unknown; type?: unknown; key?: unknown}) {
    const file = validateUpload(input, this.policy);
    if (typeof input.key !== 'string' || !uuid(input.key)) throw new UploadError('Invalid upload request.');
    await this.storage.initialize();
    // Expiry cleanup commits independently, even if the next admission is rejected.
    await this.transaction(projectId, db => this.expired(db, projectId));
    return this.transaction(projectId, async db => {
      const existing = (await db.query<Reservation>('SELECT * FROM upload_reservations WHERE project_id=$1 AND idempotency_key=$2', [projectId,input.key])).rows[0];
      if (existing) {
        if (existing.original_filename !== file.name || Number(existing.file_size_bytes) !== file.size || existing.media_type !== file.type) throw new UploadError('This upload belongs to a different file.', 409);
        if (['expired','rejected'].includes(existing.state)) throw new UploadError('This upload expired or was rejected. Select the file again to start a new upload.', 410);
        return this.receipt(existing);
      }
      const usage = (await db.query<{count: string; bytes: string}>(`SELECT count(*) AS count, coalesce(sum(size),0) AS bytes FROM (
        SELECT file_size_bytes AS size FROM media_assets WHERE project_id=$1
        UNION ALL SELECT file_size_bytes FROM upload_reservations WHERE project_id=$1 AND state IN ('reserved','uploading')
      ) usage`, [projectId])).rows[0]!;
      if (BigInt(usage.count) >= BigInt(this.policy.maxFiles)) throw new UploadError('This project has reached its configured file limit.', 409);
      if (BigInt(usage.bytes) + BigInt(file.size) > BigInt(this.policy.maxProjectBytes)) throw new UploadError('This project has reached its configured storage limit.', 413);
      const row = (await db.query<Reservation>(`INSERT INTO upload_reservations
        (id,project_id,idempotency_key,original_filename,extension,media_type,file_size_bytes,policy_version,policy_snapshot,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+$10*interval '1 second') RETURNING *`,
        [randomUUID(),projectId,input.key,file.name,file.extension,file.type,file.size,this.policy.version,JSON.stringify(this.policy),this.policy.ttlSeconds])).rows[0]!;
      return this.receipt(row);
    });
  }
  private async reservation(db: PoolClient, projectId: string, id: string): Promise<Reservation> {
    if (!uuid(id)) throw new UploadError('Upload not found.', 404);
    const row = (await db.query<Reservation>('SELECT * FROM upload_reservations WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId,id])).rows[0];
    if (!row) throw new UploadError('Upload not found.', 404);
    if (['rejected','expired'].includes(row.state) || (row.state !== 'uploaded' && row.expires_at.getTime() <= Date.now())) throw new UploadError('This upload has expired. Select the file again.', 410);
    return row;
  }
  async append(projectId: string, id: string, offset: number, stream: Readable) {
    return this.transaction(projectId, async db => {
      const row = await this.reservation(db, projectId, id);
      if (row.state === 'uploaded' || !Number.isSafeInteger(offset) || offset !== Number(row.received_bytes)) throw new UploadError('Upload position changed. Retry this file to resume.', 409);
      const count = await this.storage.append(projectId,id,offset,Number(row.file_size_bytes)-offset,stream);
      const updated = (await db.query<Reservation>(`UPDATE upload_reservations SET received_bytes=$2, state='uploading',
        expires_at=now()+$3*interval '1 second' WHERE id=$1 RETURNING *`, [id,offset+count,this.policy.ttlSeconds])).rows[0]!;
      return this.receipt(updated);
    });
  }
  async finalize(projectId: string, id: string) {
    const result = await this.transaction(projectId, async db => {
      const row = await this.reservation(db, projectId,id);
      if (row.state === 'uploaded') return {id, status: 'uploaded'};
      if (row.received_bytes !== row.file_size_bytes) throw new UploadError('The upload is incomplete. Retry this file to resume.', 409);
      try { await this.storage.validate(projectId,id,Number(row.file_size_bytes)); }
      catch (error) {
        if (!(error instanceof UploadError) || error.status !== 415) throw error;
        await this.storage.discard(projectId,id,row.extension);
        await db.query("UPDATE upload_reservations SET state='rejected' WHERE id=$1", [id]);
        return error; // Commit rejection and quota release before returning the error.
      }
      const checksum = await this.storage.checksum(projectId,id);
      // The row is invisible until the file is published AND the transaction commits.
      await db.query(`INSERT INTO media_assets(id,project_id,original_filename,storage_path,media_type,file_size_bytes,status)
        VALUES ($1,$2,$3,$4,$5,$6,'uploaded')`, [id,projectId,row.original_filename,`${projectId}/${id}.${row.extension}`,row.media_type,row.file_size_bytes]);
      await this.storage.publish(projectId,id,row.extension);
      try {
        await db.query("UPDATE upload_reservations SET state='uploaded',content_sha256=$2 WHERE id=$1", [id,checksum]);
        await db.query('UPDATE projects SET updated_at=now() WHERE id=$1', [projectId]);
      } catch (error) {
        await this.storage.removePublished(projectId,id,row.extension);
        throw error;
      }
      return {id, status: 'uploaded'};
    });
    if (result instanceof UploadError) throw result;
    // If COMMIT acknowledgement is lost, keep files pinned to the reservation for retry.
    // Post-commit temp cleanup is best effort and repeated on the next project upload.
    await this.storage.removeTemporary(projectId,id).catch(() => undefined);
    return result;
  }
}
export async function listMediaAssets(pool: Pool, projectId: string): Promise<MediaAssetRow[]> {
  if (!uuid(projectId)) return [];
  return (await pool.query<MediaAssetRow>(`SELECT m.* FROM media_assets m JOIN projects p ON p.id=m.project_id
    WHERE m.project_id=$1 AND p.owner_id=$2 ORDER BY m.created_at,m.id`, [projectId,LOCAL_OWNER_ID])).rows;
}
