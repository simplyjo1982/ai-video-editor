import Link from 'next/link';
import type { ReactNode } from 'react';
import { foundation } from '@ai-video-editor/contracts';

export function Shell({children}: {children: ReactNode}) {
  return <main className="mx-auto max-w-5xl px-6 py-10">
    <header className="mb-12 border-b border-slate-200 pb-6"><Link href="/" className="text-xl font-semibold tracking-tight">{foundation.productName}</Link></header>
    {children}
  </main>;
}
export function DatabaseError({retry = '/'}: {retry?: string}) {
  return <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6">
    <h2 className="text-lg font-semibold">Projects are temporarily unavailable</h2>
    <p className="mt-2">We couldn’t connect to your project library. Check that the local database is running, then try again.</p>
    <a href={retry} className="mt-4 inline-block underline">Try again</a>
  </section>;
}
export function ProjectDate({value}: {value: Date}) {
  return <time dateTime={value.toISOString()}>{new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'}).format(value)} UTC</time>;
}
