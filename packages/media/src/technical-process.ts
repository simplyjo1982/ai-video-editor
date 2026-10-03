import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, realpath, readFile, writeFile, rename, link, stat, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TechnicalError, runTool, type SourceMetadata, type TechnicalConfig } from './technical-tools.js';
import { decimalSecondsToFrame, frameToMs, parseRational } from './timestamps.js';
import { planSegments, type PlannedSegment } from './segmentation.js';
import { uuid } from './uploads.js';

export interface PreparedArtifact {
  artifactClass:'working_video'|'timing_map'|'representative_frame';
  tempPath:string; logicalPath:string; sha256:string; byteSize:number; mediaType:string; profileVersion:string;
}
export interface PreparedFrame {segmentIndex:number; frameIndex:number; timestampMs:number; sourcePts:string|null; width:number;height:number;artifact:PreparedArtifact}
export interface PreparedTechnical {
  attemptDirectory:string; workingFrameCount:number; workingDurationMs:number; workingWidth:number;workingHeight:number;
  segments:PlannedSegment[];frames:PreparedFrame[];artifacts:PreparedArtifact[];
  sceneCandidateCount:number;processingMs:number;
}
function validHash(value:string):boolean {return /^[0-9a-f]{64}$/.test(value);}
function within(root:string,target:string):boolean {const rel=relative(root,target);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}
export async function resolveOriginal(root:string,projectId:string,assetId:string,logicalPath:string):Promise<string> {
  if(!root||!isAbsolute(root)||!uuid(projectId)||!uuid(assetId)||
     !new RegExp(`^${projectId}/${assetId}\\.(mp4|mov|m4v)$`,'i').test(logicalPath)) {
    throw new TechnicalError('unsafe_original','Original storage identity is invalid.');
  }
  const actualRoot=await realpath(root);
  const originals=await realpath(join(actualRoot,'originals'));
  let parent:string;
  try{parent=await realpath(join(originals,projectId));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new TechnicalError('missing_original','Original upload is missing.');throw error;}
  const file=join(parent,logicalPath.split('/')[1]!);
  let fileInfo;
  let actualFile:string;
  try{fileInfo=await lstat(file);actualFile=await realpath(file);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new TechnicalError('missing_original','Original upload is missing.');throw error;}
  if(!within(actualRoot,parent)||!within(actualRoot,file)||!within(originals,file)||
      fileInfo.isSymbolicLink()||!fileInfo.isFile()||actualFile!==file) {
    throw new TechnicalError('unsafe_original','Original media path is unsafe.');
  }
  return file;
}
export async function fileDigest(file:string):Promise<{sha256:string;byteSize:number}> {
  const hash=createHash('sha256'); let byteSize=0;
  for await(const chunk of createReadStream(file)){hash.update(chunk);byteSize+=chunk.length;}
  if(byteSize<=0||!Number.isSafeInteger(byteSize)) throw new TechnicalError('invalid_artifact','Generated artifact is empty or too large.');
  return {sha256:hash.digest('hex'),byteSize};
}
function targetDimensions(source:SourceMetadata,maxEdge:number):{width:number;height:number} {
  const long=Math.max(source.displayWidth,source.displayHeight);
  const factor=Math.min(1,maxEdge/long);
  const even=(v:number)=>Math.max(2,Math.floor(v*factor/2)*2);
  return {width:even(source.displayWidth),height:even(source.displayHeight)};
}
function sourceOriginSeconds(source:SourceMetadata):string {
  if(!source.sourceStartPts||!source.sourceTimeBase) throw new TechnicalError('inconsistent_timestamps','Video start PTS is unavailable.');
  const value=BigInt(source.sourceStartPts)*BigInt(source.sourceTimeBase.num)*1_000_000_000n/BigInt(source.sourceTimeBase.den);
  const negative=value<0n;const abs=negative?-value:value;
  return `${negative?'-':''}${abs/1_000_000_000n}.${String(abs%1_000_000_000n).padStart(9,'0')}`;
}
function parseMuxMap(text:string, source:SourceMetadata,frameCount:number):Array<string|null> {
  const rows=text.trim().split(/\r?\n/).filter(Boolean);
  if(rows.length!==frameCount) throw new TechnicalError('inconsistent_timestamps','Working frame mapping count differs from the encoded video.');
  const sourceSet=new Set(source.framePts);
  const first=source.sourceStartPts===null?null:BigInt(source.sourceStartPts);
  // Encoders may emit B-frame packets in decode order. Sort by output PTS so
  // mapping index n always denotes the displayed working frame n.
  const parsed=rows.map(line=>{
    const match=/^(-?\d+|N\/A)\s+(-?\d+)\s+(\d+\/\d+)$/.exec(line.trim());
    if(!match) throw new TechnicalError('inconsistent_timestamps','Working frame mapping is malformed.');
    return {input:match[1]!,output:BigInt(match[2]!),timeBase:match[3]!};
  }).sort((a,b)=>a.output<b.output?-1:a.output>b.output?1:0);
  let previousOutput:bigint|null=null;
  return parsed.map((row,index)=>{
    const output=row.output;
    if(previousOutput!==null&&output<=previousOutput) throw new TechnicalError('inconsistent_timestamps','Working frame timestamps are not increasing.');
    previousOutput=output;
    if(index===0&&output!==0n) throw new TechnicalError('inconsistent_timestamps','Working timeline does not start at zero.');
    if(row.input==='N/A'||first===null) return null;
    const original=(first+BigInt(row.input)).toString();
    if(!sourceSet.has(original)) throw new TechnicalError('inconsistent_timestamps','Working frame could not be mapped to a source frame.');
    return original;
  });
}
async function jpegDimensions(file:string):Promise<{width:number;height:number}> {
  const data=await readFile(file);
  if(data.length<4||data[0]!==0xff||data[1]!==0xd8) throw new TechnicalError('invalid_artifact','Representative frame is not a JPEG.');
  let i=2;
  while(i+9<data.length){
    if(data[i]!==0xff){i++;continue;}
    const marker=data[i+1]!;if(marker===0xd8||marker===0xd9){i+=2;continue;}
    const length=data.readUInt16BE(i+2);
    if(length<2||i+2+length>data.length) break;
    if([0xc0,0xc1,0xc2,0xc3].includes(marker)) return {height:data.readUInt16BE(i+5),width:data.readUInt16BE(i+7)};
    i+=2+length;
  }
  throw new TechnicalError('invalid_artifact','Representative frame dimensions are unavailable.');
}

