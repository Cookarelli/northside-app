import "server-only";
import { fixturesAllowed } from "../policy.mjs";
import type { Sql, Actor } from "./db";
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
  examWorkspace,
  prepareExamPhoto,
  authorizedExamPhoto,
  completeExamPhoto,
  removeExamPhoto,
  saveExamDraft,
  publishExam,
  verifyStoredPhoto,
} from "./exam";
import { examPhotoStore, photoBytes } from "./exam-storage";
import { examReport } from "./exam-report";

export async function examHttp(request: Request, fixture: boolean) {
  try {
    if (fixture && !fixturesAllowed(process.env))
      throw new AccessError(404, "not_found");
    if (!fixture && request.method !== "GET") sameOrigin(request);
    const run = async (db: Sql, actor: Actor) => {
      const url = new URL(request.url),
        cardId = uuid(url.searchParams.get("card") || "");
      if (request.method === "GET") {
        if (url.searchParams.has("photo")) {
          const photo = await authorizedExamPhoto(
            db,
            actor,
            cardId,
            url.searchParams.get("photo")!,
          );
          const bytes = await verifyStoredPhoto(photo, examPhotoStore(fixture));
          return new Response(new Uint8Array(bytes), {
            headers: {
              ...privateHeaders(),
              "Content-Type": "image/jpeg",
              "Content-Disposition": 'inline; filename="northside-card.jpg"',
              "Cross-Origin-Resource-Policy": "same-origin",
            },
          });
        }
        const data = await examWorkspace(db, actor, cardId);
        if (url.searchParams.has("report")) {
          const revision = data.revisions.find(
            (r) => r.id === url.searchParams.get("report"),
          );
          if (!revision)
            throw new AccessError(404, "published_report_not_found");
          const images: Record<string, string> = {},
            store = examPhotoStore(fixture);
          for (const p of revision.photos) {
            const photo = await authorizedExamPhoto(db, actor, cardId, p.id);
            await verifyStoredPhoto(photo, store);
            const params = new URLSearchParams({ card: cardId, photo: p.id });
            if (fixture)
              params.set(
                "actor",
                actor.customer_id
                  ? url.searchParams.get("actor") || "a"
                  : "staff",
              );
            images[p.id] = `${url.pathname}?${params}`;
          }
          return new Response(examReport(revision, cardId, images, fixture), {
            headers: {
              ...privateHeaders(),
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy":
                "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        return Response.json(
          { ...data, fixture },
          { headers: privateHeaders() },
        );
      }
      if (request.method === "PUT") {
        const id = uuid(url.searchParams.get("photo") || "");
        // Authenticate the exact card and upload record before reading the body.
        await authorizedExamPhoto(db, actor, cardId, id, true);
        const bytes = await photoBytes(request),
          mime = request.headers.get("content-type")?.split(";")[0] || "";
        return Response.json(
          await completeExamPhoto(
            db,
            actor,
            cardId,
            id,
            bytes,
            mime,
            examPhotoStore(fixture),
          ),
          { headers: privateHeaders() },
        );
      }
      const b = await boundedJson(request);
      let result: unknown;
      switch (b.action) {
        case "photo-prepare":
          result = await prepareExamPhoto(db, actor, cardId, b);
          break;
        case "photo-remove":
          result = await removeExamPhoto(db, actor, cardId, uuid(String(b.id)));
          break;
        case "save-draft":
          result = await saveExamDraft(db, actor, cardId, b);
          break;
        case "publish":
          result = await publishExam(
            db,
            actor,
            cardId,
            b,
            examPhotoStore(fixture),
          );
          break;
        default:
          throw new AccessError(400, "unknown_exam_action");
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
