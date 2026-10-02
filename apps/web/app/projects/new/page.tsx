import Link from 'next/link';
import { Shell } from '../../components';
import { requireLocalAccess } from '../../../lib/local-access';

const errors: Record<string, string> = {
  invalid: 'Enter a project name using 1–120 characters on a single line.',
  unavailable: 'We couldn’t save your project. Check that the local database is running and try again.',
};
export default async function NewProject({searchParams}: {searchParams: Promise<{error?: string}>}) {
  await requireLocalAccess();
  const {error} = await searchParams;
  return <Shell><Link href="/" className="text-sm underline">Back to projects</Link>
    <h1 className="mt-6 text-3xl font-semibold">New Project</h1>
    <form action="/api/projects" method="post" className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6">
      {error && <p id="form-error" role="alert" className="mb-5 text-red-700">{Object.hasOwn(errors, error) ? errors[error] : errors.invalid}</p>}
      <label htmlFor="name" className="block font-medium">Project Name</label>
      <input id="name" name="name" required maxLength={120} aria-describedby={error ? 'name-hint form-error' : 'name-hint'} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3" />
      <p id="name-hint" className="mt-2 text-sm text-slate-600">Give your project a name. Up to 120 characters.</p>
      <button type="submit" className="mt-6 rounded-lg bg-slate-900 px-5 py-3 font-medium text-white">Create Project</button>
    </form>
  </Shell>;
}
