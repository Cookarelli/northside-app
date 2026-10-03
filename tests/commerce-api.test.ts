import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../apps/customer/src/in-store/api";
const directory = mkdtempSync(join(tmpdir(), "northside-commerce-test-"));
const password = "staff-test-password-at-least-20-characters";
function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  origin = "http://localhost:3100",
) {
  return new Request(`http://localhost:3100/api/in-store/${path}`, {
    method,
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeAll(() => {
  vi.stubEnv("NORTHSIDE_DB_PATH", join(directory, "test.sqlite"));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CUSTOMER_DATABASE_URL", "");
  vi.stubEnv("COMMERCE_MODE", "fixture");
  vi.stubEnv("STAFF_PASSWORD", password);
  vi.stubEnv("CUSTOMER_ORIGIN", "http://localhost:3100");
  vi.stubEnv("NODE_ENV", "test");
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
describe("customer HTTP authorization boundary", () => {
  it("denies unauthenticated staff and cross-origin customer mutations", async () => {
    expect(
      (await handle(request("staff/queue"), ["staff", "queue"])).status,
    ).toBe(401);
    expect(
      (
        await handle(
          request("staff/fixture-payment", "POST", { id: "other" }),
          ["staff", "fixture-payment"],
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handle(
          request("session", "POST", {}, "", "https://foreign.example"),
          ["session"],
        )
      ).status,
    ).toBe(403);
  });
  it("issues an HttpOnly HTTPS cookie and cannot select another customer by URL", async () => {
    const req = new Request("https://localhost:3100/api/in-store/session", {
      method: "POST",
      headers: {
        origin: "https://localhost:3100",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    vi.stubEnv("CUSTOMER_ORIGIN", "https://localhost:3100");
    const response = await handle(req, ["session"]);
    vi.stubEnv("CUSTOMER_ORIGIN", "http://localhost:3100");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /HttpOnly.*SameSite=Lax.*Secure/,
    );
    const data = await response.json();
    expect(data).not.toHaveProperty("secretHash");
    expect(
      (
        await handle(
          request(
            "session",
            "GET",
            undefined,
            `northside_instore_customer=${data.id}`,
          ),
          ["session"],
        )
      ).status,
    ).toBe(401);
  });
  it("requires staff login and denies fixture/live fallback in production", async () => {
    const response = await handle(
      request("staff/login", "POST", { password }),
      ["staff", "login"],
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(
      (
        await handle(request("staff/queue", "GET", undefined, cookie), [
          "staff",
          "queue",
        ])
      ).status,
    ).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    expect((await handle(request("catalog"), ["catalog"])).status).toBe(503);
    expect(
      (
        await handle(request("staff/login", "POST", { password }), [
          "staff",
          "login",
        ])
      ).status,
    ).toBe(503);
    vi.stubEnv("NODE_ENV", "test");
  });
  it("never contacts Shopify from fixture webhook or reconciliation routes", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network allowed"));
    try {
      expect(
        (
          await handle(request("shopify/webhook", "POST", {}), [
            "shopify",
            "webhook",
          ])
        ).status,
      ).toBe(403);
      const login = await handle(request("staff/login", "POST", { password }), [
        "staff",
        "login",
      ]);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect(
        (
          await handle(
            request(
              "staff/reconcile",
              "POST",
              { orderId: "gid://shopify/Order/1" },
              cookie,
            ),
            ["staff", "reconcile"],
          )
        ).status,
      ).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});
