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
import type { ComponentProps, EffectCallback } from "react";
import type { AuthController } from "../src/auth/controller";
import { SubmittedRequestPhoto } from "../src/components/SubmittedRequestPhoto";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  privateA = "data:image/jpeg;base64,U0FNUExFLUE=",
  privateB = "data:image/jpeg;base64,U0FNUExFLUI=";
let mockFocus = true;
const mockRead = jest.fn<AuthController["serviceRequestPhoto"]>();
jest.mock("../src/auth/Provider", () => ({
  useCustomerAuth: () => ({ controller: { serviceRequestPhoto: mockRead } }),
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (callback: EffectCallback) => {
      const focus = mockFocus;
      React.useEffect(
        () => (focus ? callback() : undefined),
        [callback, focus],
      );
    },
  };
});
jest.mock("expo-image", () => {
  const React = jest.requireActual<typeof import("react")>("react"),
    RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Image: (props: ComponentProps<typeof RN.Image>) =>
      React.createElement(RN.Image, props),
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
    }) =>
      React.createElement(
        RN.Pressable,
        {
          accessibilityRole: "button",
          accessibilityLabel: label,
          accessibilityState: { disabled: !!disabled },
          disabled,
          onPress,
        },
        React.createElement(RN.Text, null, label),
      ),
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
beforeEach(() => {
  mockFocus = true;
  mockRead.mockReset().mockResolvedValue(privateA);
});
afterEach(cleanup);
describe("submitted request private-photo viewer", () => {
  it("loads only after explicit action and disables native image caching", async () => {
    await render(<SubmittedRequestPhoto id={A} index={1} />);
    expect(mockRead).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Submitted request photo 1")).toBeNull();
    await press("View submitted photo 1");
    await waitFor(() =>
      expect(screen.getByLabelText("Submitted request photo 1")).toHaveProp(
        "source",
        { uri: privateA },
      ),
    );
    expect(screen.getByLabelText("Submitted request photo 1")).toHaveProp(
      "cachePolicy",
      "none",
    );
    expect(mockRead.mock.calls[0][0]).toBe(A);
    expect(mockRead.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });
  it("a provider ignoring cancellation cannot display a blurred result or unlock a later request", async () => {
    const old = deferred<string>(),
      current = deferred<string>();
    mockRead
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const view = await render(<SubmittedRequestPhoto id={A} index={1} />);
    await press("View submitted photo 1");
    const signal = mockRead.mock.calls[0][1];
    mockFocus = false;
    await view.rerender(<SubmittedRequestPhoto id={A} index={1} />);
    mockFocus = true;
    await view.rerender(<SubmittedRequestPhoto id={A} index={1} />);
    await press("View submitted photo 1");
    expect(signal?.aborted).toBe(true);
    await act(async () => old.resolve(privateA));
    expect(screen.queryByLabelText("Submitted request photo 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Loading private request photo…" }),
    ).toBeDisabled();
    await act(async () => current.resolve(privateB));
    await waitFor(() =>
      expect(screen.getByLabelText("Submitted request photo 1")).toHaveProp(
        "source",
        { uri: privateB },
      ),
    );
  });
  it("owner unmount fences an old response from the next customer's viewer", async () => {
    const old = deferred<string>(),
      current = deferred<string>();
    mockRead
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const view = await render(
      <SubmittedRequestPhoto key="customer-a" id={A} index={1} />,
    );
    await press("View submitted photo 1");
    const signal = mockRead.mock.calls[0][1];
    await view.rerender(
      <SubmittedRequestPhoto key="customer-b" id={B} index={1} />,
    );
    await press("View submitted photo 1");
    await act(async () => old.resolve(privateA));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByLabelText("Submitted request photo 1")).toBeNull();
    expect(mockRead.mock.calls[1][0]).toBe(B);
    await act(async () => current.resolve(privateB));
    await waitFor(() =>
      expect(screen.getByLabelText("Submitted request photo 1")).toHaveProp(
        "source",
        { uri: privateB },
      ),
    );
  });
  it("photo/decode failure hides the URI and reports a generic retry message", async () => {
    mockRead.mockRejectedValueOnce(
      Error("SAMPLE private provider path must stay hidden"),
    );
    await render(<SubmittedRequestPhoto id={A} index={1} />);
    await press("View submitted photo 1");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Private photograph unavailable/,
      ),
    );
    expect(screen.queryByText(/provider path/)).toBeNull();
    await press("Retry submitted photo 1");
    await waitFor(() =>
      expect(screen.getByLabelText("Submitted request photo 1")).toBeVisible(),
    );
    await fireEvent(
      screen.getByLabelText("Submitted request photo 1"),
      "error",
    );
    expect(screen.queryByLabelText("Submitted request photo 1")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry submitted photo 1" }),
    ).not.toBeDisabled();
  });
});
