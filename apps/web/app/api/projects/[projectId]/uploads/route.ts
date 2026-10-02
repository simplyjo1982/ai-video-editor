import { uploads, verifyUploadOrigin, uploadInput, uploadFailure } from '../../../../../lib/uploads';
export const runtime = 'nodejs';
export async function POST(request: Request, {params}: {params: Promise<{projectId: string}>}): Promise<Response> {
  try {
    verifyUploadOrigin(request);
    const input = await uploadInput(request);
    const {projectId} = await params;
    return Response.json(await uploads().reserve(projectId,input), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) { return uploadFailure(error); }
}
