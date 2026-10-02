import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject, listMediaAssets } from '@ai-video-editor/db';
import UploadFootage from './upload-footage';
import { getDatabase } from '../../../lib/database';
import { requireLocalAccess } from '../../../lib/local-access';
import { Shell, DatabaseError, ProjectDate } from '../../components';

export const dynamic = 'force-dynamic';
export default async function ProjectDetail({params}: {params: Promise<{projectId: string}>}) {
  await requireLocalAccess();
  const {projectId} = await params;
  let project;
  let media;
  try { project = await getProject(getDatabase(), projectId); media = project ? await listMediaAssets(getDatabase(),projectId) : []; }
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
        <p className="mt-1 text-sm text-slate-600">{new Intl.NumberFormat('en').format(BigInt(asset.file_size_bytes))} bytes · <span className="capitalize">{asset.status}</span></p>
        <p className="mt-1 text-sm text-slate-600">Added <ProjectDate value={asset.created_at} /></p>
      </li>)}</ul>}
    </section>
  </Shell>;
}
