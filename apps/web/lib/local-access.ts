import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

export function isLocalHost(host: string | null): boolean {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}
export async function requireLocalAccess(): Promise<void> {
  if (!isLocalHost((await headers()).get('host'))) notFound();
}
