import Link from 'next/link';
import { Shell } from './components';
export default function NotFound() {
  return <Shell><h1 className="text-3xl font-semibold">Project not found</h1><p className="mt-4">This project isn’t available. Return to your library to choose a project.</p><Link href="/" className="mt-6 inline-block underline">Back to projects</Link></Shell>;
}
