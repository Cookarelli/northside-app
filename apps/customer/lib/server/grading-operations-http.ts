import "server-only";
import { fixturesAllowed } from "../policy.mjs";
import { privateRequest } from "./http";
import {
  AccessError,
  errorResponse,
  privateHeaders,
  sameOrigin,
  uuid,
} from "./security";
import { boundedJson } from "./grading-api";
import {
  batchWorkspace,
  manifestCsv,
  operationsAction,
  operationsCard,
  operationsOverview,
  scanGradingCard,
} from "./grading-fulfillment";
import {
  commitStatusImport,
  readStatusImport,
  statusImportPreview,
  statusImportHeaders,
} from "./grading-status-import";
import { examPhotoStore } from "./exam-storage";
import { encodeStoreQR } from "./store-label";
import { gradingLabel } from "../grading-fulfillment";
import type { Actor, Sql } from "./db";
export async function gradingOperationsHttp(
  request: Request,
  fixture: boolean,
) {
  try {
    if (fixture && !fixturesAllowed(process.env))
      throw new AccessError(404, "not_found");
    if (!fixture && request.method !== "GET") sameOrigin(request);
    const run = async (db: Sql, a: Actor) => {
      const u = new URL(request.url);
      let result: unknown;
      if (request.method === "GET") {
        if (u.searchParams.has("label")) {
          const card = await scanGradingCard(
              db,
              a,
              uuid(u.searchParams.get("label")!),
            ),
            qr = await encodeStoreQR(gradingLabel(card.card_id));
          const width = Number(qr.svg.match(/<svg width="(\d+)"/)?.[1]),
            height = Number(qr.svg.match(/height="(\d+)"/)?.[1]);
          if (!width || !height)
            throw new AccessError(503, "label_unavailable");
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 64}" viewBox="0 0 ${width} ${height + 64}"><rect width="100%" height="100%" fill="white"/>${qr.svg.slice(qr.svg.indexOf("<svg"))}<text x="${width / 2}" y="${height + 18}" text-anchor="middle" font-family="sans-serif" font-size="12">${fixture ? "SAMPLE — " : ""}NORTHSIDE CARD</text><text x="${width / 2}" y="${height + 36}" text-anchor="middle" font-family="sans-serif" font-size="10">${card.card_id}</text><text x="${width / 2}" y="${height + 52}" text-anchor="middle" font-family="sans-serif" font-size="10">Identification only — not release authorization</text></svg>`;
          return new Response(svg, {
            headers: {
              ...privateHeaders(),
              "Content-Type": "image/svg+xml",
              "Content-Disposition": `attachment; filename="${fixture ? "SAMPLE-" : ""}card-${card.card_id}.svg"`,
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
        }
        if (u.searchParams.has("manifest"))
          return new Response(
            await manifestCsv(db, a, uuid(u.searchParams.get("manifest")!)),
            {
              headers: {
                ...privateHeaders(),
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition":
                  'attachment; filename="staff-grading-dispatched-manifest.csv"',
              },
            },
          );
        result = u.searchParams.has("batch")
          ? await batchWorkspace(db, a, uuid(u.searchParams.get("batch")!))
          : u.searchParams.has("card")
            ? await operationsCard(db, a, uuid(u.searchParams.get("card")!))
            : u.searchParams.has("import")
              ? await readStatusImport(
                  db,
                  a,
                  uuid(u.searchParams.get("import")!),
                )
              : await operationsOverview(db, a);
      } else {
        const b = await boundedJson(request),
          store = examPhotoStore(fixture);
        result =
          b.action === "status_import_headers"
            ? { headers: statusImportHeaders(a, b.csv) }
            : b.action === "status_import_preview"
              ? await statusImportPreview(db, a, b)
              : b.action === "status_import_commit"
                ? await commitStatusImport(db, a, b, store)
                : await operationsAction(db, a, b, store);
      }
      return Response.json(result, { headers: privateHeaders() });
    };
    if (fixture) {
      const { previewTransaction } = await import("./grading-preview");
      return await previewTransaction(request, run);
    }
    return await privateRequest(run);
  } catch (e) {
    return errorResponse(e);
  }
}
