import { afterEach, describe, it, expect, vi } from "vitest";
import {
  MemoryStore,
  login,
  logout,
  requireRole,
  assertSameOrigin,
} from "../packages/data/src/index";
const url = "http://127.0.0.1:3101/api/control/login";
const request = (password: string, origin = "http://127.0.0.1:3101") =>
  new Request(url, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
afterEach(() => vi.unstubAllEnvs());
describe("remote authorization", () => {
  it("requires same-origin and separately scoped sessions, revokes on logout/password rotation", async () => {
    vi.stubEnv("OPERATOR_PASSWORD", "operator-strong-password-for-test");
    vi.stubEnv("STAFF_PASSWORD", "staff-strong-password-for-test");
    const store = new MemoryStore();
    await expect(
      requireRole(new Request(url), "operator", store),
    ).rejects.toThrow("Sign in");
    expect(() =>
      assertSameOrigin(request("x", "https://evil.example")),
    ).toThrow("Origin");
    const r = await login(
        request("operator-strong-password-for-test"),
        "operator",
        store,
      ),
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    const sessionReq = new Request(url, {
      method: "POST",
      headers: { cookie, origin: "http://127.0.0.1:3101" },
    });
    expect((await requireRole(sessionReq, "operator", store)).id).toBe("steve");
    await expect(requireRole(sessionReq, "staff", store)).rejects.toThrow();
    await logout(sessionReq, "operator", store);
    await expect(requireRole(sessionReq, "operator", store)).rejects.toThrow();
    const again = await login(
      request("operator-strong-password-for-test"),
      "operator",
      store,
    );
    vi.stubEnv("OPERATOR_PASSWORD", "new-operator-strong-password");
    await expect(
      requireRole(
        new Request(url, {
          headers: { cookie: again.headers.get("set-cookie")!.split(";")[0] },
        }),
        "operator",
        store,
      ),
    ).rejects.toThrow("expired");
  });
  it("limits failed login attempts persistently", async () => {
    vi.stubEnv("OPERATOR_PASSWORD", "operator-strong-password-for-test");
    const store = new MemoryStore();
    for (let n = 0; n < 10; n++)
      await expect(login(request("bad"), "operator", store)).rejects.toThrow(
        "Invalid",
      );
    await expect(
      login(request("operator-strong-password-for-test"), "operator", store),
    ).rejects.toThrow("Too many");
  });
});

it("uses only the owning app canonical origin behind a reverse proxy", () => {
  vi.stubEnv("NORTHSIDE_DATA_SCOPE", "control");
  vi.stubEnv("CONTROL_ORIGIN", "https://control.example");
  vi.stubEnv("CUSTOMER_ORIGIN", "https://shop.example");
  expect(() =>
    assertSameOrigin(
      new Request("http://internal/api/control/commands", {
        headers: { origin: "https://control.example" },
      }),
    ),
  ).not.toThrow();
  expect(() =>
    assertSameOrigin(
      new Request("http://internal/api/control/commands", {
        headers: { origin: "https://shop.example" },
      }),
    ),
  ).toThrow("Origin");
});

it("accepts only the server-provided preview origin and rejects spoofed hosts", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", "northside-control-proof.vercel.app");
  vi.stubEnv("NORTHSIDE_DATA_SCOPE", "control");
  vi.stubEnv("CONTROL_ORIGIN", "https://control.example");
  expect(() =>
    assertSameOrigin(
      request("x", "https://northside-control-proof.vercel.app"),
    ),
  ).not.toThrow();
  expect(() =>
    assertSameOrigin(
      new Request("https://evil.vercel.app/api", {
        headers: {
          origin: "https://evil.vercel.app",
          host: "northside-control-proof.vercel.app",
          "x-forwarded-host": "northside-control-proof.vercel.app",
        },
      }),
    ),
  ).toThrow("Origin");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(() =>
    assertSameOrigin(
      request("x", "https://northside-control-proof.vercel.app"),
    ),
  ).toThrow("Origin");
});

it("rejects anonymous access before creating a hosted database connection", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NORTHSIDE_DATA_DATABASE_URL", "");
  await expect(requireRole(new Request(url), "operator")).rejects.toMatchObject(
    { status: 401 },
  );
});
