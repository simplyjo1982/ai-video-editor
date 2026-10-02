import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { UploadError } from '@ai-video-editor/media';
import { uploads, verifyUploadOrigin, uploadFailure } from '../../../../../../lib/uploads';
export const runtime = 'nodejs';
type Context = {params: Promise<{projectId: string; uploadId: string}>};
export async function PUT(request: Request, {params}: Context): Promise<Response> {
  let stream: Readable | undefined;
  try {
    verifyUploadOrigin(request);
    if (!request.body || request.headers.get('content-type') !== 'application/octet-stream') throw new UploadError('Invalid upload data.', 415);
    const offset = request.headers.get('upload-offset');
    if (!offset || !/^\d+$/.test(offset)) throw new UploadError('Invalid upload position.');
    const {projectId,uploadId} = await params;
    stream = Readable.fromWeb(request.body as ReadableStream<Uint8Array>);
    const result = await uploads().append(projectId,uploadId,Number(offset),stream);
    return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) { return uploadFailure(error); }
  finally { stream?.destroy(); }
}
export async function POST(request: Request, {params}: Context): Promise<Response> {
  try {
    verifyUploadOrigin(request);
    const {projectId,uploadId} = await params;
    return Response.json(await uploads().finalize(projectId,uploadId), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) { return uploadFailure(error); }
}
