import { expect, test, vi } from "vitest";
import { submitStaffAuth } from "../apps/customer/lib/staff-auth";

test.each([
  ["request", "/api/auth/staff/request", "/staff/login?requested=1"],
  ["confirm", "/api/auth/staff/callback", "/staff"],
] as const)(
  "%s submits without referrers or automatic redirects",
  async (step, endpoint, destination) => {
    const form = new FormData();
    form.set("token_hash", "synthetic-one-time-token");
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ok: true, redirect: "https://untrusted.invalid" }),
      );
    expect(await submitStaffAuth(step, form, send)).toBe(destination);
    expect(send).toHaveBeenCalledExactlyOnceWith(endpoint, {
      method: "POST",
      body: form,
      mode: "cors",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  },
);

test.each([
  Response.json({ ok: true }, { status: 403 }),
  Response.json({ ok: false }),
  Response.json({ ok: "true" }),
  new Response("<html>Sign in</html>"),
])("invalid responses never complete staff sign-in", async (response) => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(response);
  await expect(
    submitStaffAuth("confirm", new FormData(), send),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledOnce();
});

test("a network or redirect failure is not retried with a one-time token", async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("fetch failed"));
  await expect(
    submitStaffAuth("confirm", new FormData(), send),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledOnce();
});
