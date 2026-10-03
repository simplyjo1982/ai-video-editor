import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { decimalSecondsToMs, parseRational } from './timestamps.js';

export class TechnicalError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface TechnicalConfig {
  ffmpeg: string; ffprobe: string;
  maxFileDurationMs: number; maxProjectDurationMs: number;
  maxEdge: number; maxWorkingBytes: number;
  sceneThreshold: number; maxSegmentFrames: number; maxFramesPerAsset: number;
  version: string;
}
export const TECHNICAL_VERSION = 'phase0e-technical-v1';
export function technicalConfig(env = process.env): TechnicalConfig {
  function positive(key: string, fallback: number): number {
    const value=env[key] ? Number(env[key]) : fallback;
    if (!Number.isSafeInteger(value) || value <= 0) throw new TechnicalError('invalid_config','Invalid technical processing configuration.');
    return value;
  }
  function executable(key: string, fallback: string): string {
    const value=env[key]?.trim();
    if (!value) return fallback;
    if (!isAbsolute(value)) throw new TechnicalError('invalid_config',`${key} must be an absolute executable path.`);
    return value;
  }
  const maxFileDurationMs=positive('MAX_FILE_DURATION_MS',15*60*1000);
  const maxProjectDurationMs=positive('MAX_PROJECT_DURATION_MS',30*60*1000);
  const maxEdge=positive('TECHNICAL_MAX_EDGE',1920);
  const maxWorkingBytes=positive('MAX_WORKING_BYTES_PER_PROJECT',5_000_000_000);
  const maxSegmentFrames=positive('TECHNICAL_MAX_SEGMENT_FRAMES',300);
  const maxFramesPerAsset=positive('TECHNICAL_MAX_FRAMES_PER_ASSET',300);
  const sceneThreshold=env.TECHNICAL_SCENE_THRESHOLD ? Number(env.TECHNICAL_SCENE_THRESHOLD) : 0.30;
  if (sceneThreshold <= 0 || sceneThreshold >= 1 || !Number.isFinite(sceneThreshold) || maxEdge < 2 || maxSegmentFrames > 900 || maxFramesPerAsset > 3000) {
    throw new TechnicalError('invalid_config','Invalid technical processing configuration.');
  }
  return {ffmpeg:executable('FFMPEG_PATH','ffmpeg'),ffprobe:executable('FFPROBE_PATH','ffprobe'),
    maxFileDurationMs,maxProjectDurationMs,maxEdge,maxWorkingBytes,sceneThreshold,maxSegmentFrames,maxFramesPerAsset,version:TECHNICAL_VERSION};
}

/** No shell, no user filename in command construction, bounded output and time. */
export async function runTool(executable: string, args: string[], operation: string,
  timeoutMs: number, outputLimit = 2_000_000, signal?: AbortSignal): Promise<{stdout:string;stderr:string}> {
  return new Promise((resolve,reject) => {
    const childEnv={...process.env}; delete childEnv.DATABASE_URL; delete childEnv.OPENAI_API_KEY;
    const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnv});
    let stdout=''; let stderr=''; let failure: TechnicalError | null=null; let settled=false;
    const fail=(code:string,message:string) => { if (!failure) failure=new TechnicalError(code,message); child.kill('SIGKILL'); };
    const timer=setTimeout(() => fail('tool_timeout',`${operation} exceeded its time limit.`),timeoutMs);
    const aborted=() => fail('interrupted',`${operation} was interrupted.`);
    signal?.addEventListener('abort',aborted,{once:true});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',(chunk:string) => {stdout+=chunk; if (stdout.length>outputLimit) fail('tool_output_limit',`${operation} produced too much output.`);});
    child.stderr.on('data',(chunk:string) => {stderr+=chunk; if (stderr.length>outputLimit) fail('tool_output_limit',`${operation} produced too much output.`);});
    child.on('error',() => fail('tool_unavailable',`${operation} could not start. Check FFMPEG_PATH, FFPROBE_PATH, or PATH.`));
    child.on('close',code => {
      if (settled) return; settled=true; clearTimeout(timer); signal?.removeEventListener('abort',aborted);
      if (failure) reject(failure);
      else if (code!==0) reject(new TechnicalError('tool_failed',`${operation} failed (exit ${code ?? 'unknown'}). Check media compatibility or tool installation.`));
      else resolve({stdout,stderr});
    });
  });
}
export async function technicalToolchainVersion(config:TechnicalConfig):Promise<string>{
  const [ffmpeg,ffprobe]=await Promise.all([
    runTool(config.ffmpeg,['-version'],'FFmpeg version check',10_000,20_000),
    runTool(config.ffprobe,['-version'],'ffprobe version check',10_000,20_000)]);
  return `${ffmpeg.stdout.split(/\r?\n/)[0]??''} | ${ffprobe.stdout.split(/\r?\n/)[0]??''}`;
}

