import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTechnicalInspection } from '@ai-video-editor/db';
import { getDatabase } from '../../../../../../lib/database';
import { requireLocalAccess } from '../../../../../../lib/local-access';
import { Shell, DatabaseError } from '../../../../../components';
import StatusRefresh from './status-refresh';

export const dynamic='force-dynamic';
function clock(value:string):string{
  const ms=Number(value);const minutes=Math.floor(ms/60000);const seconds=Math.floor(ms%60000/1000);
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
function rate(num:number|null,den:number|null):string{return num&&den?`${num}/${den} (${(num/den).toFixed(3)} fps)`:'Unknown';}
export default async function TechnicalInspectionPage({params}:{params:Promise<{projectId:string;assetId:string}>}){
  await requireLocalAccess();
  const {projectId,assetId}=await params;
  let inspection;
  try{inspection=await getTechnicalInspection(getDatabase(),projectId,assetId);}
  catch{return <Shell><DatabaseError retry={`/projects/${projectId}/media/${assetId}/technical`} /></Shell>;}
  if(!inspection)notFound();
  const {asset,metadata,segments}=inspection;
  const job=inspection.jobStatus;
  const status=job==='queued'||job==='retry_wait'?'Queued':job==='running'?'Analyzing':asset.status==='ready'?'Ready':
    job==='failed'||asset.status==='failed'?'Failed':'Uploaded';
  return <Shell>
    <Link href={`/projects/${projectId}`} className="text-sm underline">Back to project</Link>
    <h1 className="mt-6 break-words text-3xl font-semibold">Technical inspection: {asset.original_filename}</h1>
    <p className="mt-3 text-sm text-slate-600">Technical processing: <strong>{status}</strong></p>
    {['Queued','Analyzing'].includes(status)&&<StatusRefresh />}
    {status==='Failed'&&<p className="mt-3 text-sm text-red-700">Technical processing failed. The original upload remains intact. Retry from the project page.</p>}
    {metadata&&<section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">Verified technical metadata</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Source duration</dt><dd>{clock(metadata.source_duration_ms)}</dd></div>
        <div><dt className="font-medium">Working duration</dt><dd>{clock(metadata.working_duration_ms)}</dd></div>
        <div><dt className="font-medium">Coded dimensions</dt><dd>{metadata.coded_width} × {metadata.coded_height}</dd></div>
        <div><dt className="font-medium">Display dimensions</dt><dd>{metadata.display_width} × {metadata.display_height}</dd></div>
        <div><dt className="font-medium">Working dimensions</dt><dd>{metadata.working_width} × {metadata.working_height}</dd></div>
        <div><dt className="font-medium">Codec</dt><dd>{metadata.video_codec}{metadata.codec_profile?` · ${metadata.codec_profile}`:''}</dd></div>
        <div><dt className="font-medium">Source average frame rate</dt><dd>{rate(metadata.average_frame_rate_num,metadata.average_frame_rate_den)}</dd></div>
        <div><dt className="font-medium">Working frame rate</dt><dd>30/1 CFR · {metadata.working_frame_count} frames</dd></div>
        <div><dt className="font-medium">Source frame timing</dt><dd>{metadata.rate_mode}</dd></div>
        <div><dt className="font-medium">Audio</dt><dd>{metadata.audio_stream_count>0?`${metadata.audio_stream_count} stream(s) · ${metadata.audio_codec??'codec unknown'}`:'No source audio'}</dd></div>
        <div><dt className="font-medium">Rotation</dt><dd>{metadata.rotation_degrees===null?'Unknown':`${metadata.rotation_degrees}°`}</dd></div>
      </dl>
      <p className="mt-4 text-xs text-slate-500">Intervals use inclusive start and exclusive end on the 30 fps working timeline. Millisecond labels are rounded for display.</p>
    </section>}
    {metadata&&<section className="mt-8">
      <h2 className="text-xl font-semibold">Temporal segments ({segments.length})</h2>
      <p className="mt-2 text-sm text-slate-600">Shot-change candidates and bounded continuous-shot intervals; no semantic scene labels.</p>
      <ol className="mt-5 grid gap-5 sm:grid-cols-2">
        {segments.map(segment=><li key={segment.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-medium">Segment {String(segment.segment_index+1).padStart(2,'0')}</h3>
          <p className="mt-1 text-sm text-slate-600">{clock(segment.start_ms)} → {clock(segment.end_ms)}</p>
          <p className="mt-1 text-xs text-slate-500">{segment.segmentation_method.replaceAll('_',' ')}</p>
          {segment.representative_frame_id&&<Image unoptimized className="mt-3 h-auto w-full rounded-md" width={metadata.working_width}
            height={metadata.working_height} alt={`Representative frame for segment ${segment.segment_index+1}`}
            src={`/api/projects/${projectId}/media/${assetId}/frames/${segment.representative_frame_id}`} />}
        </li>)}
      </ol>
    </section>}
  </Shell>;
}
