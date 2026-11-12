import { privateRequest } from "@/lib/server/http";
import { cardFileResponse, readCardFile } from "@/lib/server/card-files";
import { errorResponse } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await privateRequest(async (db, a) =>
      cardFileResponse(await readCardFile(db, a, id)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
