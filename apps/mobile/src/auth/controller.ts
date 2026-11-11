import type {
  MobileWallet,
  MobileBreaks,
  MobileDeletion,
} from "@northside/customer-contracts/mvp";
import {
  mobileTokenSchema,
  type MobileSession,
  type MobileAccount,
  type MobileOrders,
  type MobileServices,
  type MobileVariant,
} from "@northside/customer-contracts/mobile";
import { MobileApi, MobileFailure } from "../api/client";
import type { ShoppingAction } from "@northside/customer-contracts/shopping";
import type {
  TrackingService,
  TermsAcceptance,
} from "@northside/customer-contracts/tracking";
import type { ServiceRequestInput } from "@northside/customer-contracts/service-requests";
export const accountDestinations = [
  "/account",
  "/my-cards?service=grading",
  "/my-cards?service=consignment",
] as const;
export type AccountDestination = (typeof accountDestinations)[number];

export type AuthSnapshot = {
  status:
    | "booting"
    | "unconfigured"
    | "signed_out"
    | "authenticating"
    | "authenticated";
  busy: boolean;
  message?: string;
  account?: MobileAccount;
  orders?: MobileOrders;
  services?: MobileServices;
  wallet?: MobileWallet;
  breaks?: MobileBreaks;
  deletion?: MobileDeletion;
  extraError?: string;
  logoutConfirmed?: boolean;
  localCredentialsCleared?: boolean;
};
export type AuthPorts = {
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  token(): Promise<string>;
  challenge(verifier: string): Promise<string>;
  browser: {
    open(
      url: string,
      returnUri: string,
    ): Promise<{ type: string; url?: string }>;
    dismiss(): void;
  };
  now(): number;
};
type Pending = {
  destination?: AccountDestination;
  intentId: string;
  state: string;
  verifier: string;
  expiresAt: string;
};
const sessionErrors = new Set([
  "unauthorized",
  "session_expired",
  "reauthentication_required",
  "renewal_replayed",
]);
const token = (v: unknown): v is string =>
  mobileTokenSchema.safeParse(v).success;
