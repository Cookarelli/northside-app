import "server-only";
import { type Sql, type Actor, requireRole } from "./db";
import { AccessError } from "./security";
import { boundedJson } from "./grading-api";
import { uuid, shortText, integer } from "./loyalty";
import {
  saveBreak,
  saveReminder,
  participantConsent,
  myBreaks,
  staffBreaks,
  addMapping,
  setMappingActive,
  breakAudit,
  type BreakMode,
} from "./breaks";
import { legacyPurchase, reviewPurchase } from "./break-purchases";
import { saleCheck } from "./break-commerce";
import { enqueueBreakOrder } from "./break-worker";
import { gid } from "./shopify-config";
export async function breakApi(
  request: Request,
  db: Sql,
  a: Actor,
  mode: BreakMode = "live",
) {
  const url = new URL(request.url);
  if (request.method === "GET")
    return url.searchParams.get("staff") === "1"
      ? staffBreaks(db, a, mode)
      : myBreaks(db, a);
  const b = await boundedJson(request),
    reason = typeof b.reason === "string" ? b.reason : "";
  switch (b.action) {
    case "event":
      return saveBreak(
        db,
        a,
        b.event,
        uuid(b.id),
        b.version === null ? null : integer(b.version, 1),
        reason,
        mode,
      );
    case "reminder":
      return saveReminder(
        db,
        a,
        uuid(b.event_id),
        integer(b.lead_minutes),
        b.active === true,
        mode,
      ).then(() => ({
        message:
          "Reminder preference saved. Delivery follows your account notification preferences.",
      }));
    case "alias":
      return participantConsent(
        db,
        a,
        uuid(b.event_id),
        shortText(b.display_name, 60),
        b.consented === true,
        mode,
      ).then(() => ({ message: "Participant display preference saved." }));
    case "mapping":
      return addMapping(
        db,
        a,
        uuid(b.event_id),
        b.mapping as Parameters<typeof addMapping>[3],
        reason,
      );
    case "mapping-active":
      return setMappingActive(
        db,
        a,
        uuid(b.mapping_id),
        b.active === true,
        reason,
      ).then(() => ({
        message: "Mapping updated; sale reconciliation must be repeated.",
      }));
    case "sale-check":
      return saleCheck(
        db,
        a,
        uuid(b.event_id),
        b.checks as Record<string, unknown>,
        shortText(b.evidence, 2000),
        reason,
        mode,
      );
    case "legacy":
      return legacyPurchase(
        db,
        a,
        b.purchase as Parameters<typeof legacyPurchase>[2],
        reason,
      );
    case "release":
    case "void-legacy":
      return reviewPurchase(
        db,
        a,
        uuid(b.purchase_id),
        b.action,
        integer(b.quantity ?? 1, 1, 500),
        reason,
      ).then(() => ({
        message:
          "Review saved. Shopify and external payments were not changed.",
      }));
    case "resolve": {
      requireRole(a, ["owner", "admin", "operations"]);
      const id = uuid(b.exception_id);
      const x = (
        await db.query<{ event_id: string | null }>(
          "update ns.break_exceptions set status='resolved',resolution=$3,actor_id=$4 where tenant_id=$1 and id=$2 and status='open' returning event_id",
          [a.tenant_id, id, shortText(reason), a.staff_id],
        )
      ).rows[0];
      if (!x)
        throw new AccessError(409, "exception_already_resolved_or_missing");
      if (x.event_id)
        await breakAudit(
          db,
          a,
          x.event_id,
          "exception.resolved",
          reason,
          null,
          { id },
        );
      return {
        message:
          "Exception resolution recorded; no spot was granted or released.",
      };
    }
    case "retry": {
      requireRole(a, ["owner", "admin", "operations"]);
      shortText(reason);
      const id = uuid(b.job_id);
      const j = (
        await db.query<{ order_id: string }>(
          "update ns.break_jobs set state='pending',attempts=0,available_at=now(),lease_token=null,lease_until=null,last_error=$3 where tenant_id=$1 and id=$2 and (state='review' or (state='pending' and attempts>0)) returning order_id",
          [a.tenant_id, id, "Staff retry: " + reason],
        )
      ).rows[0];
      if (!j) throw new AccessError(409, "job_not_retryable");
      return { message: "Fresh Shopify reconciliation queued." };
    }
    case "recheck": {
      requireRole(a, ["owner", "admin", "operations"]);
      shortText(reason);
      await enqueueBreakOrder(
        db,
        gid(b.order_id, "Order"),
        "staff/" + uuid(b.request_id),
      );
      return {
        message:
          "Fresh Shopify order read queued. No entitlement is granted from this request.",
      };
    }
    default:
      throw new AccessError(400, "unknown_break_action");
  }
}
