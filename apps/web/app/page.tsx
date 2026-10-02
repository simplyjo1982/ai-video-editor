import Link from 'next/link';
import { listProjects } from '@ai-video-editor/db';
import { getDatabase } from '../lib/database';
import { requireLocalAccess } from '../lib/local-access';
import { Shell, DatabaseError, ProjectDate } from './components';

export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireLocalAccess();
  let projects;
  try { projects = await listProjects(getDatabase()); }
  catch { return <Shell><h1 className="mb-6 text-3xl font-semibold">Projects</h1><DatabaseError /></Shell>; }
  return <Shell>
    <div className="mb-8 flex items-center justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">Projects</h1><p className="mt-2 text-slate-600">A home for your next video.</p></div>
      <Link href="/projects/new" className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white">New Project</Link>
    </div>
    {projects.length === 0 ? <section className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <h2 className="text-xl font-semibold">No projects yet</h2><p className="mt-3 text-slate-600">Create your first project to get started.</p>
    </section> : <div className="grid gap-5 sm:grid-cols-2">{projects.map(project => <Link key={project.id} href={`/projects/${project.id}`} className="rounded-xl border border-slate-200 bg-white p-6 transition hover:border-slate-400">
      <div className="flex items-start justify-between gap-4"><h2 className="break-words text-xl font-semibold">{project.name}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">{project.status}</span></div>
      <p className="mt-5 text-sm text-slate-600">{project.media_count} media assets</p>
      <dl className="mt-3 space-y-2 text-sm text-slate-600"><div><dt className="inline">Created: </dt><dd className="inline"><ProjectDate value={project.created_at} /></dd></div><div><dt className="inline">Updated: </dt><dd className="inline"><ProjectDate value={project.updated_at} /></dd></div></dl>
    </Link>)}</div>}
  </Shell>;
}
