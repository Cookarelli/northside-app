import { showRead } from "@/lib/server/show-public";
import { approvedPlacement } from "@/lib/server/measurement";
import { encodeStoreQR } from "@/lib/server/store-label";
import {
  AccessError,
  appOrigin,
  errorResponse,
  privateHeaders,
} from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  try {
    const { ref } = await params,
      { p, sample } = await showRead(async (db, s) => ({
        p: await approvedPlacement(db, ref, s),
        sample: s,
      }));
    if (!p) throw new AccessError(404, "active_show_link_not_found");
    const q = await encodeStoreQR(
        (sample ? `http://${request.headers.get("host")}` : appOrigin()) +
          "/go/" +
          p.ref,
      ),
      w = Number(q.svg.match(/<svg width="(\d+)"/)?.[1]),
      h = Number(q.svg.match(/height="(\d+)"/)?.[1]);
    if (!w || !h) throw Error();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 52}" viewBox="0 0 ${w} ${h + 52}"><rect width="100%" height="100%" fill="white"/>${q.svg.slice(q.svg.indexOf("<svg"))}<text x="${w / 2}" y="${h + 20}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="black">${sample ? "SAMPLE — NOT FOR PRINTED CAMPAIGN USE" : "NORTHSIDE COLLECTIBLES"}</text></svg>`;
    return new Response(svg, {
      headers: {
        ...privateHeaders(),
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${sample ? "SAMPLE-" : ""}show-${p.utm_content}.svg"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
