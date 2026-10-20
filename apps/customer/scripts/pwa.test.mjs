import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile("public/sw.js", "utf8");
function harness() {
  const events = {},
    cache = new Map(),
    puts = [],
    deleted = [],
    messages = [],
    notices = [];
  let offline = false;
  const self = {
    location: { origin: "https://northside.example" },
    addEventListener: (type, fn) => {
      events[type] = fn;
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [
        { id: "other", postMessage: (m) => messages.push(m) },
        {
          id: "caller",
          postMessage: () => {
            throw Error("Must not interrupt the caller logout request");
          },
        },
      ],
      openWindow: async (url) => messages.push(url),
    },
    skipWaiting: async () => {},
    registration: { showNotification: async (...args) => notices.push(args) },
  };
  vm.runInNewContext(source, {
    self,
    URL,
    Response,
    Error,
    caches: {
      open: async () => ({
        put: async (path, r) => {
          puts.push(path);
          cache.set(path, r);
        },
        match: async (path) => cache.get(path)?.clone(),
      }),
      keys: async () => [
        "northside-private-obsolete",
        "northside-public-v1",
        "unrelated-app",
      ],
      delete: async (name) => deleted.push(name),
    },
    fetch: async (r) => {
      if (offline) throw Error("offline");
      return new Response("PUBLIC " + (typeof r === "string" ? r : r.url));
    },
  });
  const dispatch = async (type, fields = {}) => {
    let done = Promise.resolve(),
      response;
    events[type]({
      ...fields,
      waitUntil: (p) => {
        done = p;
      },
      respondWith: (p) => {
        response = p;
      },
    });
    await done;
    return response ? await response : undefined;
  };
  return {
    dispatch,
    puts,
    deleted,
    messages,
    notices,
    offline: () => {
      offline = true;
    },
  };
}
test("service worker caches only exact public static allowlist, never account, API, RSC, image, cart or checkout responses", async () => {
  const h = harness();
  await h.dispatch("install");
  assert.equal(h.puts.length, 6);
  for (const path of [
    "/account",
    "/staff",
    "/api/private/grading?token=private",
    "/my-cards?_rsc=x",
    "/api/commerce/cart",
    "/checkout",
    "/private-image.jpg",
  ]) {
    await h.dispatch("fetch", {
      request: {
        url: "https://northside.example" + path,
        method: "GET",
        mode: path.includes("/api/") ? "cors" : "navigate",
      },
    });
  }
  assert.equal(h.puts.length, 6);
  assert.ok(
    h.puts.every((p) => p.startsWith("/pwa/") || p === "/northside-logo.svg"),
  );
});
test("offline private navigation receives only generic public fallback; API requests are not substituted", async () => {
  const h = harness();
  await h.dispatch("install");
  h.offline();
  const r = await h.dispatch("fetch", {
    request: {
      url: "https://northside.example/my-cards",
      method: "GET",
      mode: "navigate",
    },
  });
  assert.equal(await r.text(), "PUBLIC /pwa/offline.html");
  assert.equal(
    await h.dispatch("fetch", {
      request: {
        url: "https://northside.example/api/private/grading",
        method: "GET",
        mode: "cors",
      },
    }),
    undefined,
  );
});
test("logout clears obsolete Northside caches and locks other tabs without interrupting current sign-out", async () => {
  const h = harness();
  await h.dispatch("message", {
    data: { type: "LOGOUT" },
    source: { id: "caller" },
  });
  assert.deepEqual(h.deleted, ["northside-private-obsolete"]);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, "SESSION_LOCKED");
});
test("lock-screen push discards untrusted private payload and arbitrary deep links", async () => {
  const h = harness();
  await h.dispatch("push", {
    data: {
      json: () => ({
        title: "Private grading description",
        url: "https://evil.example",
      }),
    },
  });
  assert.equal(h.notices[0][0], "Northside Collectibles");
  assert.equal(h.notices[0][1].data.url, "/account/notifications");
  assert.ok(!JSON.stringify(h.notices).includes("Private grading"));
});
test("privacy guard locks before history snapshots, reloads back-forward restores and prepaints locked pages hidden", async () => {
  const guard = await readFile("components/privacy-guard.tsx", "utf8"),
    layout = await readFile("app/layout.tsx", "utf8");
  assert.match(guard, /pagehide/);
  assert.match(guard, /persisted/);
  assert.match(guard, /reload/);
  assert.match(guard, /BroadcastChannel/);
  assert.match(layout, /ns-privacy-lock/);
  assert.match(layout, /privacy-hidden/);
});
