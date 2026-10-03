/* Northside PWA v1. Cache allowlist contains public static files only. */
const CACHE = "northside-public-v1";
const STATIC = [
  "/pwa/offline.html",
  "/pwa/offline.css",
  "/northside-logo.svg",
  "/pwa/icon-180.png",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of STATIC) {
        const r = await fetch(path, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
        if (!r.ok || r.type === "opaque")
          throw Error("Public offline asset unavailable");
        await cache.put(path, r);
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("northside-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const r = event.request,
    u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== self.location.origin) return;
  if (!u.search && STATIC.includes(u.pathname)) {
    event.respondWith(
      (async () =>
        (await (await caches.open(CACHE)).match(u.pathname)) || fetch(r))(),
    );
    return;
  }
  // APIs, Next/RSC fetches, images, carts and checkout never enter a cache.
  if (r.mode === "navigate" && !u.pathname.startsWith("/api/"))
    event.respondWith(
      fetch(r).catch(
        async () =>
          (await (await caches.open(CACHE)).match("/pwa/offline.html")) ||
          new Response(
            "Connection needed. No private records are available offline.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
              },
            },
          ),
      ),
    );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") void self.skipWaiting();
  if (event.data?.type === "LOGOUT")
    event.waitUntil(
      (async () => {
        for (const n of await caches.keys())
          if (n.startsWith("northside-") && n !== CACHE) await caches.delete(n);
        for (const c of await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })) {
          if (c.id !== event.source?.id)
            c.postMessage({ type: "SESSION_LOCKED" });
        }
      })(),
    );
});
self.addEventListener("push", (event) => {
  // No payload text or URL is trusted on a shared lock screen.
  event.waitUntil(
    self.registration.showNotification("Northside Collectibles", {
      body: "You have an account update. Sign in to view it.",
      icon: "/pwa/icon-192.png",
      badge: "/pwa/icon-192.png",
      tag: "northside-account-update",
      data: { url: "/account/notifications" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/account/notifications"));
});
