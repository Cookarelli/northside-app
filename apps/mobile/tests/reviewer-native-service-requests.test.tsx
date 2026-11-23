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
import { Platform } from "react-native";
import type { ReactNode, EffectCallback } from "react";
import type { AuthController, AuthSnapshot } from "../src/auth/controller";
import type {
  RequestConfig,
  ServiceRequestInput,
} from "@northside/customer-contracts/service-requests";
import { requestSchema, storedRequestSchema } from "@northside/customer-contracts/service-requests";
import ServiceRequests from "../src/app/service-requests";
import { MobileFailure } from "../src/api/client";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  TG = "33333333-3333-4333-8333-333333333333",
  TC = "44444444-4444-4444-8444-444444444444",
  LEVEL = "55555555-5555-4555-8555-555555555555";
const stateFor = (id: string): AuthSnapshot => ({
  status: "authenticated",
  busy: false,
  account: {
    contractVersion: "northside.mobile.v1",
    kind: "account",
    customer: { id, firstName: "SAMPLE", lastName: null, email: null },
    sessionExpiresAt: "2026-11-07T20:00:00.000Z",
  },
});
let mockState: AuthSnapshot = stateFor(A),
  mockFocus = true,
  mockTopic: string | undefined,
  mockUuid = 0;
const mockPressHandlers = new Map<string, () => void>();
const mockConfig = jest.fn<AuthController["serviceRequestConfig"]>(),
  mockList = jest.fn<AuthController["serviceRequests"]>(),
  mockSubmit = jest.fn<AuthController["submitServiceRequest"]>(),
  mockClaim = jest.fn<AuthController["claimServiceRequest"]>(),
  mockPending = jest.fn<AuthController["pendingServiceRequest"]>(),
  mockKeep = jest.fn<AuthController["keepServiceRequest"]>(),
  mockUpload = jest.fn<AuthController["uploadServiceRequestPhoto"]>();