export interface PrepareTechnicalInput {root:string;projectId:string;assetId:string;jobId:string;leaseToken:string;
  cacheKey:string;original:string;source:SourceMetadata;config:TechnicalConfig;signal?:AbortSignal}
/** Build immutable derivatives in an attempt-local temp directory. No original is modified. */
export async function prepareTechnical(input:PrepareTechnicalInput):Promise<PreparedTechnical> {
  try {return await prepareTechnicalInner(input);}
  catch(error){
    if(isAbsolute(input.root)&&[input.projectId,input.jobId,input.leaseToken].every(uuid)) {
      await rm(join(resolve(input.root),'temp',input.projectId,input.jobId,input.leaseToken),{recursive:true,force:true}).catch(()=>undefined);
    }
    throw error;
  }
}
async function prepareTechnicalInner(input:PrepareTechnicalInput):Promise<PreparedTechnical> {
  const {root,projectId,assetId,jobId,leaseToken,cacheKey,original,source,config,signal}=input;
  if(![projectId,assetId,jobId,leaseToken].every(uuid)||!validHash(cacheKey)) throw new TechnicalError('invalid_identity','Technical job identity is invalid.');
  const start=performance.now();
  const dimensions=targetDimensions(source,config.maxEdge);
  const actualRoot=await realpath(root);
  const attemptDirectory=join(actualRoot,'temp',projectId,jobId,leaseToken);
  await mkdir(attemptDirectory,{recursive:true});
  if(!within(actualRoot,await realpath(attemptDirectory))) throw new TechnicalError('unsafe_storage','Temporary storage path is unsafe.');
  const videoOnly=join(attemptDirectory,'video-only.mp4');
  const working=join(attemptDirectory,'working.mp4');
  const statsMap=join(attemptDirectory,'mux-map.txt');
  const timingMap=join(attemptDirectory,'timing-map.jsonl');
  const vf=`setpts=PTS-STARTPTS,fps=30:start_time=0,scale=${dimensions.width}:${dimensions.height}:flags=lanczos,setsar=1,format=yuv420p`;
  await runTool(config.ffmpeg,['-hide_banner','-nostdin','-v','error','-i',original,'-map',`0:${source.videoStreamIndex}`,
    '-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','21','-fps_mode','passthrough','-an',
    '-movflags','+faststart','-stats_mux_pre',statsMap,'-stats_mux_pre_fmt','{ptsi} {pts} {tb}','-y',videoOnly],
    'video normalization',Math.max(120_000,Math.min(900_000,source.sourceDurationMs*12)),500_000,signal);
  const probe=await runTool(config.ffprobe,['-v','error','-select_streams','v:0','-show_entries',
    'stream=codec_name,pix_fmt,width,height,avg_frame_rate,nb_frames,duration','-of','json',videoOnly],
    'working video verification',30_000,100_000,signal);
  let video:Record<string,unknown>;
  try {video=(JSON.parse(probe.stdout) as {streams:Record<string,unknown>[]}).streams[0]!;} catch {throw new TechnicalError('invalid_artifact','Working video could not be probed.');}
  const frameCount=Number(video.nb_frames);
  const rate=parseRational(video.avg_frame_rate);
  if(!Number.isSafeInteger(frameCount)||frameCount<=0||rate?.num!==30||rate.den!==1||
    video.codec_name!=='h264'||video.pix_fmt!=='yuv420p'||video.width!==dimensions.width||video.height!==dimensions.height) {
    throw new TechnicalError('invalid_artifact','Working video failed profile verification.');
  }
  const workingDurationMs=frameToMs(frameCount);
  const mapped=parseMuxMap(await readFile(statsMap,'utf8'),source,frameCount);
  const header={schema_version:1,working_fps:'30/1',source_time_base:source.sourceTimeBase,
    source_first_pts:source.sourceStartPts,coordinate_system:'working_frame_to_original_pts'};
  await writeFile(timingMap,[JSON.stringify(header),...mapped.map((pts,frame)=>JSON.stringify({frame,working_ms:frameToMs(frame),source_pts:pts}))].join('\n')+'\n');
  if(source.audioStreamIndex!==null){
    const origin=sourceOriginSeconds(source);
    const durationSeconds=(frameCount/30).toFixed(6);
    const af=`asetpts=PTS-(${origin})/TB,aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=end=${durationSeconds}`;
    await runTool(config.ffmpeg,['-hide_banner','-nostdin','-v','error','-i',original,'-i',videoOnly,
      '-map','1:v:0','-map',`0:${source.audioStreamIndex}`,'-c:v','copy','-af',af,'-c:a','aac','-b:a','192k',
      '-t',durationSeconds,'-movflags','+faststart','-y',working],
      'audio normalization',Math.max(120_000,Math.min(900_000,source.sourceDurationMs*8)),500_000,signal);
  } else await rename(videoOnly,working);
  const workingProbe=await runTool(config.ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,start_time,duration,sample_rate,channels:format=duration','-of','json',working],
    'working media verification',30_000,100_000,signal);
  let workingStreams:Array<Record<string,unknown>>;
  try {workingStreams=(JSON.parse(workingProbe.stdout) as {streams:Array<Record<string,unknown>>}).streams;} catch {throw new TechnicalError('invalid_artifact','Working media probe failed.');}
  const workingAudio=workingStreams.filter(s=>s.codec_type==='audio');
  if((source.audioStreamIndex===null&&workingAudio.length!==0)||
     (source.audioStreamIndex!==null&&(workingAudio.length!==1||workingAudio[0]?.codec_name!=='aac'||workingAudio[0]?.sample_rate!=='48000'||workingAudio[0]?.channels!==2))) {
    throw new TechnicalError('invalid_artifact','Working audio does not match the normalization profile.');
  }
  const workingStat=await stat(working);
  if(workingStat.size>config.maxWorkingBytes) throw new TechnicalError('working_storage_limit','Working media exceeds the configured storage limit.');
  const scene=await runTool(config.ffmpeg,['-hide_banner','-nostdin','-i',working,'-vf',
    `select=gt(scene\\,${config.sceneThreshold}),showinfo`,'-an','-f','null','-'],
    'scene-change detection',Math.max(120_000,Math.min(900_000,source.sourceDurationMs*8)),1_000_000,signal);
  const candidates=[...scene.stderr.matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)]
    .map(match=>decimalSecondsToFrame(match[1]!));
  const segments=planSegments(frameCount,candidates,config.maxSegmentFrames);
  if(segments.length>config.maxFramesPerAsset) throw new TechnicalError('frame_cap','Segmentation exceeds the configured representative-frame cap.');
  const expression=segments.map(s=>`eq(n\\,${s.representativeFrame})`).join('+');
  await runTool(config.ffmpeg,['-hide_banner','-nostdin','-v','error','-i',working,'-map','0:v:0',
    '-vf',`select=${expression}`,'-fps_mode','passthrough','-frames:v',String(segments.length),'-q:v','3',
    '-start_number','1','-y',join(attemptDirectory,'frame-%04d.jpg')],
    'representative-frame extraction',Math.max(120_000,Math.min(900_000,source.sourceDurationMs*8)),500_000,signal);
  const prefix=`${projectId}/${assetId}/${cacheKey}`;
  const makeArtifact=async(tempPath:string,logicalPath:string,artifactClass:PreparedArtifact['artifactClass'],mediaType:string):Promise<PreparedArtifact>=>({
    tempPath,logicalPath,artifactClass,mediaType,profileVersion:config.version,...await fileDigest(tempPath)});
  const artifacts:PreparedArtifact[]=[
    await makeArtifact(working,`${prefix}/working.mp4`,'working_video','video/mp4'),
    await makeArtifact(timingMap,`${prefix}/timing-map.jsonl`,'timing_map','application/x-ndjson')];
  const frames:PreparedFrame[]=[];
  for(const segment of segments){
    const name=`frame-${String(segment.index+1).padStart(4,'0')}.jpg`;
    const tempPath=join(attemptDirectory,name);
    const dims=await jpegDimensions(tempPath);
    if(dims.width!==dimensions.width||dims.height!==dimensions.height) throw new TechnicalError('invalid_artifact','Representative frame dimensions differ from working media.');
    const artifact=await makeArtifact(tempPath,`${prefix}/${name}`,'representative_frame','image/jpeg');
    artifacts.push(artifact);
    frames.push({segmentIndex:segment.index,frameIndex:segment.representativeFrame,timestampMs:frameToMs(segment.representativeFrame),
      sourcePts:mapped[segment.representativeFrame]??null,width:dims.width,height:dims.height,artifact});
  }
  return {attemptDirectory,workingFrameCount:frameCount,workingDurationMs,workingWidth:dimensions.width,
    workingHeight:dimensions.height,segments,frames,artifacts,sceneCandidateCount:candidates.length,
    processingMs:Math.round(performance.now()-start)};
}

/** Hard-link verified attempt files into an immutable cache-key directory. */
export async function publishTechnicalFiles(root:string,prepared:PreparedTechnical):Promise<void> {
  const actualRoot=await realpath(root);
  for(const artifact of prepared.artifacts){
    const target=resolve(actualRoot,'working',...artifact.logicalPath.split('/'));
    if(!within(actualRoot,target)) throw new TechnicalError('unsafe_storage','Working artifact path is unsafe.');
    await mkdir(dirname(target),{recursive:true});
    if(!within(actualRoot,await realpath(dirname(target)))) throw new TechnicalError('unsafe_storage','Working artifact directory is unsafe.');
    try {await link(artifact.tempPath,target);}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
      const existing=await fileDigest(target);
      if(existing.sha256!==artifact.sha256||existing.byteSize!==artifact.byteSize) throw new TechnicalError('artifact_collision','Working artifact key is occupied by different content.');
    }
  }
}
export async function cleanupTechnicalAttempt(prepared:PreparedTechnical):Promise<void> {
  await rm(prepared.attemptDirectory,{recursive:true,force:true});
}
