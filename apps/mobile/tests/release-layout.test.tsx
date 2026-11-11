import { afterEach, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Platform, StyleSheet } from "react-native";
import * as safeArea from "react-native-safe-area-context";
import { Screen } from "../src/components/Screen";
import { Button } from "../src/components/Controls";
let mockVariant = "development";
let mockInterfacePreview = false;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: { mobile: { variant: mockVariant, interfacePreview: mockInterfacePreview } } }; } },
}));

afterEach(() => { jest.restoreAllMocks(); mockVariant = "development"; mockInterfacePreview = false; });

it("keeps stack-screen footer actions above a nonzero bottom device inset", async () => {
  jest.spyOn(safeArea, "useSafeAreaInsets").mockReturnValue({ top: 59, bottom: 34, left: 0, right: 0 });
  await render(<Screen title="Privacy" eyebrow="Your information"><Button label="Footer action" onPress={() => {}} /></Screen>);
  const [scroll] = screen.container.queryAll((node) => node.props.contentContainerStyle !== undefined);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(58);
  expect(screen.getByRole("button", { name: "Footer action" })).toBeVisible();
  expect(screen.getByText("PREVIEW")).toBeVisible();
});

it("does not label the production build as a preview", async () => {
  mockVariant = "production";
  await render(<Screen title="Home" eyebrow="Northside" />);
  expect(screen.queryByText("PREVIEW")).toBeNull();
  expect(screen.getByRole("header", { name: "Home" })).toBeVisible();
});

it("labels an interface preview honestly while services are disconnected", async () => {
  mockVariant = "preview";
  mockInterfacePreview = true;
  await render(<Screen title="Home" eyebrow="Northside" />);
  expect(screen.getByText("Interface preview · Customer services are not connected.")).toBeVisible();
  expect(screen.getByText("PREVIEW")).toBeVisible();
});


it("gives the browser version a clean header without changing service availability", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  mockVariant = "preview";
  await render(<Screen title="Home" eyebrow="Northside" />);
  expect(screen.queryByText("PREVIEW")).toBeNull();
  expect(screen.getByRole("header", { name: "Home" })).toBeVisible();
});

it("retains safe-area footer clearance and an accessible primary action in the Home appearance", async () => {
  jest.spyOn(safeArea, "useSafeAreaInsets").mockReturnValue({ top: 59, bottom: 34, left: 0, right: 0 });
  await render(<Screen appearance="storefront" title="HOBBY LIVES HERE." eyebrow="Northside Collectibles"
    introAction={<Button appearance="storefront" label="Shop Products" onPress={() => {}} />}>
    <Button label="Footer action" onPress={() => {}} />
  </Screen>);
  const [scroll] = screen.container.queryAll(node => node.props.contentContainerStyle !== undefined);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(58);
  expect(screen.getByRole("header", { name: "HOBBY LIVES HERE." })).toBeVisible();
  expect(screen.getByRole("button", { name: "Shop Products" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Footer action" })).toBeVisible();
});
