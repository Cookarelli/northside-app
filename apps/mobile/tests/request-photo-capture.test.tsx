import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { EffectCallback } from "react";
import { AuthController, type AuthPorts } from "../src/auth/controller";
import { MobileApi, MobileFailure } from "../src/api/client";
import type { ServiceRequestInput } from "@northside/customer-contracts/service-requests";
import { RequestPhotoCapture } from "../src/components/RequestPhotoCapture";
type Upload = (id: string, bytes: Uint8Array) => Promise<void>;
let mockFocus = true,
  mockGranted = true;
const mockCapture = jest.fn<() => Promise<{ base64: string }>>(),
  mockAsk = jest.fn<() => Promise<{ granted: boolean }>>(),
  mockPress = new Map<string, () => void>();
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (callback: EffectCallback) => {
      const active = mockFocus;
      React.useEffect(
        () => (active ? callback() : undefined),
        [callback, active],
      );
    },
  };
});
jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
jest.mock("expo-camera", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useCameraPermissions: () => [{ granted: mockGranted }, mockAsk],
    CameraView: React.forwardRef(function MockRequestCamera(
      props: { onCameraReady: () => void },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: () => mockCapture(),
      }));
      // The real native component emits one ready event after mounting.
      const ready = React.useRef(props.onCameraReady);
      React.useEffect(() => {
        ready.current();
      }, []);
      return React.createElement(RN.View, {
        accessibilityLabel: "Request photo camera",
      });
    }),
  };
});
jest.mock("../src/components/Controls", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Button: ({
      label,
      disabled,
      onPress,
    }: {
      label: string;
      disabled?: boolean;
      onPress: () => void;
    }) => {
      mockPress.set(label, onPress);
      return React.createElement(
        RN.Pressable,
        {
          accessibilityRole: "button",
          accessibilityLabel: label,
          accessibilityState: { disabled: !!disabled },
          disabled,
          onPress,
        },
        React.createElement(RN.Text, null, label),
      );
    },
  };
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const press = (name: string) =>
  fireEvent.press(screen.getByRole("button", { name }));
