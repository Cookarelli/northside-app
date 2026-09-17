import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import webpush from "web-push";
import { type Sql, type Actor, requireCustomer, transaction } from "./db";
import { AccessError, hashToken, appOrigin } from "./security";
import { TENANT } from "./providers";
import { fixturesAllowed } from "../policy.mjs";
export const notificationKinds = ["grading", "consignment", "break"] as const;
export type NotificationKind = (typeof notificationKinds)[number];
function encryptionKey() {
  const key = Buffer.from(
    process.env.NOTIFICATION_ENCRYPTION_KEY || "",
    "base64",
  );
  if (key.length !== 32)
    throw new AccessError(503, "notification_encryption_not_configured");
  return key;
}
export function protectContact(value: unknown, aad: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  c.setAAD(Buffer.from(aad));
  const b = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return [iv, c.getAuthTag(), b].map((v) => v.toString("base64url")).join(".");
}
function revealContact<T>(s: string, aad: string): T {
  const [iv, tag, b] = s.split(".").map((v) => Buffer.from(v, "base64url")),
    c = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  c.setAAD(Buffer.from(aad));
  c.setAuthTag(tag);
  return JSON.parse(Buffer.concat([c.update(b), c.final()]).toString());
}
export function validateSubscription(value: unknown): webpush.PushSubscription {
  if (!value || typeof value !== "object")
    throw new AccessError(400, "invalid_push_subscription");
  const s = value as webpush.PushSubscription;
  let u: URL;
  try {
    u = new URL(s.endpoint);
  } catch {
    throw new AccessError(400, "invalid_push_endpoint");
  }
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    u.hash ||
    u.href.length > 2500 ||
    !(
      u.hostname === "fcm.googleapis.com" ||
      u.hostname === "updates.push.services.mozilla.com" ||
      u.hostname === "web.push.apple.com" ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname)
    )
  )
    throw new AccessError(400, "unsupported_push_endpoint");
  if (
    !s.keys ||
    !/^[A-Za-z0-9_-]{87}=?$/.test(s.keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys.auth)
  )
    throw new AccessError(400, "invalid_push_keys");
  return {
    endpoint: u.href,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
  };
}
export async function inbox(db: Sql, a: Actor) {
  requireCustomer(a);
  return {
    preferences: (
      await db.query<{
        kind: NotificationKind;
        in_app: boolean;
        email: boolean;
        push: boolean;
      }>(
        "select kind,in_app,email,push from ns.notification_preferences where tenant_id=$1 and customer_id=$2 order by kind",
        [a.tenant_id, a.customer_id],
      )
    ).rows,
    notifications: (
      await db.query(
        "select id,kind,topic,grading_card_id,due_at,read_at from ns.notifications where tenant_id=$1 and customer_id=$2 and visible and not cancelled and due_at<=now() order by due_at desc limit 60",
        [a.tenant_id, a.customer_id],
      )
    ).rows,
    pushConfigured: !!process.env.WEB_PUSH_PUBLIC_KEY,
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY || null,
    deliveryEnabled:
      process.env.NOTIFICATION_DELIVERY_ENABLED === "true" &&
      !fixturesAllowed(process.env),
  };
}
export async function preferences(
  db: Sql,
  a: Actor,
  b: Record<string, unknown>,
  email?: string,
  sample = false,
) {
  requireCustomer(a);
  if (
    !notificationKinds.includes(b.kind as NotificationKind) ||
    ["in_app", "email", "push"].some((k) => typeof b[k] !== "boolean")
  )
    throw new AccessError(400, "invalid_notification_preferences");
  if (b.email === true) {
    if (!sample && !email)
      throw new AccessError(409, "verified_account_email_required");
    await db.query(
      "insert into ns.notification_contacts(tenant_id,customer_id,email_sealed,verified_at) values($1,$2,$3,now()) on conflict(tenant_id,customer_id) do update set email_sealed=excluded.email_sealed,verified_at=now()",
      [
        a.tenant_id,
        a.customer_id,
        sample
          ? "SAMPLE UNSENT"
          : protectContact(email, `${a.tenant_id}/${a.customer_id}/email`),
      ],
    );
  }
  await db.query(
    "insert into ns.notification_preferences(tenant_id,customer_id,kind,in_app,email,push) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,customer_id,kind) do update set in_app=excluded.in_app,email=excluded.email,push=excluded.push,updated_at=now()",
    [a.tenant_id, a.customer_id, b.kind, b.in_app, b.email, b.push],
  );
  return {
    message: "Notification preferences saved. Marketing consent is separate.",
  };
}
export async function subscribe(db: Sql, a: Actor, value: unknown) {
  requireCustomer(a);
  if (!process.env.WEB_PUSH_PUBLIC_KEY)
    throw new AccessError(503, "push_not_configured");
  const s = validateSubscription(value),
    key = hashToken(s.endpoint);
  const other = (
    await db.query(
      "select id from ns.push_subscriptions where tenant_id=$1 and endpoint_hash=$2 and customer_id<>$3",
      [a.tenant_id, key, a.customer_id],
    )
  ).rows;
  if (other.length)
    throw new AccessError(409, "subscription_belongs_to_another_account");
  const saved = await db.query(
    "insert into ns.push_subscriptions(tenant_id,customer_id,endpoint_hash,subscription_sealed) values($1,$2,$3,$4) on conflict(tenant_id,endpoint_hash) do update set active=true,subscription_sealed=excluded.subscription_sealed,updated_at=now() where ns.push_subscriptions.customer_id=excluded.customer_id returning id",
    [
      a.tenant_id,
      a.customer_id,
      key,
      protectContact(s, `${a.tenant_id}/${a.customer_id}/push`),
    ],
  );
  if (!saved.rows.length)
    throw new AccessError(409, "subscription_belongs_to_another_account");
  return {
    message:
      "This browser is registered. Choose which updates may use push below.",
  };
}
export type NotificationJob = {
  id: string;
  lease_token: string;
  attempts: number;
  channel: "email" | "push";
  first_attempt_at: string;
};
export type WorkerRun = <T>(fn: (db: Sql) => Promise<T>) => Promise<T>;
export async function claimNotice(db: Sql) {
  return (
    await db.query<NotificationJob>(
      `with due as(select id from ns.notification_jobs where tenant_id=$1 and ((state='pending' and available_at<=now()) or(state='processing' and lease_until<now())) order by available_at for update skip locked limit 1) update ns.notification_jobs j set state='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_token=$2,lease_until=now()+interval '2 minutes' from due where j.tenant_id=$1 and j.id=due.id returning j.id,j.lease_token,j.attempts,j.channel,j.first_attempt_at`,
      [TENANT, randomUUID()],
    )
  ).rows[0];
}
type Destination = {
  customer_id: string;
  cancelled: boolean;
  allowed: boolean;
  email_sealed: string | null;
  subscription_sealed: string | null;
  subscription_id: string | null;
  active: boolean | null;
};
export type DeliveryResult = {
  state: "accepted" | "unsent" | "failed" | "pending" | "cancelled";
  code: string;
  disablePush?: boolean;
};
export async function deliverNotice(
  j: NotificationJob,
  d: Destination,
  sample = false,
  send = fetch,
  push = webpush.sendNotification,
): Promise<DeliveryResult> {
  if (d.cancelled || !d.allowed)
    return { state: "cancelled", code: "preference_or_source_cancelled" };
  if (
    sample ||
    fixturesAllowed(process.env) ||
    process.env.NOTIFICATION_DELIVERY_ENABLED !== "true"
  )
    return { state: "unsent", code: "UNSENT_delivery_disabled" };
  if (
    j.attempts > 8 ||
    Date.now() - Date.parse(j.first_attempt_at) > 23 * 3600000
  )
    return { state: "failed", code: "manual_review_retry_window_exhausted" };
  try {
    if (j.channel === "email") {
      if (
        !d.email_sealed ||
        !process.env.RESEND_API_KEY ||
        !process.env.NOTIFICATION_EMAIL_FROM
      )
        return { state: "unsent", code: "UNSENT_email_not_configured" };
      const email = revealContact<string>(
        d.email_sealed,
        `${TENANT}/${d.customer_id}/email`,
      );
      const r = await send("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `northside-notice-${j.id}`,
        },
        body: JSON.stringify({
          from: process.env.NOTIFICATION_EMAIL_FROM,
          to: [email],
          subject: "Your Northside account has an update",
          text: `Open your account to view an update: ${appOrigin()}/account/notifications`,
        }),
      });
      if (r.ok && typeof (await r.json()).id === "string")
        return {
          state: "accepted",
          code: "provider_accepted_not_delivery_confirmed",
        };
      return {
        state: r.status === 429 || r.status >= 500 ? "pending" : "failed",
        code: "email_provider_rejected",
      };
    }
    if (
      !d.subscription_sealed ||
      !d.active ||
      !process.env.WEB_PUSH_PRIVATE_KEY ||
      !process.env.WEB_PUSH_PUBLIC_KEY ||
      !process.env.WEB_PUSH_SUBJECT
    )
      return { state: "unsent", code: "UNSENT_push_not_configured" };
    const s = validateSubscription(
      revealContact(d.subscription_sealed, `${TENANT}/${d.customer_id}/push`),
    );
    await push(s, JSON.stringify({ type: "account_update" }), {
      vapidDetails: {
        subject: process.env.WEB_PUSH_SUBJECT,
        publicKey: process.env.WEB_PUSH_PUBLIC_KEY,
        privateKey: process.env.WEB_PUSH_PRIVATE_KEY,
      },
      TTL: 3600,
      topic: hashToken(j.id).slice(0, 32),
      timeout: 10000,
    });
    return {
      state: "accepted",
      code: "provider_accepted_not_device_confirmed",
    };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410)
      return {
        state: "failed",
        code: "push_subscription_expired",
        disablePush: true,
      };
    return {
      state: status && status < 500 && status !== 429 ? "failed" : "pending",
      code: "delivery_network_or_provider_failure",
    };
  }
}
export async function runNotifications(
  limit = 10,
  run: WorkerRun = (fn) => transaction("engagement", fn),
  sample = false,
  delivery = deliverNotice,
) {
  let processed = 0;
  await run(async (db) => {
    await db.query(
      "delete from ns.campaign_touches where tenant_id=$1 and expires_at<=now()",
      [TENANT],
    );
    await db.query(
      "delete from ns.measurement_visitors where tenant_id=$1 and expires_at<=now()",
      [TENANT],
    );
    await db.query(
      "delete from ns.vendor_interests where tenant_id=$1 and consented_at<now()-interval '90 days'",
      [TENANT],
    );
  });
  for (let i = 0; i < Math.min(limit, 25); i++) {
    const j = await run(claimNotice);
    if (!j) break;
    const d = await run(
      async (db) =>
        (
          await db.query<Destination>(
            `select n.customer_id,n.cancelled,case when j.channel='email' then p.email else p.push end allowed,c.email_sealed,s.subscription_sealed,j.subscription_id,s.active from ns.notification_jobs j join ns.notifications n on n.tenant_id=j.tenant_id and n.id=j.notification_id join ns.notification_preferences p on p.tenant_id=n.tenant_id and p.customer_id=n.customer_id and p.kind=n.kind left join ns.notification_contacts c on c.tenant_id=n.tenant_id and c.customer_id=n.customer_id left join ns.push_subscriptions s on s.tenant_id=j.tenant_id and s.id=j.subscription_id where j.tenant_id=$1 and j.id=$2 and j.lease_token=$3 and j.lease_until>now() and j.state='processing'`,
            [TENANT, j.id, j.lease_token],
          )
        ).rows[0],
    );
    if (!d) continue;
    let result = await delivery(j, d, sample);
    if (result.state === "pending" && j.attempts >= 8)
      result = { state: "failed", code: result.code };
    await run(async (db) => {
      const r = await db.query(
        "update ns.notification_jobs set state=$4,last_error=$5,lease_token=null,lease_until=null,available_at=now()+make_interval(secs=>$6) where tenant_id=$1 and id=$2 and lease_token=$3 and state='processing' returning id",
        [
          TENANT,
          j.id,
          j.lease_token,
          result.state,
          result.code,
          Math.min(3600, 15 * 2 ** j.attempts),
        ],
      );
      if (!r.rows.length) return;
      await db.query(
        "insert into ns.notification_attempts(tenant_id,job_id,outcome,code) values($1,$2,$3,$4)",
        [TENANT, j.id, result.state, result.code],
      );
      if (result.disablePush)
        await db.query(
          "update ns.push_subscriptions set active=false where tenant_id=$1 and id=$2",
          [TENANT, d.subscription_id],
        );
    });
    processed++;
  }
  return {
    processed,
    message: sample
      ? "SAMPLE worker complete. All delivery is UNSENT."
      : "Worker batch complete; provider acceptance is not confirmed delivery.",
  };
}