const mockDrafts = new Map<string, ServiceRequestInput>();
const mockCapture = jest.fn<() => Promise<{ base64: string }>>();
const mockController = {
  serviceRequestConfig: mockConfig,
  serviceRequests: mockList,
  submitServiceRequest: mockSubmit,
  claimServiceRequest: mockClaim,
  pendingServiceRequest: mockPending,
  keepServiceRequest: mockKeep,
  uploadServiceRequestPhoto: mockUpload,
};
jest.mock("../src/auth/Provider", () => ({
  useCustomerAuth: () => ({ state: mockState, controller: mockController }),
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useLocalSearchParams: () => ({ topic: mockTopic }),
    useFocusEffect: (callback: EffectCallback) => {
      const focused = mockFocus;
      React.useEffect(
        () => (focused ? callback() : undefined),
        [callback, focused],
      );
    },
  };
});
jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(73)),
  randomUUID: jest.fn(
    () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}`,
  ),
}));
jest.mock("expo-camera", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useCameraPermissions: () => [
      { granted: true },
      async () => ({ granted: true }),
    ],
    CameraView: React.forwardRef(function MockRequestCamera(
      props: { onCameraReady: () => void },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: () => mockCapture(),
      }));
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
jest.mock("../src/components/CustomerScreen", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CustomerScreen: ({ children }: { children: ReactNode }) =>
      React.createElement(RN.View, null, children),
  };
});
jest.mock("../src/components/Controls", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Card: ({ children }: { children: ReactNode }) =>
      React.createElement(RN.View, null, children),
    Button: ({
      label,
      disabled,
      onPress,
    }: {
      label: string;
      disabled?: boolean;
      onPress: () => void;
    }) => {
      mockPressHandlers.set(label, onPress);
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
    ActionLink: ({ label }: { label: string }) =>
      React.createElement(RN.Text, { accessibilityRole: "link" }, label),
  };
});
const config = (revision = 1): RequestConfig => ({
  contractVersion: "1",
  location: {
    address: "6800 Forest Hills Road, Suite 3, Loves Park, Illinois",
    receivingPostalCode: null,
    receivingStartsAt: null,
    receivingActive: false,
  },
  terms: [
    {
      id: revision === 1 ? TG : "66666666-6666-4666-8666-666666666666",
      service: "grading",
      version: "SAMPLE-G-" + revision,
      title: "SAMPLE grading terms",
      body: "SAMPLE current grading policy " + revision,
    },
    {
      id: revision === 1 ? TC : "77777777-7777-4777-8777-777777777777",
      service: "consignment",
      version: "SAMPLE-C-" + revision,
      title: "SAMPLE consignment terms",
      body: "SAMPLE current consignment policy " + revision,
    },
  ],
  serviceLevels: [
    {
      id: LEVEL,
      provider: "SGC",
      name: "SAMPLE configured SGC level",
      declared_value_limit_cents: 100000,
    },
  ],
});
type RequestReceipt = Awaited<
  ReturnType<AuthController["submitServiceRequest"]>
>;
type RequestList = Awaited<ReturnType<AuthController["serviceRequests"]>>;
const receipt = (ref = "NS-SAMPLE-A"): RequestReceipt => ({
  contractVersion: "1",
  id: A,
  reference: ref,
  state: "new",
  duplicate: false,
  next_steps: "Saved for staff review; physical receipt unconfirmed.",
});
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const button = (name: string) => screen.getByRole("button", { name });
const press = (name: string) => fireEvent.press(button(name));
const fill = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);
async function contact() {
  await fill("Full name", "SAMPLE collector");
  await fill("Email", "sample@example.invalid");
  await fill("Phone", "8155550100");
  if (screen.queryByLabelText("Item details"))
    await fill("Item details", "SAMPLE card for staff review");
}
async function start() {
  const view = await render(<ServiceRequests />);
  await waitFor(() => expect(button("Save request")).not.toBeDisabled());
  return view;
}
async function inquiry() {
  await contact();
  await fill("Question", "SAMPLE availability question");
}
const accept = () =>
  fireEvent(
    screen.getByLabelText("I accept these applicable terms"),
    "valueChange",
    true,
  );
beforeEach(() => {
  mockState = stateFor(A);
  mockFocus = true;
  mockTopic = undefined;
  mockUuid = 0;
  mockPressHandlers.clear();
  mockDrafts.clear();
  mockPending
    .mockReset()
    .mockImplementation(
      async () => mockDrafts.get(mockState.account?.customer.id ?? "") ?? null,
    );
  mockKeep.mockReset().mockImplementation(async (input) => {
    const id = mockState.account?.customer.id ?? "";
    if (input) mockDrafts.set(id, structuredClone(input));
    else mockDrafts.delete(id);
  });
  mockUpload.mockReset().mockImplementation(async (_request, id) => ({ id }));
  mockCapture.mockReset().mockResolvedValue({ base64: "cGhvdG8=" });
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  mockConfig.mockReset().mockResolvedValue(config());
  mockList
    .mockReset()
    .mockResolvedValue({ contractVersion: "1", requests: [] });
  mockSubmit.mockReset().mockResolvedValue(receipt());
  mockClaim
    .mockReset()
    .mockResolvedValue({ claim_id: A, pending_staff_verification: true });
});
afterEach(cleanup);
describe("actual native shared request screen", () => {
  it("routes advance inquiries to consignment only", async () => {
    mockTopic = "advance";
    await start();
    expect(screen.queryByRole("button", { name: "service request" })).toBeNull();
    expect(screen.queryByRole("button", { name: /grading/i })).toBeNull();
    await contact();
    await press("Save request");
    expect(mockSubmit).not.toHaveBeenCalled();
    await fill("Card description or request reference", "SAMPLE card NS-123");
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({
      service: "consignment", kind: "inquiry", terms_accepted: false,
      details: { question: "Card advance inquiry (consignment): Northside Cash store credit. SAMPLE card NS-123" },
    });
  });
  it("deferred capture synchronously blocks Save and late capture after blur never uploads", async () => {
    const capture = deferred<{ base64: string }>();
    mockCapture.mockImplementationOnce(() => capture.promise);
    const view = await start();
    await press("consignment");
    await press("service request");
    await contact();
    await fill("Number of listings / lots", "1");
    await fill("Special instructions — enter None if none", "None");
    await accept();
    await press("Take private item photo");
    await waitFor(() =>
      expect(button("Capture request photo")).not.toBeDisabled(),
    );
    const save = mockPressHandlers.get("Save request")!,
      capturePress = mockPressHandlers.get("Capture request photo")!;
    await act(async () => {
      capturePress();
      save();
    });
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(button("Save request")).toBeDisabled();
    mockFocus = false;
    await view.rerender(<ServiceRequests />);
    await act(async () => capture.resolve({ base64: "cGhvdG8=" }));
    expect(mockUpload).not.toHaveBeenCalled();
    mockFocus = true;
    await view.rerender(<ServiceRequests />);
    await waitFor(() => expect(button("Save request")).not.toBeDisabled());
  });
  it("lost photo response retries identical bytes and identity before one request snapshot", async () => {
    mockUpload.mockRejectedValueOnce(new MobileFailure("offline"));
    await start();
    await press("consignment");
    await press("service request");
    await contact();
    await fill("Number of listings / lots", "1");
    await fill("Special instructions — enter None if none", "None");
    await accept();
    await press("Take private item photo");
    await waitFor(() =>
      expect(button("Capture request photo")).not.toBeDisabled(),
    );
    await press("Capture request photo");
    await waitFor(() =>
      expect(button("Retry same request photo")).not.toBeDisabled(),
    );
    expect(button("Save request")).toBeDisabled();
    const [request, id, bytes] = mockUpload.mock.calls[0];
    await press("Retry same request photo");
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    expect(mockUpload.mock.calls[1].slice(0, 3)).toEqual([request, id, bytes]);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button("Save request")).not.toBeDisabled());
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].request_id).toBe(request);
    expect(mockSubmit.mock.calls[0][0].details.photo_ids).toEqual([id]);
  });
  it.each([
    ["ordinary", "SAMPLE original question"],
    ["prior advance", "Card advance inquiry (consignment): SAMPLE original card"],
    ["Northside Cash advance", "Card advance inquiry (consignment): Northside Cash store credit. SAMPLE original card"],
  ])("recovering a pending %s inquiry preserves the original submission", async (kind, question) => {
    mockTopic = kind === "ordinary" ? undefined : "advance";
    const draft: ServiceRequestInput = {
      request_id: A,
      claim_token: "A".repeat(43),
      kind: "inquiry",
      service: kind === "ordinary" ? "grading" : "consignment",
      contact: {
        name: "SAMPLE original",
        email: "original@example.invalid",
        phone: "8155550100",
      },
      details: { question },
      terms_id: null,
      terms_accepted: false,
    };
    mockDrafts.set(A, draft);
    await render(<ServiceRequests />);
    await waitFor(() =>
      expect(button("Retry same request")).not.toBeDisabled(),
    );
    if (mockTopic === "advance") {
      expect(screen.getByLabelText("Card description or request reference")).toHaveDisplayValue("SAMPLE original card");
    }
    await press("Retry same request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toEqual(draft);
    await waitFor(() =>
      expect(screen.getByText(/Saved NS-SAMPLE-A/)).toBeVisible(),
    );
    expect(mockDrafts.has(A)).toBe(false);
  });

  it.each(["advance", undefined])("closes an old grading advance without resubmitting it from topic %s", async (topic) => {
    mockTopic = topic;
    const draft: ServiceRequestInput = {
      request_id: A, claim_token: "A".repeat(43), kind: "inquiry", service: "grading",
      contact: { name: "SAMPLE", email: "test@example.invalid", phone: "8155550100" },
      details: { question: "Card advance inquiry (grading): Northside Cash store credit. SAMPLE" },
      terms_id: null, terms_accepted: false,
    };
    expect(storedRequestSchema.safeParse(draft).success).toBe(true);
    expect(requestSchema.safeParse(draft).success).toBe(false);
    expect(requestSchema.safeParse({ ...draft, details: { question: "When will my graded card return?" } }).success).toBe(true);
    mockDrafts.set(A, draft);
    await start();
    expect(screen.getByText(/earlier grading advance draft has been closed/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry same request" })).toBeNull();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockDrafts.has(A)).toBe(false);
  });

  it("keeps an unrelated unconfirmed inquiry intact when opening advances", async () => {
    mockSubmit.mockRejectedValueOnce(new Error("Lost response"));
    const ordinary = await start();
    await inquiry();
    await press("Save request");
    await waitFor(() => expect(button("Retry same request")).not.toBeDisabled());
    const pending = mockDrafts.get(A);
    await ordinary.unmount();
    mockTopic = "advance";
    await render(<ServiceRequests />);
    await waitFor(() => expect(screen.getByText("Review previous request")).toBeVisible());
    expect(mockDrafts.get(A)).toEqual(pending);
    expect(screen.queryByRole("button", { name: "Retry same request" })).toBeNull();
  });

  it("an acknowledged save stays saved when only the history refresh fails", async () => {
    mockList
      .mockResolvedValueOnce({ contractVersion: "1", requests: [] })
      .mockRejectedValueOnce(new MobileFailure("service_unavailable"));
    await start();
    await inquiry();
    await press("Save request");
    await waitFor(() =>
      expect(screen.getByText(/Saved NS-SAMPLE-A/)).toBeVisible(),
    );
    expect(
      screen.getByText(
        /Your request was saved. Request history could not be refreshed/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Save unconfirmed/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Retry same request" }),
    ).toBeNull();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
  it("definitive changed terms require renewed consent while preserving the draft photo namespace", async () => {
    mockConfig.mockResolvedValueOnce(config()).mockResolvedValueOnce(config(2));
    mockSubmit.mockRejectedValueOnce(
      new MobileFailure("request_terms_changed"),
    );
    await start();
    await press("consignment");
    await press("service request");
    await contact();
    await fill("Number of listings / lots", "2");
    await fill("Special instructions — enter None if none", "None");
    await accept();
    await press("Save request");
    await waitFor(() => expect(mockConfig).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByText("SAMPLE current consignment policy 2"),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText("Email")).toHaveProp("editable", true);
    await press("Save request");
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    await accept();
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
    expect(mockSubmit.mock.calls[1][0].request_id).toBe(
      mockSubmit.mock.calls[0][0].request_id,
    );
    expect(mockSubmit.mock.calls[1][0].terms_id).toBe(config(2).terms[1].id);
  });
  it("secure retry deletion failure after changed terms remains visibly frozen without an unhandled rejection", async () => {
    mockSubmit.mockRejectedValueOnce(
      new MobileFailure("request_terms_changed"),
    );
    mockKeep
      .mockImplementationOnce(async (input) => {
        if (input) mockDrafts.set(A, structuredClone(input));
      })
      .mockRejectedValueOnce(new MobileFailure("storage_unavailable"));
    await start();
    await inquiry();
    await press("Save request");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /secure retry storage could not be cleared/,
      ),
    );
    expect(screen.getByLabelText("Email")).toHaveProp("editable", false);
    expect(button("Retry same request")).not.toBeDisabled();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockConfig).toHaveBeenCalledTimes(1);
    expect(mockDrafts.get(A)?.request_id).toBe(
      mockSubmit.mock.calls[0][0].request_id,
    );
  });
  it("configuration reload failure after definitive rejection disables saving", async () => {
    mockConfig
      .mockResolvedValueOnce(config())
      .mockRejectedValueOnce(new Error("SAMPLE offline"));
    mockSubmit.mockRejectedValueOnce(
      new MobileFailure("request_service_level_changed"),
    );
    await start();
    await inquiry();
    await press("Save request");
    await waitFor(() => expect(mockConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button("Save request")).toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Current service details could not be loaded/,
    );
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
  it("uncertain transport failure and conflicting keys retain the exact retry payload", async () => {
    mockSubmit
      .mockRejectedValueOnce(new MobileFailure("service_unavailable"))
      .mockRejectedValueOnce(new MobileFailure("request_conflict"));
    await start();
    await inquiry();
    await press("Save request");
    await waitFor(() =>
      expect(button("Retry same request")).not.toBeDisabled(),
    );
    const original = structuredClone(mockSubmit.mock.calls[0][0]);
    await press("Retry same request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
    expect(mockSubmit.mock.calls[1][0]).toEqual(original);
    expect(screen.getByLabelText("Email")).toHaveProp("editable", false);
    expect(mockConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Saved NS-SAMPLE/)).toBeNull();
  });
  it.each(["ios", "android"])(
    "inquiry preserves question/contact and uses%s source without accepting service terms",
    async (os) => {
      Object.defineProperty(Platform, "OS", { configurable: true, value: os });
      await start();
      await inquiry();
      await press("Save request");
      await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
      const [body, platform, signal] = mockSubmit.mock.calls[0];
      expect(platform).toBe(os);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(body).toEqual(
        expect.objectContaining({
          kind: "inquiry",
          service: "grading",
          contact: {
            name: "SAMPLE collector",
            email: "sample@example.invalid",
            phone: "8155550100",
          },
          details: { question: "SAMPLE availability question" },
          terms_id: null,
          terms_accepted: false,
        }),
      );
      expect(body.claim_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(body.request_id).toMatch(/^[a-f0-9-]{36}$/);
      await waitFor(() =>
        expect(screen.getByText(/Saved NS-SAMPLE-A/)).toBeVisible(),
      );
    },
  );
  it("consignment uses listing count, shipped-only optional tracking and explicit applicable consignment terms", async () => {
    await start();
    await press("consignment");
    await press("service request");
    await contact();
    await fill("Number of listings / lots", "3");
    await press("shipped");
    await fill("Carrier", "SAMPLE carrier");
    await fill("Tracking", "free text / no URL");
    await fill("Special instructions — enter None if none", "None");
    await press("Save request");
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Explicit acceptance/);
    await accept();
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        service: "consignment",
        kind: "service_request",
        terms_id: TC,
        terms_accepted: true,
        details: {
          listing_count: 3,
          items: [{ description: "SAMPLE card for staff review", quantity: 1 }],
          photo_ids: [],
          delivery_method: "shipped",
          inbound_carrier: "SAMPLE carrier",
          inbound_tracking_number: "free text / no URL",
          instructions: "None",
        },
      }),
    );
  });
  it("grading has manual address, configured provider/service-level and exact USD cents, without a fabricated quote", async () => {
    await start();
    await press("service request");
    await press("SGC");
    await press("SAMPLE configured SGC level");
    await contact();
    await fill("Mailing address", "SAMPLE 1 Main Street");
    await fill("City", "Loves Park");
    await fill("State / region", "IL");
    await fill("Postal code", "00000");
    await fill("Country", "US");
    await fill("Declared value USD", "100.05");
    await accept();
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        service: "grading",
        terms_id: TG,
        details: {
          provider: "SGC",
          items: [{ description: "SAMPLE card for staff review", quantity: 1 }],
          photo_ids: [],
          service_level_id: LEVEL,
          declared_value_cents: 10005,
          address: {
            line1: "SAMPLE 1 Main Street",
            line2: "",
            city: "Loves Park",
            region: "IL",
            postal_code: "00000",
            country: "US",
          },
          instructions: "",
        },
      }),
    );
  });
  it("missing approved terms disable service submission while inquiry remains available", async () => {
    mockConfig.mockResolvedValue({ ...config(), terms: [] });
    await start();
    await press("service request");
    expect(button("Save request")).toBeDisabled();
    expect(
      screen.getByText(/Full approved terms are not configured/),
    ).toBeVisible();
    await press("inquiry");
    await inquiry();
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  });
  it("two immediate taps submit once and a lost-response retry reuses the exact frozen payload and private retry token", async () => {
    const post = deferred<RequestReceipt>();
    mockSubmit
      .mockImplementationOnce(() => post.promise)
      .mockResolvedValueOnce({ ...receipt(), duplicate: true });
    await start();
    await inquiry();
    const save = mockPressHandlers.get("Save request")!;
    await act(async () => {
      save();
      save();
    });
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(button("Saving…")).toBeDisabled();
    await act(async () =>
      post.reject(new Error("SAMPLE response lost after server commit")),
    );
    expect(button("Retry same request")).not.toBeDisabled();
    expect(screen.getByLabelText("Email")).toHaveProp("editable", false);
    expect(button("consignment")).toBeDisabled();
    const original = structuredClone(mockSubmit.mock.calls[0][0]);
    await press("Retry same request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
    expect(mockSubmit.mock.calls[1][0]).toEqual(original);
    expect(mockSubmit.mock.calls[1][0]).toBe(mockSubmit.mock.calls[0][0]);
    await waitFor(() =>
      expect(screen.getByText(/Saved NS-SAMPLE-A/)).toBeVisible(),
    );
  });
  it.each(["switch", "logout_resume"])(
    "late submit response after%s cannot replace a newer customer's form or completion",
    async (mode) => {
      const old = deferred<RequestReceipt>(),
        current = deferred<RequestReceipt>();
      mockSubmit
        .mockImplementationOnce(() => old.promise)
        .mockImplementationOnce(() => current.promise);
      const view = await start();
      await inquiry();
      await press("Save request");
      await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
      const oldSignal = mockSubmit.mock.calls[0][2];
      if (mode === "logout_resume") {
        mockState = { status: "signed_out", busy: false };
        await view.rerender(<ServiceRequests />);
        expect(screen.queryByLabelText("Email")).toBeNull();
      }
      mockState = stateFor(B);
      await view.rerender(<ServiceRequests />);
      await waitFor(() => expect(button("Save request")).not.toBeDisabled());
      expect(oldSignal?.aborted).toBe(true);
      expect(screen.getByLabelText("Email")).toHaveProp("value", "");
      await inquiry();
      await press("Save request");
      await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
      await act(async () => old.resolve(receipt("NS-PRIVATE-OLD-A")));
      expect(screen.queryByText(/NS-PRIVATE-OLD-A/)).toBeNull();
      expect(button("Saving…")).toBeDisabled();
      await act(async () => current.resolve(receipt("NS-CURRENT-B")));
      await waitFor(() =>
        expect(screen.getByText(/NS-CURRENT-B/)).toBeVisible(),
      );
    },
  );
  it("late configuration/list response cannot expose an old customer's history after account switch", async () => {
    const oldConfig = deferred<RequestConfig>(),
      oldList = deferred<RequestList>();
    mockConfig
      .mockImplementationOnce(() => oldConfig.promise)
      .mockResolvedValue(config(2));
    mockList
      .mockImplementationOnce(() => oldList.promise)
      .mockResolvedValue({ contractVersion: "1", requests: [] });
    const view = await render(<ServiceRequests />);
    mockState = stateFor(B);
    await view.rerender(<ServiceRequests />);
    await waitFor(() => expect(button("Save request")).not.toBeDisabled());
    await act(async () => {
      oldConfig.resolve(config());
      oldList.resolve({
        contractVersion: "1",
        requests: [
          {
            id: A,
            reference: "NS-PRIVATE-A",
            kind: "inquiry",
            service: "grading",
            source: "customer_ios",
            contact: {},
            details: {},
            state: "new",
            version: 1,
            created_at: "2026-11-06T12:00:00.000Z",
            updated_at: "2026-11-06T12:00:00.000Z",
            staff_owner: null,
            follow_up_at: null,
            received_at: null,
            customer_id: A,
            terms_id: null,
            terms_version: null,
            terms_hash: null,
            terms_accepted_at: null,
            intake_result: null,
            history: [],
          },
        ],
      });
    });
    expect(screen.queryByText(/NS-PRIVATE-A/)).toBeNull();
    await press("service request");
    expect(screen.getByText("SAMPLE current grading policy 2")).toBeVisible();
  });
  it("same-identity blur recovers the exact pending request and an old finally cannot unlock its retry", async () => {
    const old = deferred<RequestReceipt>(),
      current = deferred<RequestReceipt>();
    mockSubmit
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const view = await start();
    await inquiry();
    await press("Save request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const signal = mockSubmit.mock.calls[0][2];
    mockFocus = false;
    await view.rerender(<ServiceRequests />);
    mockFocus = true;
    await view.rerender(<ServiceRequests />);
    await waitFor(() =>
      expect(button("Retry same request")).not.toBeDisabled(),
    );
    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText("Email")).toHaveProp("editable", false);
    await press("Retry same request");
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
    expect(mockSubmit.mock.calls[1][0]).toEqual(mockSubmit.mock.calls[0][0]);
    await act(async () => old.resolve(receipt("NS-OLD-BLURRED")));
    expect(screen.queryByText(/NS-OLD-BLURRED/)).toBeNull();
    expect(button("Saving…")).toBeDisabled();
    await act(async () => current.resolve(receipt("NS-NEW-FOCUSED")));
    await waitFor(() =>
      expect(screen.getByText(/NS-NEW-FOCUSED/)).toBeVisible(),
    );
  });
  it("returning from blur requires fresh explicit acceptance when current applicable terms changed", async () => {
    const view = await start();
    await press("service request");
    await accept();
    expect(screen.getByLabelText("I accept these applicable terms")).toHaveProp(
      "value",
      true,
    );
    mockFocus = false;
    await view.rerender(<ServiceRequests />);
    mockConfig.mockResolvedValue(config(2));
    mockFocus = true;
    await view.rerender(<ServiceRequests />);
    await waitFor(() =>
      expect(screen.getByText("SAMPLE current grading policy 2")).toBeVisible(),
    );
    expect(screen.getByLabelText("I accept these applicable terms")).toHaveProp(
      "value",
      false,
    );
  });
});
