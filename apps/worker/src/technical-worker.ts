import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabasePool, claimTechnicalJob, heartbeatTechnicalJob, getTechnicalJobAsset,
  recordOriginalChecksum, admitTechnicalDuration, findCachedTechnicalRun, cachedRunArtifacts,
  completeCachedTechnicalJob, startTechnicalRun, publishTechnicalRun, failTechnicalJob,
  technicalCacheKey, technicalConfigHash, type TechnicalJob } from '@ai-video-editor/db';
import { technicalConfig, technicalToolchainVersion, resolveOriginal, fileDigest, probeSource, prepareTechnical,
  publishTechnicalFiles, cleanupTechnicalAttempt, TechnicalError,
  type TechnicalConfig } from '@ai-video-editor/media';

type Pool=ReturnType<typeof createDatabasePool>;
function isWithin(root:string,path:string):boolean {const rel=relative(root,path);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}
async function validCachedArtifacts(pool:Pool,root:string,runId:string):Promise<boolean>{
  const artifacts=await cachedRunArtifacts(pool,runId);
  if(artifacts.length<3)return false;
  const actualRoot=await realpath(root);
  for(const item of artifacts){
    if(item.storage_namespace!=='originals'&&item.storage_namespace!=='working')return false;
    if(!/^[0-9a-z._/-]+$/i.test(item.storage_path)||item.storage_path.includes('..'))return false;
    const path=resolve(actualRoot,item.storage_namespace,...item.storage_path.split('/'));
    if(!isWithin(actualRoot,path))return false;
    try {
      if(!isWithin(actualRoot,await realpath(path)))return false;
      const digest=await fileDigest(path);
      if(digest.sha256!==item.sha256||digest.byteSize!==Number(item.byte_size))return false;
    }catch{return false;}
  }
  return true;
}
async function runJob(pool:Pool,job:TechnicalJob,config:TechnicalConfig,
  root:string,toolchain:string,signal:AbortSignal):Promise<void>{
  let runId:string|null=null;
  let prepared:Awaited<ReturnType<typeof prepareTechnical>>|null=null;
  try{
    if(job.idempotency_key!==`technical:${job.media_asset_id}:${technicalConfigHash(config,toolchain)}`)
      throw new TechnicalError('config_changed','Technical configuration changed after this job was queued.');
    const asset=await getTechnicalJobAsset(pool,job);
    if(asset.storage_namespace!=='originals')throw new TechnicalError('unsafe_original','Original storage namespace is invalid.');
    const original=await resolveOriginal(root,job.project_id,asset.id,asset.storage_path);
    const digest=await fileDigest(original);
    if(digest.byteSize!==Number(asset.file_size_bytes))throw new TechnicalError('source_changed','Original file size differs from upload record.');
    await recordOriginalChecksum(pool,job,digest.sha256);
    const source=await probeSource(original,config,signal);
    await admitTechnicalDuration(pool,job,source,config);
    const cacheKey=technicalCacheKey(digest.sha256,config,toolchain);
    const cached=await findCachedTechnicalRun(pool,asset.id,cacheKey);
    if(cached&&await validCachedArtifacts(pool,root,cached)){
      await completeCachedTechnicalJob(pool,job,cached);
      console.log(`[worker] Reused technical analysis for asset ${asset.id}.`);
      return;
    }
    const run=await startTechnicalRun(pool,job,digest.sha256,cacheKey,config,toolchain);
    runId=run.id;
    prepared=await prepareTechnical({root,projectId:job.project_id,assetId:asset.id,jobId:job.id,
      leaseToken:job.lease_token,cacheKey,original,source,config,signal});
    const derivativeBytes=prepared.artifacts.reduce((total,item)=>total+item.byteSize,0);
    if(derivativeBytes>config.maxWorkingBytes)throw new TechnicalError('working_storage_limit','Working artifacts exceed configured storage limit.');
    if(signal.aborted||!await heartbeatTechnicalJob(pool,job))throw new TechnicalError('lease_expired','Technical job lease expired.');
    await publishTechnicalFiles(root,prepared);
    await publishTechnicalRun(pool,job,run,source,prepared,config,
      {storagePath:asset.storage_path,sha256:digest.sha256,byteSize:digest.byteSize,mediaType:asset.media_type});
    console.log(`[worker] Technical analysis ready: asset=${asset.id} duration_ms=${prepared.workingDurationMs}`+
      ` segments=${prepared.segments.length} frames=${prepared.frames.length} processing_ms=${prepared.processingMs}`+
      ` working_bytes=${derivativeBytes}.`);
  }catch(error){
    const code=error instanceof TechnicalError?error.code:'processing_failed';
    await failTechnicalJob(pool,job,runId,code).catch(()=>undefined);
    console.error(`[worker] Technical analysis attempt failed: asset=${job.media_asset_id} code=${code}.`);
  }finally{if(prepared)await cleanupTechnicalAttempt(prepared).catch(()=>undefined);}
}

export async function startTechnicalWorker(pool:Pool):Promise<{stop:()=>void;done:Promise<void>}>{
  const config=technicalConfig();
  const root=process.env.MEDIA_ROOT;
  if(!root||!isAbsolute(root))throw new Error('MEDIA_ROOT must be an absolute directory');
  const toolchain=await technicalToolchainVersion(config);
  const workerId=`local-${randomUUID()}`;
  let stopping=false;let active:AbortController|null=null;
  const stop=()=>{stopping=true;active?.abort();};
  const done=(async()=>{
    while(!stopping){
      const job=await claimTechnicalJob(pool,workerId);
      if(job){
        const controller=new AbortController();active=controller;
        const heartbeat=setInterval(()=>{void heartbeatTechnicalJob(pool,job).then(ok=>{if(!ok)controller.abort();}).catch(()=>controller.abort());},5_000);
        try{await runJob(pool,job,config,root,toolchain,controller.signal);}
        finally{clearInterval(heartbeat);active=null;}
      }else await delay(1_000);
    }
  })();
  return {stop,done};
}
