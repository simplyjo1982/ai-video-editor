import { createProject, ProjectNameError } from '@ai-video-editor/db';
import { getDatabase } from '../../../lib/database';
import { isLocalHost } from '../../../lib/local-access';

export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get('host');
  let origin: URL;
  try { origin = new URL(request.headers.get('origin') ?? ''); }
  catch { return new Response('Open the local application to create a project.', {status: 403}); }
  if (!isLocalHost(host) || origin.host !== host || origin.protocol !== 'http:') {
    return new Response('Open the local application to create a project.', {status: 403});
  }
  // Native forms use URL encoding. Bound the body before parsing untrusted input.
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Use the project creation form.', {status: 415});
  }
  const reader = request.body?.getReader();
  let text = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    if (reader) while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return new Response('Project name is too long.', {status: 413}); }
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    const project = await createProject(getDatabase(), new URLSearchParams(text).get('name'));
    return new Response(null, {status: 303, headers: {Location: `/projects/${project.id}`, 'Cache-Control': 'no-store'}});
  } catch (error) {
    const reason = error instanceof ProjectNameError ? 'invalid' : 'unavailable';
    return new Response(null, {status: 303, headers: {Location: `/projects/new?error=${reason}`, 'Cache-Control': 'no-store'}});
  }
}
