import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '@ai-video-editor/db';
import { getDatabase } from '../../../lib/database';
import { requireLocalAccess } from '../../../lib/local-access';
import { Shell, DatabaseError, ProjectDate } from '../../components';

export const dynamic = 'force-dynamic';
export default async function ProjectDetail({params}: {params: Promise<{projectId: string}>}) {
  await requireLocalAccess();
  const {projectId} = await params;
  let project;
  try { project = await getProject(getDatabase(), projectId); }
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
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-8"><h2 className="text-xl font-semibold">Footage</h2><p className="mt-3 text-slate-600">No footage uploaded yet.</p></section>
  </Shell>;
}
