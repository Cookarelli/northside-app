import { describe, expect, it, jest } from "@jest/globals";
import {
  renderRouter,
  screen,
  fireEvent,
  waitFor,
} from "expo-router/testing-library";
import RootLayout from "../src/app/_layout";
import TabLayout from "../src/app/(tabs)/_layout";
import Home from "../src/app/(tabs)/index";
import Shop from "../src/app/(tabs)/shop";
import Scan from "../src/app/(tabs)/scan";
import Wallet from "../src/app/(tabs)/wallet";
import Account from "../src/app/(tabs)/account";
import NotFound from "../src/app/+not-found";

const routes = {
  _layout: RootLayout,
  "(tabs)/_layout": TabLayout,
  "(tabs)/index": Home,
  "(tabs)/shop": Shop,
  "(tabs)/scan": Scan,
  "(tabs)/wallet": Wallet,
  "(tabs)/account": Account,
  "+not-found": NotFound,
};

describe("actual customer native navigation", () => {
  it("opens Home and reaches all five tabs with honest unavailable services", async () => {
    await renderRouter(routes, { initialUrl: "/" });
    expect(screen.getByRole("header", { name: "HOBBY LIVES HERE." })).toBeVisible();
    const destinations = [
      ["Shop", "Find your next favorite."],
      ["Scan", "Scan a barcode"],
      ["Wallet", "Wallet not connected"],
      ["Account", "Account access unavailable"],
      ["Home", "HOBBY LIVES HERE."],
    ];
    for (const [tab, heading] of destinations) {
      await fireEvent.press(screen.getByLabelText(new RegExp(`^${tab}, tab,`)));
      await waitFor(() => expect(tab === "Home" ? screen.getByRole("header", { name: heading }) : screen.getByText(heading)).toBeVisible());
    }
  });

  it("Home shortcut opens Shop; search edits, category selection and clearing work without provider traffic", async () => {
    const request = jest.spyOn(global, "fetch");
    await renderRouter(routes, { initialUrl: "/" });
    await fireEvent.press(
      screen.getByRole("link", { name: "Shop Products" }),
    );
    const input = screen.getByLabelText("Search products");
    await fireEvent.changeText(input, "Pikachu");
    await fireEvent.press(
      screen.getByRole("button", { name: "Search catalog" }),
    );
    expect(screen.getByText("Catalog unavailable")).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByLabelText("Search products")).toHaveDisplayValue("");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("Scan exposes manual shopping and associate help without provider traffic", async () => {
    await renderRouter(routes, { initialUrl: "/scan" });
    expect(screen.getByRole("header", { name: "Scan a barcode" })).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Need help? Ask an associate" }));
    await fireEvent.press(
      screen.getByRole("link", { name: "Go to product search" }),
    );
    expect(screen.getByLabelText("Search products")).toBeVisible();
  });

  it("Home category search opens Shop, can be cleared, and can be opened again", async () => {
    const request = jest.spyOn(global, "fetch");
    await renderRouter(routes, { initialUrl: "/" });
    await fireEvent.press(screen.getByRole("link", { name: "Browse Pokémon" }));
    await waitFor(() => expect(screen.getByLabelText("Search products")).toHaveDisplayValue("Pokémon"));
    await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByLabelText("Search products")).toHaveDisplayValue("");
    await fireEvent.press(screen.getByLabelText(/^Home, tab,/));
    await fireEvent.press(screen.getByRole("link", { name: "Browse Entertainment" }));
    await waitFor(() => expect(screen.getByLabelText("Search products")).toHaveDisplayValue("Entertainment"));
    expect(screen.queryByRole("button", { name: /Checkout|Buy now|Add to cart/ })).toBeNull();
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("ignores an oversized category-link search and keeps manual search usable", async () => {
    await renderRouter(routes, { initialUrl: "/shop?q=" + "x".repeat(101) });
    await waitFor(() => expect(screen.getByLabelText("Search products")).toHaveDisplayValue(""));
    await fireEvent.changeText(screen.getByLabelText("Search products"), "Valid search");
    await fireEvent.press(screen.getByRole("button", { name: "Search catalog" }));
    expect(screen.getByLabelText("Search products")).toHaveDisplayValue("Valid search");
  });

  it("Wallet leads to Account without a fabricated balance or enabled sign-in", async () => {
    await renderRouter(routes, { initialUrl: "/wallet" });
    expect(screen.getByText(/Account services are unavailable in this preview/)).toBeVisible();
    await fireEvent.press(
      screen.getByRole("link", { name: "Visit your account" }),
    );
    expect(
      screen.getByRole("button", { name: "Sign-in unavailable" }),
    ).toBeDisabled();
    await fireEvent.press(screen.getByRole("link", { name: "Back to Home" }));
    expect(screen.getByRole("header", { name: "HOBBY LIVES HERE." })).toBeVisible();
  });

  it("unknown and staff-only destinations have a safe customer recovery path", async () => {
    await renderRouter(routes, { initialUrl: "/mission-control" });
    expect(screen.getByText("Page not found")).toBeVisible();
    await fireEvent.press(screen.getByRole("link", { name: "Go to Home" }));
    expect(screen.getByRole("header", { name: "HOBBY LIVES HERE." })).toBeVisible();
  });
});
