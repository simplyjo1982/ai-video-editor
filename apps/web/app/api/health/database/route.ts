import { checkDatabase } from '../../../../lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await checkDatabase();
    return Response.json({status: 'ok'}, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({status: 'unavailable'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }
}