type ProbeStream = Record<string,unknown> & {index?:number;codec_type?:string;codec_name?:string};
export interface SourceMetadata {
  sourceDurationMs:number; durationDerivation:string; containerDurationMs:number|null;
  codedWidth:number; codedHeight:number; displayWidth:number; displayHeight:number;
  sampleAspectRatio:string|null; displayAspectRatio:string|null;
  nominalRate:{num:number;den:number}|null; averageRate:{num:number;den:number}|null;
  videoCodec:string; codecProfile:string|null; pixelFormat:string|null; bitrate:number|null; containerFormat:string|null;
  videoStreamCount:number; audioStreamCount:number; videoStreamIndex:number; audioStreamIndex:number|null;
  audioCodec:string|null; audioSampleRate:number|null; audioChannels:number|null;
  rotationDegrees:number|null; sourceStartPts:string|null; sourceTimeBase:{num:number;den:number}|null;
  audioStartPts:string|null; audioTimeBase:{num:number;den:number}|null;
  rateMode:'CFR'|'VFR'|'unknown'; rateModeMethod:string; framePts:string[];
  probeEvidence:Record<string,unknown>; warnings:string[];
}
function positiveInteger(value:unknown): number|null {
  const n=Number(value); return Number.isSafeInteger(n)&&n>0?n:null;
}
function nonnegativeInteger(value:unknown): number|null {
  const n=Number(value); return Number.isSafeInteger(n)&&n>=0?n:null;
}
function integerString(value:unknown): string|null {
  return typeof value==='string' && /^-?\d+$/.test(value) ? value : Number.isSafeInteger(value) ? String(value) : null;
}
function duration(value:unknown): number|null {
  if (typeof value!=='string') return null;
  try { const ms=decimalSecondsToMs(value); return ms>0?ms:null; } catch {return null;}
}
export function requirePositiveDuration(videoDuration:unknown,containerDuration:unknown):{milliseconds:number;derivation:'video_stream'|'container'} {
  const video=duration(videoDuration);const container=duration(containerDuration);
  if(video!==null)return {milliseconds:video,derivation:'video_stream'};
  if(container!==null)return {milliseconds:container,derivation:'container'};
  throw new TechnicalError('zero_duration','Video duration is missing or zero.');
}
export function validateFrameTiming(framePts:string[]):'CFR'|'VFR'|'unknown' {
  if(!framePts.length)throw new TechnicalError('inconsistent_timestamps','No video frame timestamps were available.');
  const deltas:bigint[]=[];
  for(let i=1;i<framePts.length;i++){
    if(!/^-?\d+$/.test(framePts[i]!)||!/^-?\d+$/.test(framePts[i-1]!))throw new TechnicalError('inconsistent_timestamps','Invalid video frame timestamp.');
    const delta=BigInt(framePts[i]!)-BigInt(framePts[i-1]!);
    if(delta<=0n)throw new TechnicalError('inconsistent_timestamps','Video frame timestamps are not strictly increasing.');
    deltas.push(delta);
  }
  if(deltas.length<2)return 'unknown';
  return deltas.every(v=>v===deltas[0])?'CFR':'VFR';
}
function rotation(stream:ProbeStream): number|null {
  const side=Array.isArray(stream.side_data_list) ? stream.side_data_list as Array<Record<string,unknown>> : [];
  const candidate=side.find(item => item.rotation!==undefined)?.rotation ?? (stream.tags as Record<string,unknown>|undefined)?.rotate;
  const value=Number(candidate);
  return candidate!==undefined && Number.isInteger(value) ? ((value%360)+360)%360 : null;
}
function displayDimensions(width:number,height:number,sar:string|null,turn:number|null): {width:number;height:number} {
  const match=sar && /^(\d+):(\d+)$/.exec(sar);
  const ratio=match && Number(match[2])>0 ? Number(match[1])/Number(match[2]) : 1;
  const displayWidth=Math.max(1,Math.round(width*ratio));
  return turn===90||turn===270 ? {width:height,height:displayWidth} : {width:displayWidth,height};
}

