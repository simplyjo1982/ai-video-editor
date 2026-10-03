import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PreparedTechnical, SourceMetadata, TechnicalConfig } from '@ai-video-editor/media';
import { TechnicalError, uuid } from '@ai-video-editor/media';
import { LOCAL_OWNER_ID } from './projects.js';

export const TECHNICAL_JOB_TYPE='technical_media';
const LEASE_SECONDS=30;
export interface TechnicalJob {id:string;project_id:string;media_asset_id:string;attempt_count:number;max_attempts:number;lease_token:string;status:string;idempotency_key:string|null}
export interface TechnicalAsset {id:string;project_id:string;storage_path:string;storage_namespace:string;original_filename:string;media_type:string;file_size_bytes:string;original_sha256:string|null;status:string}
export interface TechnicalRun {id:string;cacheKey:string}
export interface TechnicalMetadataView {
  id:string;source_duration_ms:string;working_duration_ms:string;working_frame_count:number;
  coded_width:number;coded_height:number;display_width:number;display_height:number;
  working_width:number;working_height:number;video_codec:string;codec_profile:string|null;
  average_frame_rate_num:number|null;average_frame_rate_den:number|null;
  audio_stream_count:number;audio_codec:string|null;rotation_degrees:number|null;rate_mode:string;
}
export interface TechnicalInspection {
  asset:TechnicalAsset & {duration_ms:string|null;width:number|null;height:number|null;codec:string|null;current_technical_run_id:string|null};
  jobStatus:string|null;metadata:TechnicalMetadataView|null;
  segments:Array<{id:string;segment_index:number;start_ms:string;end_ms:string;segmentation_method:string;
    working_frame_index:number|null;representative_frame_id:string|null}>;
}
async function transaction<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
function configSnapshot(config:TechnicalConfig):Record<string,unknown>{
  return {version:config.version,maxFileDurationMs:config.maxFileDurationMs,maxProjectDurationMs:config.maxProjectDurationMs,
    maxEdge:config.maxEdge,maxWorkingBytes:config.maxWorkingBytes,sceneThreshold:config.sceneThreshold,
    maxSegmentFrames:config.maxSegmentFrames,maxFramesPerAsset:config.maxFramesPerAsset};
}
export function technicalConfigHash(config:TechnicalConfig,toolchain:string):string{
  return createHash('sha256').update(JSON.stringify({config:configSnapshot(config),toolchain})).digest('hex');
}
export function technicalCacheKey(sourceSha256:string,config:TechnicalConfig,toolchain:string):string{
  return createHash('sha256').update(JSON.stringify({sourceSha256,config:configSnapshot(config),toolchain})).digest('hex');
}
export async function enqueueTechnical(pool:Pool,projectId:string,assetId:string,config:TechnicalConfig,toolchain:string):Promise<{status:string;jobId:string|null}>{
  if(!uuid(projectId)||!uuid(assetId)) throw new Error('Media asset not found.');
  if(!toolchain||toolchain.length>1000)throw new Error('Invalid technical toolchain identity.');
  const key=`technical:${assetId}:${technicalConfigHash(config,toolchain)}`;
  return transaction(pool,async db=>{
    const asset=(await db.query<TechnicalAsset>(`SELECT m.* FROM media_assets m JOIN projects p ON p.id=m.project_id
      WHERE m.project_id=$1 AND m.id=$2 AND p.owner_id=$3 FOR UPDATE OF m`,[projectId,assetId,LOCAL_OWNER_ID])).rows[0];
    if(!asset) throw new Error('Media asset not found.');
    if(!['uploaded','ready','failed','partial'].includes(asset.status)) throw new Error('Media asset is not available for technical processing.');
    const prior=(await db.query<{id:string;status:string}>(`SELECT id,status FROM jobs WHERE project_id=$1 AND idempotency_key=$2 FOR UPDATE`,[projectId,key])).rows[0];
    if(prior){
      if(prior.status==='failed'){
        await db.query(`UPDATE jobs SET status='queued',attempt_count=0,available_at=now(),last_error=NULL,
          locked_at=NULL,locked_by=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL WHERE id=$1`,[prior.id]);
        await db.query("UPDATE media_assets SET status='uploaded',technical_error=NULL WHERE id=$1",[assetId]);
        return {status:'queued',jobId:prior.id};
      }
      return {status:prior.status,jobId:prior.id};
    }
    const job=(await db.query<{id:string}>(`INSERT INTO jobs(project_id,media_asset_id,job_type,max_attempts,idempotency_key,config_snapshot)
      VALUES($1,$2,$3,3,$4,$5) RETURNING id`,[projectId,assetId,TECHNICAL_JOB_TYPE,key,configSnapshot(config)])).rows[0]!;
    await db.query('UPDATE projects SET updated_at=now() WHERE id=$1',[projectId]);
    return {status:'queued',jobId:job.id};
  });
}
export async function claimTechnicalJob(pool:Pool,workerId:string):Promise<TechnicalJob|null>{
  return transaction(pool,async db=>{
    const exhausted=await db.query<{media_asset_id:string}>(`UPDATE jobs SET status='failed',last_error='retry_limit',locked_at=NULL,locked_by=NULL,
      lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL
      WHERE job_type=$1 AND status='running' AND lease_expires_at<now() AND attempt_count>=max_attempts
      RETURNING media_asset_id`,[TECHNICAL_JOB_TYPE]);
    for(const row of exhausted.rows){
      await db.query("UPDATE media_assets SET status='failed',technical_error='retry_limit' WHERE id=$1",[row.media_asset_id]);
    }
    const candidate=(await db.query<TechnicalJob>(`SELECT * FROM jobs WHERE job_type=$1 AND media_asset_id IS NOT NULL AND
      ((status IN ('queued','retry_wait') AND available_at<=now()) OR (status='running' AND lease_expires_at<now()))
      AND attempt_count<max_attempts ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[TECHNICAL_JOB_TYPE])).rows[0];
    if(!candidate)return null;
    const token=randomUUID();
    const job=(await db.query<TechnicalJob>(`UPDATE jobs SET status='running',attempt_count=attempt_count+1,
      locked_at=now(),locked_by=$2,lease_token=$3,lease_expires_at=now()+$4*interval '1 second',heartbeat_at=now(),last_error=NULL
      WHERE id=$1 RETURNING *`,[candidate.id,workerId,token,LEASE_SECONDS])).rows[0]!;
    await db.query(`UPDATE analysis_runs SET status='failed',error_code='lease_expired',completed_at=now()
      WHERE job_id=$1 AND status='running'`,[job.id]);
    await db.query("UPDATE media_assets SET status='analyzing',technical_error=NULL WHERE id=$1",[job.media_asset_id]);
    return job;
  });
}
export async function heartbeatTechnicalJob(pool:Pool,job:TechnicalJob):Promise<boolean>{
  const result=await pool.query(`UPDATE jobs SET heartbeat_at=now(),lease_expires_at=now()+$3*interval '1 second'
    WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now()`,[job.id,job.lease_token,LEASE_SECONDS]);
  return result.rowCount===1;
}
export async function getTechnicalJobAsset(pool:Pool,job:TechnicalJob):Promise<TechnicalAsset>{
  const row=(await pool.query<TechnicalAsset>(`SELECT * FROM media_assets WHERE id=$1 AND project_id=$2`,[job.media_asset_id,job.project_id])).rows[0];
  if(!row)throw new Error('Technical media asset disappeared.');return row;
}
export async function recordOriginalChecksum(pool:Pool,job:TechnicalJob,checksum:string):Promise<void>{
  if(!/^[0-9a-f]{64}$/.test(checksum))throw new Error('Invalid source checksum.');
  await transaction(pool,async db=>{
    const current=(await db.query<{original_sha256:string|null}>(`SELECT original_sha256 FROM media_assets
      WHERE id=$1 AND project_id=$2 FOR UPDATE`,[job.media_asset_id,job.project_id])).rows[0];
    if(!current||current.original_sha256&&current.original_sha256!==checksum)throw new Error('Original checksum changed.');
    const reservation=(await db.query<{content_sha256:string|null}>(`SELECT content_sha256 FROM upload_reservations WHERE id=$1`,[job.media_asset_id])).rows[0];
    if(reservation?.content_sha256&&reservation.content_sha256!==checksum)throw new Error('Original checksum differs from upload receipt.');
    await db.query('UPDATE media_assets SET original_sha256=$2 WHERE id=$1',[job.media_asset_id,checksum]);
  });
}
export async function admitTechnicalDuration(pool:Pool,job:TechnicalJob,source:SourceMetadata,config:TechnicalConfig):Promise<void>{
  await transaction(pool,async db=>{
    await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[job.project_id]);
    const result=await db.query<{used:string}>(`SELECT COALESCE(sum(admitted_duration_ms),0)::text AS used FROM media_assets
      WHERE project_id=$1 AND id<>$2 AND status<>'rejected'`,[job.project_id,job.media_asset_id]);
    if(Number(result.rows[0]!.used)+source.sourceDurationMs>config.maxProjectDurationMs)throw new Error('Project footage duration limit exceeded.');
    await db.query(`UPDATE media_assets SET admitted_duration_ms=$2 WHERE id=$1`,[job.media_asset_id,source.sourceDurationMs]);
  });
}
export async function findCachedTechnicalRun(pool:Pool,assetId:string,cacheKey:string):Promise<string|null>{
  const row=(await pool.query<{id:string}>(`SELECT id FROM analysis_runs WHERE media_asset_id=$1 AND analysis_type='technical_media'
    AND cache_key=$2 AND status='succeeded' ORDER BY revision DESC LIMIT 1`,[assetId,cacheKey])).rows[0];
  return row?.id??null;
}
export async function cachedRunArtifacts(pool:Pool,runId:string):Promise<Array<{storage_path:string;sha256:string;byte_size:string;storage_namespace:string}>>{
  return (await pool.query(`SELECT storage_path,sha256,byte_size,storage_namespace FROM artifacts
    WHERE producing_run_id=$1 AND state='ready'`,[runId])).rows;
}
export async function completeCachedTechnicalJob(pool:Pool,job:TechnicalJob,runId:string):Promise<void>{
  await transaction(pool,async db=>{
    const current=(await db.query<{id:string}>(`SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running'
      AND lease_expires_at>now() FOR UPDATE`,[job.id,job.lease_token])).rows[0];
    if(!current)throw new Error('Technical job lease expired.');
    await db.query(`UPDATE jobs SET status='succeeded',result_run_id=$2,locked_at=NULL,locked_by=NULL,
      lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL WHERE id=$1`,[job.id,runId]);
    await db.query(`UPDATE media_assets SET status='ready',current_technical_run_id=$2,technical_error=NULL WHERE id=$1`,[job.media_asset_id,runId]);
  });
}
export async function startTechnicalRun(pool:Pool,job:TechnicalJob,checksum:string,cacheKey:string,
  config:TechnicalConfig,toolchain:string):Promise<TechnicalRun>{
  return transaction(pool,async db=>{
    const current=(await db.query<{id:string}>(`SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running'
      AND lease_expires_at>now() FOR UPDATE`,[job.id,job.lease_token])).rows[0];
    if(!current)throw new Error('Technical job lease expired.');
    await db.query('SELECT id FROM media_assets WHERE id=$1 FOR UPDATE',[job.media_asset_id]);
    const revision=(await db.query<{revision:number}>(`SELECT COALESCE(MAX(revision),0)+1 AS revision FROM analysis_runs
      WHERE media_asset_id=$1 AND analysis_type='technical_media'`,[job.media_asset_id])).rows[0]!.revision;
    const run=(await db.query<{id:string}>(`INSERT INTO analysis_runs(project_id,media_asset_id,analysis_type,status,revision,pipeline_version,
      input_hash,cache_key,job_id,config_snapshot,toolchain)
      VALUES($1,$2,'technical_media','running',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [job.project_id,job.media_asset_id,revision,config.version,checksum,cacheKey,job.id,configSnapshot(config),JSON.stringify({ffmpeg:toolchain})])).rows[0]!;
    return {id:run.id,cacheKey};
  });
}
function metadataRecord(job:TechnicalJob,run:TechnicalRun,source:SourceMetadata,prepared:PreparedTechnical,
  originalId:string,workingId:string,mapId:string,config:TechnicalConfig):Record<string,unknown>{
  return {id:randomUUID(),project_id:job.project_id,media_asset_id:job.media_asset_id,run_id:run.id,
    original_artifact_id:originalId,working_artifact_id:workingId,timing_map_artifact_id:mapId,
    source_duration_ms:source.sourceDurationMs,working_duration_ms:prepared.workingDurationMs,
    working_frame_count:prepared.workingFrameCount,coded_width:source.codedWidth,coded_height:source.codedHeight,
    display_width:source.displayWidth,display_height:source.displayHeight,
    working_width:prepared.workingWidth,working_height:prepared.workingHeight,
    sample_aspect_ratio:source.sampleAspectRatio,display_aspect_ratio:source.displayAspectRatio,
    nominal_frame_rate_num:source.nominalRate?.num??null,nominal_frame_rate_den:source.nominalRate?.den??null,
    average_frame_rate_num:source.averageRate?.num??null,average_frame_rate_den:source.averageRate?.den??null,
    video_codec:source.videoCodec,codec_profile:source.codecProfile,pixel_format:source.pixelFormat,
    bitrate:source.bitrate,container_format:source.containerFormat,video_stream_count:source.videoStreamCount,
    audio_stream_count:source.audioStreamCount,selected_video_stream_index:source.videoStreamIndex,
    selected_audio_stream_index:source.audioStreamIndex,audio_codec:source.audioCodec,
    audio_sample_rate:source.audioSampleRate,audio_channels:source.audioChannels,rotation_degrees:source.rotationDegrees,
    source_start_pts:source.sourceStartPts,source_time_base_num:source.sourceTimeBase?.num??null,
    source_time_base_den:source.sourceTimeBase?.den??null,audio_start_pts:source.audioStartPts,
    audio_time_base_num:source.audioTimeBase?.num??null,audio_time_base_den:source.audioTimeBase?.den??null,
    rate_mode:source.rateMode,rate_mode_method:source.rateModeMethod,duration_derivation:source.durationDerivation,
    normalization_profile:config.version,probe_evidence:JSON.stringify(source.probeEvidence),warnings:JSON.stringify(source.warnings)};
}
async function insertMetadata(db:PoolClient,record:Record<string,unknown>):Promise<void>{
  const columns=Object.keys(record);
  const values=columns.map(column=>record[column]);
  await db.query(`INSERT INTO media_metadata(${columns.join(',')}) VALUES(${columns.map((_,i)=>`$${i+1}`).join(',')})`,values);
}
export async function publishTechnicalRun(pool:Pool,job:TechnicalJob,run:TechnicalRun,source:SourceMetadata,
  prepared:PreparedTechnical,config:TechnicalConfig,original:{storagePath:string;sha256:string;byteSize:number;mediaType:string}):Promise<void>{
  await transaction(pool,async db=>{
    const current=(await db.query<{id:string}>(`SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running'
      AND lease_expires_at>now() FOR UPDATE`,[job.id,job.lease_token])).rows[0];
    if(!current)throw new Error('Technical job lease expired.');
    await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[job.project_id]);
    const used=(await db.query<{bytes:string}>(`SELECT COALESCE(sum(byte_size),0)::text AS bytes FROM artifacts
      WHERE project_id=$1 AND storage_namespace='working' AND state='ready'`,[job.project_id])).rows[0]!;
    const pending=prepared.artifacts.reduce((total,item)=>total+item.byteSize,0);
    if(BigInt(used.bytes)+BigInt(pending)>BigInt(config.maxWorkingBytes))
      throw new TechnicalError('working_storage_limit','Project working-media storage limit exceeded.');
    const originalId=randomUUID();
    await db.query(`INSERT INTO artifacts(id,project_id,media_asset_id,producing_job_id,artifact_class,storage_namespace,
      storage_path,sha256,byte_size,media_type,profile_version)
      VALUES($1,$2,$3,$4,'original','originals',$5,$6,$7,$8,'upload-v1')`,
      [originalId,job.project_id,job.media_asset_id,job.id,original.storagePath,original.sha256,original.byteSize,original.mediaType]);
    const artifactIds=new Map<string,string>();
    for(const artifact of prepared.artifacts){
      const id=randomUUID();artifactIds.set(artifact.logicalPath,id);
      await db.query(`INSERT INTO artifacts(id,project_id,media_asset_id,producing_run_id,producing_job_id,
        artifact_class,storage_namespace,storage_path,sha256,byte_size,media_type,profile_version)
        VALUES($1,$2,$3,$4,$5,$6,'working',$7,$8,$9,$10,$11)`,
        [id,job.project_id,job.media_asset_id,run.id,job.id,artifact.artifactClass,artifact.logicalPath,
          artifact.sha256,artifact.byteSize,artifact.mediaType,artifact.profileVersion]);
    }
    const working=prepared.artifacts.find(a=>a.artifactClass==='working_video')!;
    const map=prepared.artifacts.find(a=>a.artifactClass==='timing_map')!;
    await insertMetadata(db,metadataRecord(job,run,source,prepared,originalId,artifactIds.get(working.logicalPath)!,artifactIds.get(map.logicalPath)!,config));
    const segmentIds=new Map<number,string>();
    for(const segment of prepared.segments){
      const id=randomUUID();segmentIds.set(segment.index,id);
      await db.query(`INSERT INTO temporal_segments(id,project_id,media_asset_id,run_id,working_artifact_id,
        segment_index,start_frame,end_frame,start_ms,end_ms,segmentation_method,segmentation_version,boundary_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id,job.project_id,job.media_asset_id,run.id,artifactIds.get(working.logicalPath),segment.index,
          segment.startFrame,segment.endFrame,segment.startMs,segment.endMs,segment.method,config.version,segment.boundaryReason]);
    }
    for(const frame of prepared.frames){
      const segment=prepared.segments[frame.segmentIndex]!;
      if(frame.frameIndex<segment.startFrame||frame.frameIndex>=segment.endFrame)throw new Error('Frame falls outside segment.');
      await db.query(`INSERT INTO representative_frames(project_id,media_asset_id,run_id,segment_id,image_artifact_id,
        working_frame_index,timestamp_ms,source_pts,source_time_base_num,source_time_base_den,width,height,
        extraction_method,extraction_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [job.project_id,job.media_asset_id,run.id,segmentIds.get(frame.segmentIndex),artifactIds.get(frame.artifact.logicalPath),
          frame.frameIndex,frame.timestampMs,frame.sourcePts,source.sourceTimeBase?.num??null,
          source.sourceTimeBase?.den??null,frame.width,frame.height,'midpoint',config.version]);
    }
    await db.query(`UPDATE analysis_runs SET status='succeeded',completed_at=now(),coverage=$2 WHERE id=$1`,
      [run.id,JSON.stringify({segment_count:prepared.segments.length,representative_frame_count:prepared.frames.length,
        scene_candidate_count:prepared.sceneCandidateCount,working_frame_count:prepared.workingFrameCount})]);
    await db.query(`UPDATE media_assets SET status='ready',current_technical_run_id=$2,duration_ms=$3,width=$4,height=$5,
      codec=$6,technical_error=NULL WHERE id=$1`,
      [job.media_asset_id,run.id,prepared.workingDurationMs,prepared.workingWidth,prepared.workingHeight,source.videoCodec]);
    await db.query(`UPDATE jobs SET status='succeeded',result_run_id=$2,locked_at=NULL,locked_by=NULL,lease_token=NULL,
      lease_expires_at=NULL,heartbeat_at=NULL WHERE id=$1`,[job.id,run.id]);
    await db.query('UPDATE projects SET updated_at=now() WHERE id=$1',[job.project_id]);
  });
}
export async function failTechnicalJob(pool:Pool,job:TechnicalJob,runId:string|null,code:string):Promise<void>{
  const safe=/^[a-z_]{1,50}$/.test(code)?code:'processing_failed';
  await transaction(pool,async db=>{
    const current=(await db.query<{attempt_count:number;max_attempts:number}>(`SELECT attempt_count,max_attempts FROM jobs
      WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE`,[job.id,job.lease_token])).rows[0];
    if(!current)return;
    if(runId)await db.query(`UPDATE analysis_runs SET status='failed',error_code=$2,completed_at=now()
      WHERE id=$1 AND status='running'`,[runId,safe]);
    const final=current.attempt_count>=current.max_attempts;
    await db.query(`UPDATE jobs SET status=$2,last_error=$3,available_at=now()+$4*interval '1 second',
      locked_at=NULL,locked_by=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL WHERE id=$1`,
      [job.id,final?'failed':'retry_wait',safe,final?0:Math.min(30,2**current.attempt_count)]);
    await db.query(`UPDATE media_assets SET status=$2,technical_error=$3 WHERE id=$1`,
      [job.media_asset_id,final?'failed':'uploaded',safe]);
  });
}
export async function latestTechnicalStates(pool:Pool,projectId:string):Promise<Map<string,string>>{
  const rows=(await pool.query<{media_asset_id:string;status:string}>(`SELECT DISTINCT ON (media_asset_id) media_asset_id,status
    FROM jobs WHERE project_id=$1 AND job_type='technical_media' ORDER BY media_asset_id,created_at DESC,id DESC`,[projectId])).rows;
  return new Map(rows.map(row=>[row.media_asset_id,row.status]));
}
export async function listTechnicalMetadata(pool:Pool,projectId:string):Promise<Map<string,TechnicalMetadataView>>{
  const rows=(await pool.query<TechnicalMetadataView & {media_asset_id:string}>(`SELECT m.* FROM media_metadata m
    JOIN media_assets a ON a.id=m.media_asset_id AND a.current_technical_run_id=m.run_id
    JOIN projects p ON p.id=a.project_id WHERE a.project_id=$1 AND p.owner_id=$2`,[projectId,LOCAL_OWNER_ID])).rows;
  return new Map(rows.map(row=>[row.media_asset_id,row]));
}
export async function getTechnicalInspection(pool:Pool,projectId:string,assetId:string):Promise<TechnicalInspection|null>{
  if(!uuid(projectId)||!uuid(assetId))return null;
  const asset=(await pool.query<TechnicalInspection['asset']>(`SELECT m.* FROM media_assets m JOIN projects p ON p.id=m.project_id
    WHERE m.project_id=$1 AND m.id=$2 AND p.owner_id=$3`,[projectId,assetId,LOCAL_OWNER_ID])).rows[0];
  if(!asset)return null;
  const status=(await pool.query<{status:string}>(`SELECT status FROM jobs WHERE media_asset_id=$1 AND job_type='technical_media'
    ORDER BY created_at DESC,id DESC LIMIT 1`,[assetId])).rows[0]?.status??null;
  const metadata=asset.current_technical_run_id?(await pool.query<TechnicalMetadataView>(`SELECT * FROM media_metadata WHERE run_id=$1`,[asset.current_technical_run_id])).rows[0]??null:null;
  const segments=asset.current_technical_run_id?(await pool.query<TechnicalInspection['segments'][number]>(`SELECT s.id,s.segment_index,s.start_ms,s.end_ms,s.segmentation_method,
    f.working_frame_index,f.id AS representative_frame_id FROM temporal_segments s
    LEFT JOIN representative_frames f ON f.segment_id=s.id WHERE s.run_id=$1 ORDER BY s.segment_index`,
    [asset.current_technical_run_id])).rows:[];
  return {asset,jobStatus:status,metadata,segments};
}
export async function getFrameArtifact(pool:Pool,projectId:string,assetId:string,frameId:string):Promise<{storage_path:string;sha256:string;byte_size:string}|null>{
  if(!uuid(projectId)||!uuid(assetId)||!uuid(frameId))return null;
  return (await pool.query<{storage_path:string;sha256:string;byte_size:string}>(`SELECT a.storage_path,a.sha256,a.byte_size
    FROM representative_frames f JOIN artifacts a ON a.id=f.image_artifact_id
    JOIN media_assets m ON m.id=f.media_asset_id AND m.current_technical_run_id=f.run_id
    JOIN projects p ON p.id=f.project_id WHERE f.project_id=$1 AND f.media_asset_id=$2 AND f.id=$3
    AND p.owner_id=$4 AND a.state='ready'`,[projectId,assetId,frameId,LOCAL_OWNER_ID])).rows[0]??null;
}