async function openCamera() {
  await press("Take private item photo");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Capture request photo" }),
    ).not.toBeDisabled(),
  );
}
beforeEach(() => {
  mockFocus = true;
  mockGranted = true;
  mockPress.clear();
  mockCapture.mockReset().mockResolvedValue({ base64: "cGhvdG8=" });
  mockAsk.mockReset().mockResolvedValue({ granted: true });
});
afterEach(cleanup);
describe("request photo capture lifecycle", () => {
  it("binds its request before camera work and suppresses simultaneous capture taps", async () => {
    const capture = deferred<{ base64: string }>(),
      upload = jest.fn<Upload>().mockResolvedValue(undefined),
      begin = jest.fn(() => upload),
      pending = jest.fn<(value: boolean) => void>();
    mockCapture.mockImplementation(() => capture.promise);
    await render(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await openCamera();
    const start = mockPress.get("Capture request photo")!;
    await act(async () => {
      start();
      start();
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenCalledWith(true);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    await act(async () => capture.resolve({ base64: "cGhvdG8=" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(pending).toHaveBeenLastCalledWith(false);
  });
  it("a lost upload reply retries the original identity, bytes and bound request", async () => {
    const first = jest
        .fn<Upload>()
        .mockRejectedValueOnce(Error("SAMPLE lost reply"))
        .mockResolvedValueOnce(undefined),
      next = jest.fn<Upload>().mockResolvedValue(undefined),
      begin = jest.fn(() => first),
      pending = jest.fn<(value: boolean) => void>();
    const view = await render(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await openCamera();
    await press("Capture request photo");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry same request photo" }),
      ).not.toBeDisabled(),
    );
    const original = first.mock.calls[0];
    expect(pending).toHaveBeenLastCalledWith(true);
    await view.rerender(
      <RequestPhotoCapture
        disabled={false}
        onBegin={() => next}
        onPending={pending}
      />,
    );
    await press("Retry same request photo");
    await waitFor(() => expect(first).toHaveBeenCalledTimes(2));
    expect(first.mock.calls[1]).toEqual(original);
    expect(next).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenLastCalledWith(false);
  });
  it("a late camera result after blur never uploads to the next focus", async () => {
    const capture = deferred<{ base64: string }>(),
      upload = jest.fn<Upload>().mockResolvedValue(undefined),
      pending = jest.fn<(value: boolean) => void>(),
      begin = () => upload;
    mockCapture.mockImplementationOnce(() => capture.promise);
    const view = await render(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await openCamera();
    await press("Capture request photo");
    mockFocus = false;
    await view.rerender(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    mockFocus = true;
    await view.rerender(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await act(async () => capture.resolve({ base64: "cGhvdG8=" }));
    expect(upload).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.queryByLabelText("Request photo camera")).toBeNull();
    await openCamera();
    await press("Capture request photo");
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });
  it("late permission approval cannot reopen a blurred private camera", async () => {
    mockGranted = false;
    const approval = deferred<{ granted: boolean }>();
    mockAsk.mockImplementation(() => approval.promise);
    const pending = jest.fn<(value: boolean) => void>(),
      begin = () => jest.fn<Upload>().mockResolvedValue(undefined);
    const view = await render(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await press("Take private item photo");
    mockFocus = false;
    await view.rerender(
      <RequestPhotoCapture
        disabled={false}
        onBegin={begin}
        onPending={pending}
      />,
    );
    await act(async () => approval.resolve({ granted: true }));
    expect(screen.queryByLabelText("Request photo camera")).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
  });
  it("capture failure visibly releases pending state without attempting upload", async () => {
    mockCapture.mockRejectedValueOnce(Error("SAMPLE capture unavailable"));
    const upload = jest.fn<Upload>(),
      pending = jest.fn<(value: boolean) => void>();
    await render(
      <RequestPhotoCapture
        disabled={false}
        onBegin={() => upload}
        onPending={pending}
      />,
    );
    await openCamera();
    await press("Capture request photo");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "SAMPLE capture unavailable",
      ),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(false);
  });
});

const accountA = "11111111-1111-4111-8111-111111111111",
  accountB = "22222222-2222-4222-8222-222222222222";
const pendingInput: ServiceRequestInput = {
  request_id: accountA,
  claim_token: "Q".repeat(43),
  kind: "inquiry",
  service: "grading",
  contact: {
    name: "SAMPLE private original",
    email: "private@example.invalid",
    phone: "8155550100",
  },
  details: { question: "SAMPLE private retry" },
  terms_id: null,
  terms_accepted: false,
};
function secureHarness() {
  const values = new Map<string, string>([["renewal", "A".repeat(43)]]),
    now = Date.now();
  let customer = accountA;
  const ports: AuthPorts = {
    storage: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    },
    token: async () => "T".repeat(43),
    challenge: async () => "C".repeat(43),
    browser: { open: async () => ({ type: "cancel" }), dismiss() {} },
    now: () => now,
  };
  // This isolates the real controller and storage lifecycle; provider identity is a mock.
  const api = {
    renew: async () => ({
      contractVersion: "northside.mobile.v1",
      kind: "session",
      accessToken: "X".repeat(43),
      renewalToken: "R".repeat(43),
      accessExpiresAt: new Date(now + 600000).toISOString(),
      absoluteExpiresAt: new Date(now + 3600000).toISOString(),
      customerId: customer,
      providerRenewal: "refresh_available",
    }),
    account: async () => ({
      contractVersion: "northside.mobile.v1",
      kind: "account",
      customer: {
        id: customer,
        firstName: "SAMPLE",
        lastName: null,
        email: null,
      },
      sessionExpiresAt: new Date(now + 3600000).toISOString(),
    }),
    orders: async () => ({ orders: [] }),
    services: async () => ({ items: [] }),
    wallet: async () => {
      throw new MobileFailure("not_configured");
    },
    breaks: async () => {
      throw new MobileFailure("not_configured");
    },
    deletionStatus: async () => {
      throw new MobileFailure("not_configured");
    },
    logout: async () => ({ revoked: true }),
  } as unknown as MobileApi;
  return {
    values,
    ports,
    make: () =>
      new AuthController(
        api,
        { variant: "preview", returnUri: "northside-sample://auth/return" },
        ports,
      ),
    customer: (id: string) => {
      customer = id;
    },
  };
}
describe("real native request retry storage boundary", () => {
  it("restores exact pending input through controller recreation without changing the request identity", async () => {
    const h = secureHarness(),
      first = h.make();
    await first.initialize();
    expect(first.snapshot().account?.customer.id).toBe(accountA);
    await first.keepServiceRequest(pendingInput);
    const restored = h.make();
    await restored.initialize();
    expect(await restored.pendingServiceRequest()).toEqual(pendingInput);
    expect((await restored.pendingServiceRequest())?.claim_token).toBe(
      pendingInput.claim_token,
    );
  });
  it("never returns the previous customer's secure pending payload to another authenticated customer", async () => {
    const h = secureHarness(),
      first = h.make();
    await first.initialize();
    await first.keepServiceRequest(pendingInput);
    h.customer(accountB);
    const second = h.make();
    await second.initialize();
    expect(second.snapshot().account?.customer.id).toBe(accountB);
    expect(await second.pendingServiceRequest()).toBeNull();
    expect(h.values.has("service_request")).toBe(false);
  });
  it("logout clears pending request content and subsequent reads require authentication", async () => {
    const h = secureHarness(),
      controller = h.make();
    await controller.initialize();
    await controller.keepServiceRequest(pendingInput);
    await controller.logout();
    expect(h.values.has("service_request")).toBe(false);
    await expect(controller.pendingServiceRequest()).rejects.toThrow(
      "session_expired",
    );
  });
});
