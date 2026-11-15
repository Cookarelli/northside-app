import { describe, expect, it, jest } from "@jest/globals";
import { MobileApi, MOBILE_RESPONSE_LIMIT } from "../src/api/client";
const REQUEST = "11111111-1111-4111-8111-111111111111",
  PHOTO = "22222222-2222-4222-8222-222222222222",
  TOKEN = "A".repeat(43),
  origin = "https://private-photo-verifier.example.invalid";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const api = (request: typeof fetch, timeout = 1000) =>
  new MobileApi(origin, request, timeout, async () => {});
describe("private request photo transport", () => {
  it("sends one bounded binary upload with owner bearer auth, no browser credentials or redirects", async () => {
    const request = jest.fn<typeof fetch>(async () => json({ id: PHOTO })),
      bytes = new Uint8Array([255, 216, 255, 217]);
    expect(
      await api(request).uploadServiceRequestPhoto(
        TOKEN,
        REQUEST,
        PHOTO,
        bytes,
      ),
    ).toEqual({ id: PHOTO });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(
      `${origin}/api/mobile/v1/me/request-photos?request_id=${REQUEST}&photo_id=${PHOTO}`,
    );
    expect(options).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/jpeg",
          Accept: "application/json",
        },
      }),
    );
    expect(options?.body).toEqual(bytes);
  });
  it("invalid identifiers, empty images and oversized uploads fail before transport", async () => {
    const request = jest.fn<typeof fetch>();
    for (const [id, bytes] of [
      ["not-an-id", new Uint8Array([1])],
      [PHOTO, new Uint8Array()],
      [PHOTO, new Uint8Array(4194305)],
    ] as const)
      await expect(
        api(request).uploadServiceRequestPhoto(TOKEN, REQUEST, id, bytes),
      ).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [401, "session_expired"],
    [429, "rate_limited"],
    [503, "service_unavailable"],
  ] as const)(
    "upload HTTP%s returns a safe error without automatic retries",
    async (status, code) => {
      const request = jest.fn<typeof fetch>(async () =>
        json({ error: "SAMPLE provider internals" }, status),
      );
      await expect(
        api(request).uploadServiceRequestPhoto(
          TOKEN,
          REQUEST,
          PHOTO,
          new Uint8Array([1]),
        ),
      ).rejects.toMatchObject({ code });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    () => new Response("not-json"),
    () => json({ id: REQUEST }),
    () => new Response("x".repeat(MOBILE_RESPONSE_LIMIT + 1)),
  ])(
    "malformed or oversized success replies never acknowledge a photo",
    async (response) => {
      const request = jest.fn<typeof fetch>(async () => response());
      await expect(
        api(request).uploadServiceRequestPhoto(
          TOKEN,
          REQUEST,
          PHOTO,
          new Uint8Array([1]),
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );
  it("already aborted upload does no network work and an in-flight abort is normalized", async () => {
    const request = jest.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(Error("SAMPLE native abort details")),
            { once: true },
          );
        }),
    );
    const stopped = new AbortController();
    stopped.abort();
    await expect(
      api(request).uploadServiceRequestPhoto(
        TOKEN,
        REQUEST,
        PHOTO,
        new Uint8Array([1]),
        stopped.signal,
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(request).not.toHaveBeenCalled();
    const active = new AbortController(),
      pending = api(request).uploadServiceRequestPhoto(
        TOKEN,
        REQUEST,
        PHOTO,
        new Uint8Array([1]),
        active.signal,
      ),
      rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
    active.abort();
    await rejected;
  });
  it("a stalled raw upload times out through the same safe error contract", async () => {
    const request = jest.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(Error("SAMPLE timeout details")),
            { once: true },
          );
        }),
    );
    await expect(
      api(request, 10).uploadServiceRequestPhoto(
        TOKEN,
        REQUEST,
        PHOTO,
        new Uint8Array([1]),
      ),
    ).rejects.toMatchObject({ code: "timeout" });
  });
  it("private photo reads omit cookies/cache and reject MIME confusion and advertised oversize", async () => {
    const request = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([255, 216, 255, 217]), {
          headers: { "content-type": "image/jpeg" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("SAMPLE HTML", {
          headers: { "content-type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("x", {
          headers: {
            "content-type": "image/jpeg",
            "content-length": "5242881",
          },
        }),
      );
    expect(await api(request).serviceRequestPhoto(TOKEN, PHOTO)).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "image/jpeg,image/png,image/webp",
        },
      }),
    );
    await expect(
      api(request).serviceRequestPhoto(TOKEN, PHOTO),
    ).rejects.toMatchObject({ code: "invalid_response" });
    await expect(
      api(request).serviceRequestPhoto(TOKEN, PHOTO),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("a private stream exceeding its declared size is bounded and cancelled", async () => {
    const cancel = jest.fn<() => void>();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(5242881));
      },
      cancel,
    });
    const request = jest.fn<typeof fetch>(
      async () =>
        new Response(stream, {
          headers: { "content-type": "image/jpeg", "content-length": "1" },
        }),
    );
    await expect(
      api(request).serviceRequestPhoto(TOKEN, PHOTO),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancel).toHaveBeenCalled();
  });
});
