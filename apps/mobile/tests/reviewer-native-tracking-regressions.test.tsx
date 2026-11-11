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
import type { ReactNode } from "react";
import type { AuthSnapshot } from "../src/auth/controller";
import type { TrackingList } from "@northside/customer-contracts/tracking";
import MyCards from "../src/app/my-cards/index";

// Intended destination: apps/mobile/tests/. This isolates actual MyCards state
// from layout/router/provider setup. Controller promises deliberately ignore
// abort so stale UI fencing, rather than transport cooperation, is exercised.
const customerA = "11111111-1111-4111-8111-111111111111";
const customerB = "22222222-2222-4222-8222-222222222222";
const expires = "2026-11-05T20:00:00.000Z";
const stamp = "2026-11-05T12:00:00.000Z";
const stateFor = (id: string): AuthSnapshot => ({
  status: "authenticated",
  busy: false,
  account: {
    contractVersion: "northside.mobile.v1",
    kind: "account",
    customer: { id, firstName: "Synthetic", lastName: null, email: null },
    sessionExpiresAt: expires,
  },
});
const mockTracking = jest.fn<() => Promise<TrackingList>>();
const mockAccept = jest.fn<() => Promise<unknown>>();
let mockState: AuthSnapshot = stateFor(customerA);
const mockController = {
  tracking: mockTracking,
  trackingDetail: jest.fn(),
  trackingPhoto: jest.fn(),
  acceptTerms: mockAccept,
  login: jest.fn(),
};
jest.mock("../src/auth/Provider", () => ({
  useCustomerAuth: () => ({ controller: mockController, state: mockState }),
}));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useLocalSearchParams: () => ({}),
    useFocusEffect: (callback: () => (() => void) | void) =>
      React.useEffect(callback, [callback]),
  };
});
jest.mock("../src/components/CustomerScreen", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CustomerScreen: ({ children }: { children: ReactNode }) =>
      React.createElement(RN.View, null, children),
  };
});
jest.mock("../src/components/Controls", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const RN = jest.requireActual<typeof import("react-native")>("react-native");
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
      onPress?: () => void;
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
    ActionLink: ({ label }: { label: string }) =>
      React.createElement(RN.Text, { accessibilityRole: "link" }, label),
  };
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function data(id: string, revision: number): TrackingList {
  const name = id === customerA ? "A" : "B";
  return {
    contractVersion: "northside.mobile.v1",
    kind: "card-tracking",
    service: "grading",
    cards: [
      {
        id,
        cardId: id,
        service: "grading",
        title: `SYNTHETIC ${name} CARD`,
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
        title: `SYNTHETIC ${name} TERMS ${revision}`,
        body: "Synthetic policy fixture only.",
        publishedAt: stamp,
      },
      acceptedAt: null,
    },
  };
}
beforeEach(() => {
  mockState = stateFor(customerA);
  mockTracking.mockReset();
  mockAccept.mockReset();
  let aReads = 0;
  mockTracking.mockImplementation(async () => {
    const id = mockState.account!.customer.id;
    return data(id, id === customerA ? ++aReads : 1);
  });
});
afterEach(cleanup);

describe("My Cards acceptance identity fencing", () => {
  it.each([false, true])(
    "ignores an old identity completion after a newer load (resume-same-parent=%s)",
    async (resumeSameParent) => {
      const oldPost = deferred<unknown>();
      const newPost = deferred<unknown>();
      mockAccept
        .mockImplementationOnce(() => oldPost.promise)
        .mockImplementationOnce(() => newPost.promise);
      const view = await render(<MyCards />);
      await waitFor(() =>
        expect(screen.getByText("SYNTHETIC A TERMS 1")).toBeVisible(),
      );
      await fireEvent.press(screen.getByRole("checkbox"));
      await fireEvent.press(
        screen.getByRole("button", { name: "Record my acceptance" }),
      );
      expect(
        screen.getByRole("button", { name: "Consignment" }),
      ).toBeDisabled();

      if (resumeSameParent) {
        // Mirrors AuthController.hidePrivate: no account while backgrounded.
        mockState = { status: "authenticated", busy: false };
        await view.rerender(<MyCards />);
        expect(screen.queryByText("SYNTHETIC A TERMS 1")).toBeNull();
        mockState = stateFor(customerA);
      } else mockState = stateFor(customerB);
      await view.rerender(<MyCards />);
      const title = resumeSameParent
        ? "SYNTHETIC A TERMS 2"
        : "SYNTHETIC B TERMS 1";
      await waitFor(() => expect(screen.getByText(title)).toBeVisible());
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(screen.getByRole("checkbox")).not.toBeDisabled();
      await fireEvent.press(screen.getByRole("checkbox"));
      await fireEvent.press(
        screen.getByRole("button", { name: "Record my acceptance" }),
      );
      expect(mockAccept).toHaveBeenCalledTimes(2);

      await act(async () => {
        oldPost.reject(new Error("synthetic old cancellation"));
      });
      expect(screen.getByText(title)).toBeVisible();
      expect(
        screen.queryByText(/Acceptance could not be confirmed/),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Saving acceptance…" }),
      ).toBeDisabled();

      await act(async () => {
        newPost.reject(new Error("synthetic current cancellation"));
      });
      expect(
        screen.getByText(/Acceptance could not be confirmed/),
      ).toBeVisible();
    },
  );
});
