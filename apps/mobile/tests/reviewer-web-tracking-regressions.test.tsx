import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "test-renderer";
import { CustomerPicker } from "../../customer/components/customer-picker";
import { ServiceTermsPanel } from "../../customer/components/service-terms";

// Intended destination: apps/mobile/tests/. This is the same installed host
// renderer bridge used by web-catalog-photo.test.tsx. It exercises actual web
// component state/handlers, not browser selection, network or provider behavior.
jest.mock("../../customer/node_modules/react", () =>
  jest.requireActual("react"),
);

const roots: Root[] = [];
const originalFetch = globalThis.fetch;
const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";
const customerA = { id: idA, display_name: "Synthetic Alice", verified: true };
const customerB = { id: idB, display_name: "Synthetic Bob", verified: true };
const stamp = "2026-11-05T12:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function list(actor: "a" | "b", revision = 1) {
  const id = actor === "a" ? idA : idB;
  return {
    contractVersion: "northside.mobile.v1",
    kind: "card-tracking",
    service: "grading",
    cards: [
      {
        id,
        cardId: id,
        service: "grading",
        title: `Synthetic ${actor} card`,
        status: "Received",
        receivedDate: "2026-11-05",
        recordedAt: stamp,
        updatedAt: stamp,
      },
    ],
    terms: {
      service: "grading",
      current: {
        id,
        version: `synthetic-${revision}`,
        title: `SYNTHETIC ${actor.toUpperCase()} TERMS ${revision}`,
        body: "Synthetic policy fixture only.",
        publishedAt: stamp,
      },
      acceptedAt: null,
    },
  };
}
async function renderWeb(element: ReactElement) {
  const root = createRoot({
    textComponentTypes: [
      "div",
      "p",
      "h2",
      "h3",
      "button",
      "label",
      "option",
      "summary",
      "span",
    ],
    publicTextComponentTypes: [
      "div",
      "p",
      "h2",
      "h3",
      "button",
      "label",
      "option",
      "summary",
      "span",
    ],
  });
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return {
    root,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}
const select = (root: Root) =>
  root.container.queryAll((node) => node.type === "select")[0];
const search = (root: Root) =>
  root.container.queryAll(
    (node) => node.type === "input" && node.props.type === "search",
  )[0];
const checkbox = (root: Root) =>
  root.container.queryAll(
    (node) => node.type === "input" && node.props.type === "checkbox",
  )[0];
const accept = (root: Root) =>
  root.container.queryAll(
    (node) =>
      node.type === "button" && node.props.children === "Record my acceptance",
  )[0];
const titles = (root: Root) =>
  root.container
    .queryAll((node) => node.type === "h3")
    .map((node) => node.props.children);
const alerts = (root: Root) =>
  root.container.queryAll((node) => node.props.role === "alert");

beforeEach(() => {
  globalThis.fetch = jest.fn<typeof fetch>(async () => {
    throw new Error("Unexpected network path in isolated web component test");
  });
});
afterEach(async () => {
  for (const root of roots.splice(0))
    await act(async () => {
      root.unmount();
    });
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe("exact customer selection", () => {
  it("requires a fresh explicit choice after selecting A and searching B", async () => {
    jest.useFakeTimers();
    const request = jest.fn<typeof fetch>(async (url) => {
      expect(String(url)).toContain("customers=1&q=Bob");
      return response({ customers: [customerB] });
    });
    globalThis.fetch = request;
    const view = await renderWeb(
      <CustomerPicker customers={[customerA, customerB]} />,
    );
    await act(async () => {
      select(view.root).props.onChange({ target: { value: idA } });
    });
    expect(select(view.root).props.value).toBe(idA);
    await act(async () => {
      search(view.root).props.onChange({ target: { value: "Bob" } });
    });
    // The owner is cleared immediately, before the remote debounce settles.
    expect(select(view.root).props.value).toBe("");
    expect(select(view.root).props.required).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(251);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(select(view.root).props.value).toBe("");
    expect(
      view.root.container.queryAll(
        (node) => node.type === "option" && node.props.value === idA,
      ),
    ).toHaveLength(0);
    await act(async () => {
      select(view.root).props.onChange({ target: { value: idB } });
    });
    expect(select(view.root).props.value).toBe(idB);
  });

  it("does not silently choose a remaining option when a selected ID leaves the supplied records", async () => {
    const view = await renderWeb(
      <CustomerPicker customers={[customerA, customerB]} />,
    );
    await act(async () => {
      select(view.root).props.onChange({ target: { value: idA } });
    });
    await view.rerender(<CustomerPicker customers={[customerB]} />);
    expect(select(view.root).props.value).toBe("");
    expect(select(view.root).props.required).toBe(true);
  });
});

describe("service terms stale acceptance", () => {
  it.each([false, true])(
    "keeps a newer actor view after a late old error (return-to-A=%s)",
    async (returnToA) => {
      const oldPost = deferred<Response>();
      const newPost = deferred<Response>();
      let posts = 0;
      let aReads = 0;
      const request = jest.fn<typeof fetch>(async (url, init) => {
        if (init?.method === "POST")
          return ++posts === 1 ? oldPost.promise : newPost.promise;
        const actor =
          new URL(String(url), "https://synthetic.invalid").searchParams.get(
            "actor",
          ) === "b"
            ? "b"
            : "a";
        return response(list(actor, actor === "a" ? ++aReads : 1));
      });
      globalThis.fetch = request;
      const view = await renderWeb(
        <ServiceTermsPanel service="grading" fixture actor="a" />,
      );
      expect(titles(view.root)).toContain("SYNTHETIC A TERMS 1");
      await act(async () => {
        checkbox(view.root).props.onChange({ target: { checked: true } });
      });
      await act(async () => {
        accept(view.root).props.onClick();
      });
      expect(accept(view.root).props.disabled).toBe(true);

      await view.rerender(
        <ServiceTermsPanel service="grading" fixture actor="b" />,
      );
      expect(titles(view.root)).toContain("SYNTHETIC B TERMS 1");
      if (returnToA)
        await view.rerender(
          <ServiceTermsPanel service="grading" fixture actor="a" />,
        );
      const latestTitle = returnToA
        ? "SYNTHETIC A TERMS 2"
        : "SYNTHETIC B TERMS 1";
      expect(titles(view.root)).toContain(latestTitle);
      expect(checkbox(view.root).props.checked).toBe(false);
      expect(checkbox(view.root).props.disabled).toBe(false);
      await act(async () => {
        checkbox(view.root).props.onChange({ target: { checked: true } });
      });
      await act(async () => {
        accept(view.root).props.onClick();
      });
      expect(posts).toBe(2);
      expect(accept(view.root).props.disabled).toBe(true);
      const callsBeforeOldCompletion = request.mock.calls.length;

      // Deliberately ignore cancellation in the synthetic transport. The old
      // request may fail after a newer actor's own acceptance is already saving.
      await act(async () => {
        oldPost.resolve(response({ error: "stale_version" }, 409));
      });
      expect(titles(view.root)).toContain(latestTitle);
      expect(alerts(view.root)).toHaveLength(0);
      expect(accept(view.root).props.disabled).toBe(true);
      expect(request).toHaveBeenCalledTimes(callsBeforeOldCompletion);

      await act(async () => {
        newPost.resolve(response({ error: "fixture_only" }, 409));
      });
      expect(alerts(view.root)).toHaveLength(1);
    },
  );
});
