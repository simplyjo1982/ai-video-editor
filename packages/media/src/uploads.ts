import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class UploadError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export const CHUNK_BYTES = 4 * 1024 * 1024;
export interface UploadPolicy { maxFiles: number; maxFileBytes: number; maxProjectBytes: number; ttlSeconds: number; version: string }
export function uploadPolicy(env = process.env): UploadPolicy {
  function number(key: string, fallback: number): number {
    const value = env[key] ? Number(env[key]) : fallback;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid upload configuration');
    return value;
  }
  const values = { maxFiles: number('MAX_FILES_PER_PROJECT', 20), maxFileBytes: number('MAX_FILE_SIZE_BYTES', 1_000_000_000),
    maxProjectBytes: number('MAX_PROJECT_STORAGE_BYTES', 5_000_000_000), ttlSeconds: number('UPLOAD_RESERVATION_TTL_SECONDS', 86400) };
  return {...values, version: createHash('sha256').update(JSON.stringify(values)).digest('hex')};
}
export function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function validateUpload(input: {name?: unknown; size?: unknown; type?: unknown}, policy: UploadPolicy) {
  if (typeof input.name !== 'string' || !input.name.trim() || Buffer.byteLength(input.name) > 255 ||
      /[/\\:]/.test(input.name) || [...input.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw new UploadError('Use a filename without path separators or control characters.');
  }
  const extension = input.name.match(/\.(mp4|mov|m4v)$/i)?.[1]?.toLowerCase();
  if (!extension) throw new UploadError('Choose an MP4, MOV, or M4V video.', 415);
  const types: Record<string, string[]> = {mp4: ['video/mp4'], mov: ['video/quicktime'], m4v: ['video/x-m4v', 'video/mp4']};
  if (typeof input.type !== 'string' || (input.type !== '' && input.type !== 'application/octet-stream' && !types[extension]!.includes(input.type))) {
    throw new UploadError('The file type does not match its video extension.', 415);
  }
  if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size <= 0) throw new UploadError('Choose a nonempty video file.');
  if (input.size > policy.maxFileBytes) throw new UploadError('This file exceeds the configured upload size limit.', 413);
  return {name: input.name, size: input.size, extension, type: types[extension]![0]!};
}

