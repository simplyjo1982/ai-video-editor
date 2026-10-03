import { enqueueTechnical } from '@ai-video-editor/db';
import { technicalConfig, technicalToolchainVersion } from '@ai-video-editor/media';
import { getDatabase } from '../../../../../../../lib/database';
import { isLocalHost } from '../../../../../../../lib/local-access';

export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;assetId:string}>}):Promise<Response>{
  const host=request.headers.get('host');
  let origin:URL;
  try{origin=new URL(request.headers.get('origin')??'');}catch{return new Response('Open the local application to start processing.',{status:403});}
  if(!isLocalHost(host)||origin.host!==host||origin.protocol!=='http:')return new Response('Open the local application to start processing.',{status:403});
  const {projectId,assetId}=await params;
  try{
    const pool=getDatabase(); // Loads private root .env before technical configuration is read.
    const config=technicalConfig();
    await enqueueTechnical(pool,projectId,assetId,config,await technicalToolchainVersion(config));
    return new Response(null,{status:303,headers:{Location:`/projects/${projectId}/media/${assetId}/technical`,'Cache-Control':'no-store'}});
  }catch{
    return new Response('Technical processing could not be queued. Check local configuration and retry.',{status:503});
  }
}