export async function probeSource(source:string, config:TechnicalConfig, signal?:AbortSignal):Promise<SourceMetadata> {
  const result=await runTool(config.ffprobe,['-v','error','-show_streams','-show_format','-of','json',source],
    'ffprobe',30_000,2_000_000,signal);
  let data: {streams?:ProbeStream[];format?:Record<string,unknown>};
  try {data=JSON.parse(result.stdout);} catch {throw new TechnicalError('invalid_probe','ffprobe returned invalid metadata.');}
  const streams=Array.isArray(data.streams)?data.streams:[];
  const videos=streams.filter(s=>s.codec_type==='video' && (s.disposition as Record<string,unknown>|undefined)?.attached_pic!==1);
  const audios=streams.filter(s=>s.codec_type==='audio');
  const video=videos[0]; const audio=audios[0]; const format=data.format??{};
  if (!video || !Number.isSafeInteger(video.index)) throw new TechnicalError('unsupported_stream','No usable video stream was found.');
  const width=positiveInteger(video.width); const height=positiveInteger(video.height);
  const videoDuration=duration(video.duration); const formatDuration=duration(format.duration);
  const selectedDuration=requirePositiveDuration(video.duration,format.duration);
  const sourceDurationMs=selectedDuration.milliseconds;
  if (!width||!height) throw new TechnicalError('unsupported_stream','Video dimensions are missing or invalid.');
  if (sourceDurationMs>config.maxFileDurationMs) throw new TechnicalError('duration_limit','Video exceeds the configured duration limit.');
  if (width>3840||height>3840||width*height>3840*2160) throw new TechnicalError('unsupported_dimensions','Video dimensions exceed the baseline input limit.');
  const videoCodec=typeof video.codec_name==='string'?video.codec_name:'';
  const audioCodec=audio && typeof audio.codec_name==='string'?audio.codec_name:null;
  const pixelFormat=typeof video.pix_fmt==='string'?video.pix_fmt:null;
  const transfer=typeof video.color_transfer==='string'?video.color_transfer:'';
  if (videoCodec!=='h264' || (audio && audioCodec!=='aac') || !['yuv420p','yuvj420p'].includes(pixelFormat??'') ||
      ['smpte2084','arib-std-b67'].includes(transfer)) {
    throw new TechnicalError('unsupported_stream','Baseline Phase 0E accepts SDR H.264 with AAC audio or no audio.');
  }
  const tb=parseRational(video.time_base);
  if (!tb) throw new TechnicalError('inconsistent_timestamps','Video timebase is missing or invalid.');
  const frames=await runTool(config.ffprobe,['-v','error','-select_streams',`v:${videos.indexOf(video)}`,
    '-show_frames','-show_entries','frame=best_effort_timestamp','-of','json',source],
    'ffprobe frame timing',Math.max(120_000,Math.min(600_000,sourceDurationMs*4)),12_000_000,signal);
  let framePts:string[];
  try {
    const parsed=JSON.parse(frames.stdout) as {frames?:Array<{best_effort_timestamp?:unknown}>};
    framePts=(parsed.frames??[]).map(f=>integerString(f.best_effort_timestamp)).filter((v):v is string=>v!==null);
  } catch {throw new TechnicalError('invalid_probe','ffprobe returned invalid frame timing.');}
  const rateMode=validateFrameTiming(framePts);
  const turn=rotation(video);
  const sar=typeof video.sample_aspect_ratio==='string'&&video.sample_aspect_ratio!=='0:1'?video.sample_aspect_ratio:null;
  const display=displayDimensions(width,height,sar,turn);
  const warnings:string[]=[];
  if (videoDuration===null) warnings.push('Video stream duration unavailable; container duration used.');
  if (rateMode==='unknown') warnings.push('Frame-rate mode inconclusive.');
  const streamInventory=streams.slice(0,32).map(s=>({index:s.index,type:s.codec_type,codec:s.codec_name,
    time_base:s.time_base,start_pts:s.start_pts,start_time:s.start_time,duration:s.duration,
    width:s.width,height:s.height,sample_rate:s.sample_rate,channels:s.channels}));
  return {sourceDurationMs,durationDerivation:selectedDuration.derivation,containerDurationMs:formatDuration,
    codedWidth:width,codedHeight:height,displayWidth:display.width,displayHeight:display.height,
    sampleAspectRatio:sar,displayAspectRatio:typeof video.display_aspect_ratio==='string'?video.display_aspect_ratio:null,
    nominalRate:parseRational(video.r_frame_rate),averageRate:parseRational(video.avg_frame_rate),
    videoCodec,codecProfile:typeof video.profile==='string'?video.profile:null,pixelFormat,
    bitrate:nonnegativeInteger(video.bit_rate)??nonnegativeInteger(format.bit_rate),
    containerFormat:typeof format.format_name==='string'?format.format_name:null,
    videoStreamCount:videos.length,audioStreamCount:audios.length,videoStreamIndex:video.index as number,
    audioStreamIndex:audio && Number.isSafeInteger(audio.index)?audio.index as number:null,
    audioCodec,audioSampleRate:audio?positiveInteger(audio.sample_rate):null,audioChannels:audio?positiveInteger(audio.channels):null,
    rotationDegrees:turn,sourceStartPts:framePts[0]!,sourceTimeBase:tb,
    audioStartPts:audio?integerString(audio.start_pts):null,audioTimeBase:audio?parseRational(audio.time_base):null,
    rateMode,rateModeMethod:`all decoded video frame PTS deltas (${framePts.length} frames)`,framePts,
    probeEvidence:{format:{format_name:format.format_name,duration:format.duration,start_time:format.start_time},
      selected_video_stream:video.index,selected_audio_stream:audio?.index??null,streams:streamInventory,
      timing_frame_count:framePts.length,timing_first_pts:framePts[0],timing_last_pts:framePts.at(-1)},warnings};
}
