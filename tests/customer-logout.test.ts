import { afterEach, expect, test, vi } from "vitest";
vi.mock("react", () => ({
  useEffect: (effect: () => void) => effect(),
  useState: vi.fn(),
}));
import { PrivacyGuard } from "../apps/customer/components/privacy-guard";
import { lockScreens } from "../apps/customer/components/logout";

afterEach(() => vi.unstubAllGlobals());
function browser() {
  const channels: Channel[] = [];
  class Channel {
    onmessage?: (event: { data: unknown }) => void;
    constructor() {
      channels.push(this);
    }
    postMessage(data: unknown) {
      for (const channel of channels)
        if (channel !== this) channel.onmessage?.({ data });
    }
    close() {
      channels.splice(channels.indexOf(this), 1);
    }
  }
  const events = new Map<string, (event: unknown) => void>();
  const root = {
    dataset: {} as Record<string, string>,
    classList: { add: vi.fn(), remove: vi.fn() },
  };
  const location = { pathname: "/account", replace: vi.fn(), reload: vi.fn() };
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", {
    addEventListener: (name: string, fn: (event: unknown) => void) =>
      events.set(name, fn),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: { postMessage: vi.fn() },
    },
  });
  PrivacyGuard();
  return { root, location, events, Channel };
}
test("logout locks the initiating screen without canceling its provider navigation", () => {
  const page = browser();
  lockScreens();
  expect(page.root.classList.add).toHaveBeenCalledWith("privacy-hidden");
  expect(page.location.replace).not.toHaveBeenCalled();
  const otherDocument = new page.Channel();
  otherDocument.postMessage({ type: "lock", source: "another-document" });
  expect(page.location.replace).toHaveBeenCalledWith("/signed-out");
});
test("own logout marker does not bypass history or storage-event privacy protection", () => {
  const page = browser();
  lockScreens();
  page.events.get("pageshow")!({ persisted: true });
  expect(page.location.reload).toHaveBeenCalledOnce();
  page.events.get("storage")!({ key: "ns-privacy-lock", newValue: "1" });
  expect(page.location.replace).toHaveBeenCalledWith("/signed-out");
});