// All filenames below are generated from validated UUIDs, never user filenames.
export class LocalMediaStorage {
  constructor(private readonly configuredRoot: string) {
    if (!configuredRoot || !isAbsolute(configuredRoot)) throw new Error('Configure an absolute MEDIA_ROOT');
  }
  private async directory(parts: string[]): Promise<string> {
    let current = resolve(this.configuredRoot);
    await mkdir(current, {recursive: true});
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Unsafe storage directory');
    const root = await realpath(current);
    current = root;
    for (const part of parts) {
      current = join(current, part);
      await mkdir(current, {recursive: true});
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Unsafe storage directory');
      const actual = await realpath(current);
      if (relative(root, actual).startsWith('..') || isAbsolute(relative(root, actual))) throw new Error('Unsafe storage path');
    }
    return current;
  }
  async initialize(): Promise<void> { for (const name of ['originals', 'working', 'temp', 'exports']) await this.directory([name]); }
  private async path(projectId: string, id: string, extension?: string): Promise<string> {
    if (!uuid(projectId) || !uuid(id) || (extension && !['mp4','mov','m4v'].includes(extension))) throw new Error('Invalid storage identity');
    const directory = await this.directory([extension ? 'originals' : 'temp', projectId]);
    // Runtime media is operator-managed data, never a build/deployment asset.
    const path = join(/* turbopackIgnore: true */ directory, `${id}.${extension ?? 'part'}`);
    try { if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error('Unsafe storage object'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return path;
  }
  async append(projectId: string, id: string, offset: number, remaining: number, stream: Readable): Promise<number> {
    const path = await this.path(projectId, id);
    let file;
    try { file = await open(path, 'wx+'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; file = await open(path, 'r+'); }
    try {
      if ((await file.stat()).size < offset) throw new UploadError('Upload storage is incomplete. Start a new upload.', 409);
      await file.truncate(offset); // Discard an uncommitted chunk left by a failed request.
      let count = 0;
      const handle = file;
      const destination = new Writable({write(chunk: Buffer, _encoding, callback) {
        if (count + chunk.length > Math.min(CHUNK_BYTES, remaining)) { callback(new UploadError('Upload chunk exceeds its reserved size.', 413)); return; }
        const start = offset + count;
        count += chunk.length;
        void (async () => {
          let written = 0;
          while (written < chunk.length) {
            const result = await handle.write(chunk,written,chunk.length-written,start+written);
            if (!result.bytesWritten) throw new Error('Storage write stopped');
            written += result.bytesWritten;
          }
        })().then(() => callback(), error => callback(error));
      }});
      await pipeline(stream, destination, {signal: AbortSignal.timeout(30_000)});
      if (!count) throw new UploadError('Upload chunk is empty.');
      await file.sync();
      return count;
    } catch (error) { await file.truncate(offset); throw error; }
    finally { await file.close(); }
  }
  async validate(projectId: string, id: string, size: number): Promise<void> {
    const file = await open(await this.path(projectId, id), 'r');
    try {
      if ((await file.stat()).size !== size) throw new UploadError('The upload is incomplete. Retry the remaining data.', 409);
      const header = Buffer.alloc(Math.min(size, 65536));
      await file.read(header, 0, header.length, 0);
      // Bounded container identification only; no codec or duration claims.
      let position = 0;
      while (position + 16 <= header.length) {
        const length = header.readUInt32BE(position);
        const type = header.toString('ascii', position + 4, position + 8);
        if (length < 8 || position + length > header.length) break;
        if (type === 'ftyp' && length >= 16) {
          const brands = [header.toString('ascii', position + 8, position + 12)];
          for (let i = position + 16; i + 4 <= position + length; i += 4) brands.push(header.toString('ascii', i, i + 4));
          if (brands.some(brand => ['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1','qt  ','M4V ','M4VH','M4VP','MSNV'].includes(brand))) return;
          break;
        }
        position += length;
      }
      throw new UploadError('The file does not have a supported MP4, MOV, or M4V container header.', 415);
    } finally { await file.close(); }
  }
  async publish(projectId: string, id: string, extension: string): Promise<string> {
    const source = await this.path(projectId, id);
    const destination = await this.path(projectId, id, extension);
    try { await link(source, destination); } // Atomic, same-volume, never overwrites.
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const [a,b] = await Promise.all([lstat(source), lstat(destination)]);
      if (a.ino !== b.ino || a.dev !== b.dev) throw new Error('Storage collision', {cause: error});
    }
    return `${projectId}/${id}.${extension}`;
  }
  async removeTemporary(projectId: string, id: string): Promise<void> { await this.remove(await this.path(projectId, id)); }
  async removePublished(projectId: string, id: string, extension: string): Promise<void> { await this.remove(await this.path(projectId, id, extension)); }
  async discard(projectId: string, id: string, extension: string): Promise<void> {
    const source = await this.path(projectId,id);
    const destination = await this.path(projectId,id,extension);
    const target = await lstat(destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    });
    if (target) {
      // Never remove an unrelated file that happened to collide with the generated key.
      const temp = await lstat(source);
      if (temp.ino !== target.ino || temp.dev !== target.dev) throw new Error('Cleanup collision');
      await this.remove(destination);
    }
    await this.removeTemporary(projectId, id);
  }
  private async remove(path: string): Promise<void> {
    try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async checksum(projectId: string, id: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(await this.path(projectId, id))) hash.update(chunk);
    return hash.digest('hex');
  }
}
export type UploadStorage = Pick<LocalMediaStorage, 'initialize' | 'append' | 'validate' | 'checksum' | 'publish' | 'removeTemporary' | 'removePublished' | 'discard'>;
