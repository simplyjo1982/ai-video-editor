import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { getFrameArtifact } from '@ai-video-editor/db';
import { getDatabase } from '../../../../../../../../lib/database';
import { isLocalHost } from '../../../../../../../../lib/local-access';

export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;assetId:string;frameId:string}>}):Promise<Response>{
  if(!isLocalHost(request.headers.get('host')))return new Response('Not found',{status:404});
  const {projectId,assetId,frameId}=await params;
  try{
    const artifact=await getFrameArtifact(getDatabase(),projectId,assetId,frameId);
    const root=process.env.MEDIA_ROOT;
    if(!artifact||!root||!isAbsolute(root)||!/^[-a-z0-9/_.]+$/i.test(artifact.storage_path)||artifact.storage_path.includes('..'))return new Response('Not found',{status:404});
    const actualRoot=await realpath(root);
    const candidate=resolve(actualRoot,'working',...artifact.storage_path.split('/'));
    const actual=await realpath(candidate);
    const rel=relative(actualRoot,actual);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||(await stat(actual)).size>10_000_000)return new Response('Not found',{status:404});
    const bytes=await readFile(actual);
    if(bytes.length!==Number(artifact.byte_size)||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)return new Response('Not found',{status:404});
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Not found',{status:404});}
}