export class AuthController {
  private destination: AccountDestination = "/account";
  accountDestination = () => this.destination;
  private visible = true;
  private state: AuthSnapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort = new AbortController();
  private session?: MobileSession;
  private shoppingPrincipal?: string;
  private revocationToken?: string;
  private pending?: Pending;
  private exchangeBusy = false;
  private initialized = false;
  private renewal?: Promise<void>;
  private storageQueue: Promise<unknown> = Promise.resolve();
  private absoluteExpiry?: number;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly api: MobileApi | null,
    private readonly settings: {
      variant: MobileVariant;
      returnUri: string;
    } | null,
    private readonly ports: AuthPorts,
  ) {
    this.state = {
      status: api && settings ? "booting" : "unconfigured",
      busy: false,
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: AuthSnapshot) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }
  private save<T>(op: () => Promise<T>): Promise<T> {
    const next = this.storageQueue.then(op, op);
    this.storageQueue = next.catch(() => {});
    return next;
  }
  private current(g: number) {
    if (g !== this.generation) throw new MobileFailure("cancelled");
  }
  private reset(status: AuthSnapshot["status"], message?: string) {
    this.destination = "/account";
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.absoluteExpiry = undefined;
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.session = undefined;
    this.shoppingPrincipal = undefined;
    this.revocationToken = undefined;
    this.pending = undefined;
    this.renewal = undefined;
    this.update({ status, busy: false, message });
    return this.generation;
  }
  private expireIfDue() {
    if (
      this.absoluteExpiry === undefined ||
      this.ports.now() < this.absoluteExpiry
    )
      return false;
    const g = this.reset("signed_out", "session_expired");
    // Clear visible records synchronously, then serialize OS credential removal.
    void this.clear().catch(() => {
      if (g === this.generation)
        this.update({
          status: "signed_out",
          busy: false,
          message: "storage_unavailable",
        });
    });
    return true;
  }
  private scheduleExpiry(deadline: number) {
    clearTimeout(this.expiryTimer);
    this.absoluteExpiry = deadline;
    if (this.expireIfDue()) return;
    this.expiryTimer = setTimeout(
      () => {
        if (!this.expireIfDue() && this.absoluteExpiry !== undefined)
          this.scheduleExpiry(this.absoluteExpiry);
      },
      Math.min(2147483647, Math.max(0, deadline - this.ports.now())),
    );
    // Node test processes need not stay alive for a native session's lifetime.
    (this.expiryTimer as unknown as { unref?: () => void }).unref?.();
  }
  private async clear() {
    await this.save(async () => {
      const results = await Promise.allSettled([
        this.ports.storage.remove("renewal"),
        this.ports.storage.remove("pending"),
      ]);
      if (results.some((result) => result.status === "rejected"))
        throw new MobileFailure("storage_unavailable");
    });
  }
  async initialize(initialUrl?: string | null) {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.api || !this.settings) return;
    const g = this.generation;
    try {
      const signedOut = await this.save(() =>
        this.ports.storage.get("signed_out"),
      );
      this.current(g);
      if (signedOut) {
        await this.clear();
        this.update({ status: "signed_out", busy: false });
        return;
      }
      const raw = await this.save(() => this.ports.storage.get("pending"));
      this.current(g);
      if (raw) {
        const p = JSON.parse(raw) as Pending;
        if (
          token(p.intentId) &&
          token(p.state) &&
          token(p.verifier) &&
          Date.parse(p.expiresAt) > this.ports.now()
        ) {
          this.pending = p;
          this.destination = accountDestinations.includes(
            p.destination as AccountDestination,
          )
            ? p.destination!
            : "/account";
          this.update({ status: "signed_out", busy: false });
          if (initialUrl) {
            await this.receive(initialUrl);
            return;
          }
        } else await this.save(() => this.ports.storage.remove("pending"));
      }
      const renewal = await this.save(() => this.ports.storage.get("renewal"));
      this.current(g);
      if (renewal) {
        if (!token(renewal)) throw new MobileFailure("session_expired");
        this.revocationToken = renewal;
        await this.accept(await this.api.renew(renewal, this.abort.signal), g);
        await this.load();
      } else
        this.update({
          status: "signed_out",
          busy: false,
          ...(initialUrl ? { message: "invalid_callback" } : {}),
        });
    } catch (error) {
      if (g !== this.generation) return;
      this.reset("signed_out", this.code(error));
      await this.clear().catch(() => {});
    }
  }
  private async accept(session: MobileSession, g: number) {
    this.current(g);
    if (
      Date.parse(session.absoluteExpiresAt) <= this.ports.now() ||
      Date.parse(session.accessExpiresAt) <= this.ports.now()
    )
      throw new MobileFailure("session_expired");
    await this.save(() =>
      this.ports.storage.set("renewal", session.renewalToken),
    );
    this.current(g);
    if (Date.parse(session.absoluteExpiresAt) <= this.ports.now())
      throw new MobileFailure("session_expired");
    this.session = session;
    this.shoppingPrincipal ??= `${session.customerId}:${g}`;
    this.revocationToken = session.renewalToken;
    this.scheduleExpiry(Date.parse(session.absoluteExpiresAt));
    this.current(g);
    // A same-customer access rotation retains the already validated account
    // boundary so a private view does not mistake renewal for a new sign-in.
    // Fresh login/restore and background hiding have no account to retain.
    const account =
      this.visible &&
      this.state.status === "authenticated" &&
      this.state.account?.customer.id === session.customerId
        ? this.state.account
        : undefined;
    this.update({
      status: "authenticated",
      busy: false,
      ...(account ? { account } : {}),
    });
  }
  async login(destination: AccountDestination = "/account") {
    if (!this.api || !this.settings) return;
    if (this.state.status === "authenticating") return;
    const old = this.revocationToken;
    const g = this.reset("authenticating");
    this.destination = accountDestinations.includes(destination)
      ? destination
      : "/account";
    try {
      await this.clear();
      await this.save(() => this.ports.storage.remove("signed_out"));
      this.current(g);
      if (old) await this.api.logout(old).catch(() => {});
      this.current(g);
      const verifier = await this.ports.token(),
        state = await this.ports.token();
      this.current(g);
      const intent = await this.api.intent(
        {
          variant: this.settings.variant,
          appState: state,
          challenge: await this.ports.challenge(verifier),
          challengeMethod: "S256",
        },
        this.abort.signal,
      );
      this.current(g);
      const expected = new URL(this.api.base + "/auth/start");
      expected.searchParams.set("intent", intent.intentId);
      if (
        intent.startUrl !== expected.toString() ||
        Date.parse(intent.expiresAt) <= this.ports.now()
      )
        throw new MobileFailure("invalid_response");
      this.pending = {
        destination: this.destination,
        intentId: intent.intentId,
        state,
        verifier,
        expiresAt: intent.expiresAt,
      };
      await this.save(() =>
        this.ports.storage.set("pending", JSON.stringify(this.pending)),
      );
      this.current(g);
      const result = await this.ports.browser.open(
        intent.startUrl,
        this.settings.returnUri,
      );
      this.current(g);
      if (result.type === "success" && result.url)
        await this.receive(result.url);
      else if (this.pending?.intentId === intent.intentId) {
        this.pending = undefined;
        await this.save(() => this.ports.storage.remove("pending"));
        this.update({
          status: "signed_out",
          busy: false,
          message: "cancelled",
        });
      }
    } catch (error) {
      if (g !== this.generation) return;
      this.reset("signed_out", this.code(error));
      await this.clear().catch(() => {});
    }
  }
  async receive(raw: string) {
    if (!this.api || !this.settings || !this.pending || this.exchangeBusy)
      return;
    const g = this.generation,
      p = this.pending;
    try {
      const url = new URL(raw),
        base = new URL(this.settings.returnUri);
      if (
        url.protocol !== base.protocol ||
        url.host !== base.host ||
        url.pathname !== base.pathname ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.size !== 3 ||
        [...url.searchParams.keys()].some(
          (k) => !["ticket", "error", "intent", "state"].includes(k),
        ) ||
        url.searchParams.get("intent") !== p.intentId ||
        url.searchParams.get("state") !== p.state ||
        Date.parse(p.expiresAt) <= this.ports.now()
      )
        throw new MobileFailure("invalid_callback");
      for (const key of url.searchParams.keys())
        if (url.searchParams.getAll(key).length !== 1)
          throw new MobileFailure("invalid_callback");
      const ticket = url.searchParams.get("ticket");
      if (!ticket && url.searchParams.get("error") !== "cancelled")
        throw new MobileFailure("invalid_callback");
      if (ticket && !token(ticket)) throw new MobileFailure("invalid_callback");
      // Consume locally before any network call, including cold-start and duplicate deep links.
      this.exchangeBusy = true;
      this.pending = undefined;
      await this.save(() => this.ports.storage.remove("pending"));
      this.current(g);
      if (!ticket) {
        this.update({
          status: "signed_out",
          busy: false,
          message: "cancelled",
        });
        return;
      }
      await this.accept(
        await this.api.exchange(
          {
            intentId: p.intentId,
            ticket,
            appState: p.state,
            verifier: p.verifier,
          },
          this.abort.signal,
        ),
        g,
      );
      await this.load();
    } catch (error) {
      if (g !== this.generation) return;
      this.reset("signed_out", this.code(error));
      await this.clear().catch(() => {});
    } finally {
      this.exchangeBusy = false;
    }
  }
  private async access(g: number) {
    if (this.expireIfDue()) throw new MobileFailure("session_expired");
    // Parallel private reads and shopping commands share the same rotation.
    // The access credential is intentionally hidden while that rotation runs.
    if (this.renewal) {
      await this.renewal;
      this.current(g);
    }
    if (!this.api || !this.session) throw new MobileFailure("session_expired");
    if (Date.parse(this.session.accessExpiresAt) <= this.ports.now() + 60000) {
      if (!this.renewal) {
        const renewal = this.session.renewalToken,
          customerId = this.session.customerId;
        this.session = undefined;
        this.renewal = (async () => {
          const next = await this.api!.renew(renewal, this.abort.signal);
          if (next.customerId !== customerId)
            throw new MobileFailure("unauthorized");
          await this.accept(next, g);
        })().finally(() => {
          this.renewal = undefined;
        });
      }
      await this.renewal;
    }
    this.current(g);
    return this.session!.accessToken;
  }
  /** Nonsecret identity boundary; remains stable while private UI is hidden. */
  shoppingIdentity() {
    return this.shoppingPrincipal ?? this.state.status;
  }
  /** Private tracking uses the existing renewal, cancellation and identity fence.
   * Credentials never enter a view, URL, persistent image cache or client log. */
  private async trackingRequest<T>(
    run: (api: MobileApi, access: string, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    if (!this.visible || signal?.aborted) throw new MobileFailure("cancelled");
    if (!this.api || this.state.status !== "authenticated")
      throw new MobileFailure("reauthentication_required");
    const g = this.generation,
      combined = new AbortController(),
      identity = this.abort.signal,
      abort = () => combined.abort();
    signal?.addEventListener("abort", abort, { once: true });
    identity.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || identity.aborted) combined.abort();
    try {
      const access = await this.access(g);
      this.current(g);
      const result = await run(this.api, access, combined.signal);
      this.current(g);
      if (!this.visible || combined.signal.aborted)
        throw new MobileFailure("cancelled");
      return result;
    } catch (e) {
      this.current(g);
      if (
        !this.session ||
        (e instanceof MobileFailure && sessionErrors.has(e.code))
      ) {
        this.reset("signed_out", this.code(e));
        await this.clear().catch(() => {});
      }
      throw e;
    } finally {
      signal?.removeEventListener("abort", abort);
      identity.removeEventListener("abort", abort);
    }
  }
  tracking(service: TrackingService, signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.tracking(access, service, s),
      signal,
    );
  }
  serviceRequests(signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.serviceRequests(access, s),
      signal,
    );
  }
  claimServiceRequest(id: string, claim_token: string, signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.claimServiceRequest(access, id, claim_token, s),
      signal,
    );
  }
  serviceRequestConfig(signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.serviceRequestConfig(access, s),
      signal,
    );
  }
  submitServiceRequest(
    input: ServiceRequestInput,
    platform: "ios" | "android",
    signal?: AbortSignal,
  ) {
    return this.trackingRequest(
      (api, access, s) => api.submitServiceRequest(access, input, platform, s),
      signal,
    );
  }
  trackingDetail(service: TrackingService, id: string, signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.trackingDetail(access, service, id, s),
      signal,
    );
  }
  acceptTerms(input: TermsAcceptance, signal?: AbortSignal) {
    return this.trackingRequest(
      (api, access, s) => api.acceptTerms(access, input, s),
      signal,
    );
  }
  trackingPhoto(
    service: TrackingService,
    id: string,
    photo: string,
    signal?: AbortSignal,
  ) {
    return this.trackingRequest(
      (api, access, s) => api.trackingPhoto(access, service, id, photo, s),
      signal,
    );
  }
  /** Use existing renewal/identity fencing without exposing credentials to views. */
  async shoppingOn(
    api: MobileApi,
    action: ShoppingAction,
    sessionToken?: string,
    signal?: AbortSignal,
  ) {
    if (!this.visible || signal?.aborted) throw new MobileFailure("cancelled");
    if (
      this.state.status === "booting" ||
      this.state.status === "authenticating"
    )
      throw new MobileFailure("reauthentication_required");
    if (
      this.state.status === "authenticated" &&
      (!this.api || api.origin !== this.api.origin)
    )
      throw new MobileFailure("not_configured");
    const g = this.generation;
    const combined = new AbortController();
    const abort = () => combined.abort();
    const identitySignal = this.abort.signal;
    signal?.addEventListener("abort", abort, { once: true });
    identitySignal.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || identitySignal.aborted) combined.abort();
    try {
      const access =
        this.state.status === "authenticated"
          ? await this.access(g)
          : undefined;
      this.current(g);
      const result = await api.shopping(
        action,
        sessionToken,
        access,
        combined.signal,
      );
      this.current(g);
      if (!this.visible || combined.signal.aborted)
        throw new MobileFailure("cancelled");
      return result;
    } catch (error) {
      this.current(g);
      if (
        this.state.status === "authenticated" &&
        (!this.session ||
          (error instanceof MobileFailure && sessionErrors.has(error.code)))
      ) {
        this.reset("signed_out", this.code(error));
        await this.clear().catch(() => {});
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      identitySignal.removeEventListener("abort", abort);
    }
  }
  async load(after?: string) {
    if (!this.visible || !this.api || !this.session || this.state.busy) return;
    const g = this.generation,
      previous = this.state.orders;
    this.update({ ...this.state, busy: true, message: undefined });
    try {
      const access = await this.access(g);
      const [account, orders, cards, consignments] = await Promise.all([
        this.api.account(access, this.abort.signal),
        this.api.orders(access, after, this.abort.signal),
        this.api.services(access, "cards", this.abort.signal),
        this.api.services(access, "consignments", this.abort.signal),
      ]);
      this.current(g);
      if (account.customer.id !== this.session?.customerId)
        throw new MobileFailure("unauthorized");
      const items = [...cards.items, ...consignments.items].filter(
        (v, i, a) => a.findIndex((x) => x.id === v.id) === i,
      );
      const extras = await Promise.allSettled([
        this.api.wallet(access, this.abort.signal),
        this.api.breaks(access, this.abort.signal),
        this.api.deletionStatus(access, this.abort.signal),
      ]);
      this.current(g);
      const expired = extras.find(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof MobileFailure &&
          sessionErrors.has(result.reason.code),
      );
      if (expired?.status === "rejected") throw expired.reason;
      this.update({
        status: "authenticated",
        busy: false,
        wallet: extras[0].status === "fulfilled" ? extras[0].value : undefined,
        breaks: extras[1].status === "fulfilled" ? extras[1].value : undefined,
        deletion:
          extras[2].status === "fulfilled" ? extras[2].value : undefined,
        extraError: extras.some((result) => result.status === "rejected")
          ? "unavailable"
          : undefined,
        account,
        orders:
          after && previous
            ? { ...orders, orders: [...previous.orders, ...orders.orders] }
            : orders,
        services: { ...cards, items },
      });
    } catch (error) {
      if (g !== this.generation) return;
      const code = this.code(error);
      if (
        sessionErrors.has(code) ||
        !this.session ||
        Date.parse(this.session.absoluteExpiresAt) <= this.ports.now()
      ) {
        this.reset("signed_out", code);
        await this.clear().catch(() => {});
      } else
        this.update({ status: "authenticated", busy: false, message: code });
    }
  }
  async requestDeletion(expected: {
    customerId: string;
    sessionExpiresAt: string;
  }) {
    if (
      !this.api ||
      !this.session ||
      this.session.customerId !== expected.customerId ||
      this.session.absoluteExpiresAt !== expected.sessionExpiresAt
    )
      return;
    const g = this.generation;
    this.update({ ...this.state, busy: true, message: undefined });
    try {
      const access = await this.access(g);
      const receipt = await this.api.requestDeletion(access, this.abort.signal);
      this.current(g);
      if (!receipt.request) throw new MobileFailure("invalid_response");
      await this.logout();
      if (this.state.status === "signed_out")
        this.update({ ...this.state, message: "deletion_requested" });
    } catch (error) {
      if (g !== this.generation) return;
      this.update({
        status: "authenticated",
        busy: false,
        message: this.code(error),
      });
      if (
        !this.session ||
        (error instanceof MobileFailure && sessionErrors.has(error.code))
      ) {
        this.reset("signed_out", this.code(error));
        await this.clear().catch(() => {});
      }
    }
  }
  async logout() {
    const renewal = this.revocationToken;
    const g = this.reset(
      this.api && this.settings ? "signed_out" : "unconfigured",
    );
    this.ports.browser.dismiss();
    let deleted = true;
    // A nonsecret tombstone prevents automatic restore after a partial OS deletion failure.
    try {
      await this.save(() => this.ports.storage.set("signed_out", "1"));
    } catch {
      deleted = false;
    }
    try {
      await this.clear();
    } catch {
      deleted = false;
    }
    let confirmed = false;
    if (renewal && this.api)
      try {
        await this.api.logout(renewal);
        confirmed = true;
      } catch {}
    // An old logout response cannot alter a newly started account session.
    if (g === this.generation && this.state.status === "signed_out")
      this.update({
        ...this.state,
        logoutConfirmed: confirmed,
        localCredentialsCleared: deleted,
        message: deleted ? "logged_out" : "storage_unavailable",
      });
  }
  setVisibility(active: boolean) {
    this.visible = active;
    if (this.expireIfDue()) return;
    if (!active) this.hidePrivate();
  }
  hidePrivate() {
    if (this.state.status === "authenticated") {
      this.generation++;
      this.abort.abort();
      this.abort = new AbortController();
      this.update({ status: "authenticated", busy: false });
      if (this.renewal) {
        this.session = undefined;
        this.reset("signed_out", "reauthentication_required");
        void this.clear().catch(() => {});
      }
    }
  }
  private code(error: unknown) {
    return error instanceof MobileFailure ? error.code : "storage_unavailable";
  }
}
