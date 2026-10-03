import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject, listMediaAssets, latestTechnicalStates, listTechnicalMetadata, type TechnicalMetadataView } from '@ai-video-editor/db';
import UploadFootage from './upload-footage';
import { getDatabase } from '../../../lib/database';
import { requireLocalAccess } from '../../../lib/local-access';
import { Shell, DatabaseError, ProjectDate } from '../../components';

export const dynamic = 'force-dynamic';
function displayMs(value:string):string {
  const ms=Number(value);const minutes=Math.floor(ms/60000);const seconds=Math.floor(ms%60000/1000);
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
function technicalLabel(assetStatus:string,jobStatus:string|undefined):string {
  if(jobStatus==='queued'||jobStatus==='retry_wait')return 'Queued';
  if(jobStatus==='running')return 'Analyzing';
  if(assetStatus==='ready')return 'Ready';
  if(jobStatus==='failed'||assetStatus==='failed')return 'Failed';
  return 'Uploaded';
}
export default async function ProjectDetail({params}: {params: Promise<{projectId: string}>}) {
  await requireLocalAccess();
  const {projectId} = await params;
  let project;
  let media;
  let states = new Map<string,string>();
  let technical = new Map<string,TechnicalMetadataView>();
  try {
    project = await getProject(getDatabase(), projectId);
    media = project ? await listMediaAssets(getDatabase(),projectId) : [];
    if(project)[states,technical] = await Promise.all([latestTechnicalStates(getDatabase(),projectId),listTechnicalMetadata(getDatabase(),projectId)]);
  }
  catch { return <Shell><DatabaseError retry={`/projects/${encodeURIComponent(projectId)}`} /></Shell>; }
  if (!project) notFound();
  return <Shell><Link href="/" className="text-sm underline">Back to projects</Link>
    <h1 className="mt-6 break-words text-3xl font-semibold">{project.name}</h1>
    <dl className="mt-6 space-y-3 text-sm text-slate-600">
      <div><dt className="inline font-medium">Project ID: </dt><dd className="inline break-all">{project.id}</dd></div>
      <div><dt className="inline font-medium">Status: </dt><dd className="inline capitalize">{project.status}</dd></div>
      <div><dt className="inline font-medium">Created: </dt><dd className="inline"><ProjectDate value={project.created_at} /></dd></div>
      <div><dt className="inline font-medium">Updated: </dt><dd className="inline"><ProjectDate value={project.updated_at} /></dd></div>
    </dl>
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-8"><h2 className="text-xl font-semibold">Footage</h2>
      <UploadFootage projectId={project.id} />
      {media.length === 0 ? <p className="mt-5 text-slate-600">No footage uploaded yet.</p> : <ul className="mt-6 divide-y divide-slate-200">{media.map(asset => <li key={asset.id} className="py-4">
        <h3 className="break-words font-medium">{asset.original_filename}</h3>
        <p className="mt-1 text-sm text-slate-600">{new Intl.NumberFormat('en').format(BigInt(asset.file_size_bytes))} bytes · {technicalLabel(asset.status,states.get(asset.id))}</p>
        <p className="mt-1 text-sm text-slate-600">Added <ProjectDate value={asset.created_at} /></p>
        {technical.get(asset.id) && <p className="mt-2 text-sm text-slate-700">{displayMs(technical.get(asset.id)!.working_duration_ms)} ·
          {' '}{technical.get(asset.id)!.working_width} × {technical.get(asset.id)!.working_height} ·
          {' '}{technical.get(asset.id)!.display_height > technical.get(asset.id)!.display_width ? 'Portrait' :
            technical.get(asset.id)!.display_height === technical.get(asset.id)!.display_width ? 'Square' : 'Landscape'} ·
          {' '}{technical.get(asset.id)!.video_codec.toUpperCase()} ·
          {' '}{technical.get(asset.id)!.average_frame_rate_num && technical.get(asset.id)!.average_frame_rate_den ?
            `${technical.get(asset.id)!.average_frame_rate_num}/${technical.get(asset.id)!.average_frame_rate_den} fps source` : 'Frame rate unknown'} ·
          {' '}{technical.get(asset.id)!.audio_stream_count > 0 ? 'Audio present' : 'No audio'}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <Link className="underline" href={`/projects/${project.id}/media/${asset.id}/technical`}>Technical inspection</Link>
          {!['queued','retry_wait','running'].includes(states.get(asset.id)??'') &&
            <form method="post" action={`/api/projects/${project.id}/media/${asset.id}/technical`}>
              <button className="rounded-md bg-slate-900 px-3 py-2 text-white" type="submit">
                {asset.status==='ready'?'Check for technical updates':'Start technical processing'}
              </button>
            </form>}
        </div>
      </li>)}</ul>}
    </section>
  </Shell>;
}
