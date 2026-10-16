import "server-only";
import { cookies } from "next/headers";
import {
  type Actor,
  type Sql,
  requireCustomer,
  requireRole,
  transaction,
} from "./db";
import { privateRequest } from "./http";
import { boundedJson } from "./grading-api";
import {
  AccessError,
  privateHeaders,
  errorResponse,
  sameOrigin,
  opaqueToken,
  hashToken,
  validToken,
} from "./security";
import { TENANT } from "./providers";
import {
  inbox,
  preferences,
  subscribe,
  protectContact,
  runNotifications,
  type WorkerRun,
} from "./notifications";
import {
  analyticsConsent,
  approvedPlacement,
  publicShow,
  saveShow,
  savePlacement,
  visitor,
  observeTouch,
  metric,
  linkVisitor,
  metrics,
  filters,
  metricCsv,
  customerMetric,
  setMeasurementContext,
  measurementTokenFrom,
} from "./measurement";
import { shortText, uuid } from "./loyalty";
import { CAMPAIGN_COOKIE } from "./campaigns";
export const measurementCookie = (sample: boolean) =>
  sample ? "ns_sample_campaign" : CAMPAIGN_COOKIE;
export async function engagementApi(request: Request, sample = false) {
  try {
    let run: <T>(fn: (db: Sql, a: Actor) => Promise<T>) => Promise<T> =
        privateRequest,
      worker: WorkerRun = (fn) => transaction("engagement", fn);
    if (sample) {
      const { engagementPreview, engagementSampleRun } =
        await import("./engagement-preview");
      const { f, who } = await engagementPreview(request);
      run = (fn) =>
        f.run(who, async (db, a) => {
          await setMeasurementContext(db, measurementTokenFrom(request, true));
          return fn(db, a);
        });
      worker = (fn) => engagementSampleRun(f, fn);
    } else if (request.method !== "GET") sameOrigin(request);
    const u = new URL(request.url),
      b = request.method === "GET" ? {} : await boundedJson(request),
      jar = await cookies(),
      token = jar.get(measurementCookie(sample))?.value;
    const response = (x: unknown) =>
      Response.json(x, { headers: privateHeaders() });
    if (u.searchParams.has("public")) {
      if (request.method === "GET") {
        const info = await worker(async (db) => ({
          consent: !!(await visitor(db, token)),
          show: u.searchParams.get("slug")
            ? await publicShow(db, u.searchParams.get("slug")!, sample)
            : null,
          placement: await approvedPlacement(
            db,
            u.searchParams.get("ref"),
            sample,
          ),
        }));
        if (
          info.show?.brand === "hobby_key" &&
          !sample &&
          process.env.HOBBY_KEY_INTEREST_ENABLED !== "true"
        )
          throw new AccessError(404, "not_found");
        return response(info);
      }
      if (b.action === "consent") {
        const t = validToken(token) ? token : opaqueToken();
        await worker((db) =>
          analyticsConsent(db, t, b.granted === true, b.ref, sample),
        );
        jar.set(measurementCookie(sample), b.granted === true ? t : "", {
          httpOnly: true,
          secure: !sample,
          sameSite: "lax",
          path: "/",
          maxAge: b.granted === true ? 30 * 86400 : 0,
        });
        return response({
          message:
            b.granted === true
              ? "Analytics consent saved for this browser. Marketing follow-up remains separate."
              : "Analytics turned off. Future eligible touches will not be recorded.",
        });
      }
      if (b.action === "view") {
        if (!validToken(token)) return response({ recorded: false });
        if (
          !["landing_view", "install_prompt_accepted", "product_view"].includes(
            String(b.event),
          )
        )
          throw new AccessError(400, "server_verified_event_required");
        const event = b.event as
          "landing_view" | "install_prompt_accepted" | "product_view";
        const recorded = await worker(async (db) => {
          if (
            event === "landing_view" &&
            !(await observeTouch(db, token, b.ref, sample))
          )
            return false;
          const v = await visitor(db, token);
          return metric(
            db,
            v,
            event,
            hashToken(token) + "/" + uuid(b.request_id),
            sample,
          );
        });
        return response({ recorded });
      }
      if (b.action === "interest") {
        if (!sample && process.env.HOBBY_KEY_INTEREST_ENABLED !== "true")
          throw new AccessError(404, "not_found");
        if (b.followup_consent !== true)
          throw new AccessError(400, "followup_consent_required");
        const name = shortText(b.name, 100),
          email = shortText(b.email, 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || b.website)
          throw new AccessError(400, "invalid_interest");
        if (sample && !email.endsWith(".invalid"))
          throw new AccessError(400, "sample_email_must_end_dot_invalid");
        const id = uuid(b.request_id);
        await worker(async (db) => {
          const show = await publicShow(db, shortText(b.slug, 80), sample);
          if (!show || show.brand !== "hobby_key")
            throw new AccessError(404, "interest_show_not_found");
          const p = await approvedPlacement(db, b.ref, sample);
          if (p && p.event_id !== show.id)
            throw new AccessError(400, "placement_mismatch");
          const contactKey = hashToken(email.toLowerCase() + "/" + show.id);
          if (
            (
              await db.query(
                "select id from ns.vendor_interests where tenant_id=$1 and request_hash=$2",
                [TENANT, contactKey],
              )
            ).rows.length
          )
            return;
          await db.query(
            "insert into ns.vendor_interests(tenant_id,event_id,placement_ref,contact_sealed,followup_consent,request_hash,fixture) values($1,$2,$3,$4,true,$5,$6) on conflict do nothing",
            [
              TENANT,
              show.id,
              p?.ref || null,
              sample
                ? "SAMPLE UNSENT CONTACT"
                : protectContact({ name, email }, `${TENANT}/vendor-interest`),
              contactKey,
              sample,
            ],
          );
          await metric(
            db,
            await visitor(db, token),
            "vendor_interest_submission",
            hashToken(id),
            sample,
          );
        });
        return response({
          message:
            "Interest saved with follow-up consent. No message was sent and no vendor booking was created.",
        });
      }
      throw new AccessError(400, "unknown_public_action");
    }
    if (request.method === "GET") {
      if (u.searchParams.get("staff") === "1") {
        const data = await run(async (db, a) => {
          requireRole(a, ["owner", "admin", "operations", "read_only"]);
          return {
            report: await metrics(db, a, filters(u)),
            shows: (
              await db.query(
                "select * from ns.show_events where tenant_id=$1 order by title",
                [a.tenant_id],
              )
            ).rows,
            placements: (
              await db.query(
                "select * from ns.show_placements where tenant_id=$1 order by placement_key",
                [a.tenant_id],
              )
            ).rows,
            jobs: (
              await db.query(
                "select j.id,j.channel,j.state,j.attempts,j.available_at,n.due_at,j.last_error from ns.notification_jobs j join ns.notifications n on n.tenant_id=j.tenant_id and n.id=j.notification_id where j.tenant_id=$1 order by j.created_at desc limit 60",
                [a.tenant_id],
              )
            ).rows,
            attempts: (
              await db.query(
                "select outcome,code,at from ns.notification_attempts where tenant_id=$1 order by at desc limit 60",
                [a.tenant_id],
              )
            ).rows,
            measurementJobs: (
              await db.query(
                "select state,count(*)::int count from ns.measurement_jobs where tenant_id=$1 group by state",
                [a.tenant_id],
              )
            ).rows,
          };
        });
        if (u.searchParams.has("csv"))
          return new Response(
            (sample
              ? "SAMPLE LOCAL FIXTURES — NOT BUSINESS PERFORMANCE\r\n"
              : "") + metricCsv(data.report),
            {
              headers: {
                ...privateHeaders(),
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${sample ? "SAMPLE-" : ""}northside-engagement.csv"`,
              },
            },
          );
        return response(data);
      }
      const result = await run(async (db, a) => ({
        a,
        data: await inbox(db, a),
      }));
      if (validToken(token))
        await worker((db) => linkVisitor(db, token, result.a, sample));
      return response(result.data);
    }
    switch (b.action) {
      case "link": {
        const a = await run(async (_, a) => {
          requireCustomer(a);
          return a;
        });
        if (validToken(token))
          await worker((db) => linkVisitor(db, token, a, sample));
        return response({ linked: true });
      }
      case "preferences": {
        let email: string | undefined;
        if (b.email === true && !sample) {
          const { loadCustomerAccount } = await import("./customer-commerce");
          email =
            (await loadCustomerAccount()).emailAddress?.emailAddress ||
            undefined;
        }
        return response(
          await run((db, a) => preferences(db, a, b, email, sample)),
        );
      }
      case "subscribe":
        return response(await run((db, a) => subscribe(db, a, b.subscription)));
      case "read":
        return response(
          await run(async (db, a) => {
            requireCustomer(a);
            const r = await db.query(
              "update ns.notifications set read_at=coalesce(read_at,now()) where tenant_id=$1 and customer_id=$2 and id=$3 and not cancelled and due_at<=now() returning id",
              [a.tenant_id, a.customer_id, uuid(b.id)],
            );
            if (!r.rows.length)
              throw new AccessError(404, "notification_not_found");
            await customerMetric(
              db,
              a,
              "meaningful_activation",
              "notification-read",
            );
            return { message: "Update marked read." };
          }),
        );
      case "show":
        return response(await run((db, a) => saveShow(db, a, b, sample)));
      case "placement":
        return response(await run((db, a) => savePlacement(db, a, b)));
      case "work": {
        await run(async (_, a) =>
          requireRole(a, ["owner", "admin", "operations"]),
        );
        if (!sample) throw new AccessError(403, "use_scheduled_worker");
        return response(await runNotifications(25, worker, true));
      }
      case "retry": {
        await run(async (_, a) =>
          requireRole(a, ["owner", "admin", "operations"]),
        );
        const id = uuid(b.id);
        return response(
          await worker(async (db) => {
            const r = await db.query(
              "update ns.notification_jobs set state='pending',available_at=now(),last_error=null where tenant_id=$1 and id=$2 and state in('failed','unsent') and attempts<8 and first_attempt_at>now()-interval '23 hours' returning id",
              [TENANT, id],
            );
            if (!r.rows.length)
              throw new AccessError(
                409,
                "retry_window_or_state_requires_review",
              );
            return {
              message:
                "Retry queued. Current consent and source state will be checked again.",
            };
          }),
        );
      }
      default:
        throw new AccessError(400, "unknown_engagement_action");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
