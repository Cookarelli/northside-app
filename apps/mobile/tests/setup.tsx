import { jest, beforeEach } from "@jest/globals";
import { AppState } from "react-native";
// Native UI tests explicitly start in the foreground; lifecycle cases override this.
beforeEach(() => {
  (AppState as { currentState: typeof AppState.currentState }).currentState =
    "active";
});

jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>(
      "react-native-safe-area-context/jest/mock",
    ).default,
);

// RNTL14 augments the re-export in @jest/expect. Jest30.5 owns Matchers in expect;
// forward the exact library interface for isolated pnpm TypeScript resolution.
import type { JestNativeMatchers } from "@testing-library/react-native/dist/matchers/types";
declare module "expect" {
  // Declaration merging must retain Jest's interface and exact generic parameters.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<
    R extends void | Promise<void>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    T = unknown,
  > extends JestNativeMatchers<R> {}
}
