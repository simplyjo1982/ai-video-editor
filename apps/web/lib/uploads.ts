import 'server-only';
import { UploadRepository } from '@ai-video-editor/db';
import { LocalMediaStorage, UploadError, uploadPolicy } from '@ai-video-editor/media';
import { getDatabase } from './database';
import { isLocalHost } from './local-access';

export function uploads(): UploadRepository {
  const db = getDatabase(); // Loads private root environment before reading storage configuration.
  return new UploadRepository(db, new LocalMediaStorage(process.env.MEDIA_ROOT ?? ''), uploadPolicy());
}
export function verifyUploadOrigin(request: Request): void {
  const host = request.headers.get('host');
  let origin;
  try { origin = new URL(request.headers.get('origin') ?? ''); } catch { throw new UploadError('Open the local application to upload footage.', 403); }
  if (!isLocalHost(host) || origin.host !== host || origin.protocol !== 'http:') throw new UploadError('Open the local application to upload footage.', 403);
}
export function uploadFailure(error: unknown): Response {
  return Response.json({error: error instanceof UploadError ? error.message : 'Upload could not be saved. Check local storage and database availability, then retry.'},
    {status: error instanceof UploadError ? error.status : 503, headers: {'Cache-Control': 'no-store'}});
}
export async function uploadInput(request: Request): Promise<{name?: unknown; size?: unknown; type?: unknown; key?: unknown}> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new UploadError('Invalid upload request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError('Invalid upload request.');
  const chunks: Uint8Array[] = [];
  let count = 0;
  while (true) {
    const {value,done} = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > 4096) { await reader.cancel(); throw new UploadError('Upload request is too large.', 413); }
    chunks.push(value);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new UploadError('Invalid upload request.'); }
}
