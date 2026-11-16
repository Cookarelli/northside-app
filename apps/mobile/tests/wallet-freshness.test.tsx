import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import type { PropsWithChildren } from "react";
import type { AuthSnapshot } from "../src/auth/controller";
import Wallet from "../src/app/(tabs)/wallet";

let mockState: AuthSnapshot;
const mockLoad = jest.fn<() => Promise<void>>();
jest.mock("../src/auth/Provider", () => ({
  useCustomerAuth: () => ({ state: mockState, controller: { load: mockLoad } }),
}));
jest.mock("../src/components/CustomerScreen", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const RN = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CustomerScreen: ({ children }: PropsWithChildren) =>
      React.createElement(RN.View, null, children),
  };
});
const observedAt = "2026-11-09T16:00:00.000Z";
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(observedAt));
  mockState = {
    status: "authenticated",
    busy: false,
    wallet: {
      contractVersion: "northside.mobile.v1",
      kind: "wallet",
      status: "ready",
      balance: 500,
      held: 50,
      available: 450,
      tier: "SAMPLE tier",
      rewards: [],
      observedAt,
    },
  };
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("removes the verified wallet balance exactly at its freshness deadline", async () => {
  await render(<Wallet />);
  expect(screen.getByText("450 available points")).toBeVisible();
  await act(async () => { jest.advanceTimersByTime(59999); });
  expect(screen.getByText("450 available points")).toBeVisible();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(screen.queryByText("450 available points")).toBeNull();
  expect(screen.getByText("Refresh your wallet")).toBeVisible();
});

it("rechecks wall time on foreground even when the expiry timer was delayed", async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove() {} };
  });
  await render(<Wallet />);
  expect(screen.getByText("450 available points")).toBeVisible();
  // Move the clock without running timers, as when the OS suspends JavaScript.
  jest.setSystemTime(new Date(Date.parse(observedAt) + 60001));
  await act(async () => { listeners.forEach(listener => listener("active")); });
  expect(screen.queryByText("450 available points")).toBeNull();
  expect(screen.getByText("Refresh your wallet")).toBeVisible();
  expect(mockLoad).not.toHaveBeenCalled();
});

it("does not reuse an earlier clock when a late stale wallet response rerenders", async () => {
  const view = await render(<Wallet />);
  jest.setSystemTime(new Date(Date.parse(observedAt) + 120000));
  mockState = { ...mockState, wallet: { ...mockState.wallet! } };
  await view.rerender(<Wallet />);
  expect(screen.queryByText("450 available points")).toBeNull();
  expect(screen.getByText("Refresh your wallet")).toBeVisible();
});

it("describes the consignment-only credit ceiling without quoting a credit balance", async () => {
  await render(<Wallet />);
  expect(screen.getByText(/For consigned cards only, you can request an advance of up to 30% of the card’s estimated sale price/)).toBeVisible();
});
