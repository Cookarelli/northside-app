import { expect, it, jest } from "@jest/globals";
import { renderRouter, fireEvent, screen, waitFor } from "expo-router/testing-library";
import { PrivateCatalogApi, parsePrivateCatalog } from "../src/private-preview/catalog";
import { PrivatePreviewContext } from "../src/private-preview/context";
import Root from "../src/app/_layout";
import Tabs from "../src/app/(tabs)/_layout";
import Home from "../src/app/(tabs)/index";
import Shop from "../src/app/(tabs)/shop";
import Product from "../src/app/product/[handle]";
import Account from "../src/app/(tabs)/account";
import Wallet from "../src/app/(tabs)/wallet";
import Scan from "../src/app/(tabs)/scan";

it("browses the real screens with an isolated Draft DTO, search and product details while checkout stays absent", async () => {
  const handle = "preview-" + "b".repeat(24), id = "gid://shopify/Product/987";
  const api = new PrivateCatalogApi(parsePrivateCatalog({ version: "northside.private-catalog.v1", shop: "9i3hnb-jw.myshopify.com",
    capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), products: [{
      id, handle, title: "Synthetic selected merchandise", description: "", productType: "Pokemon", publication: "draft", availableForSale: false,
      featuredImage: null, minVariantPrice: { amountCents: 2195, currencyCode: "USD" }, selectedVariantId: null,
      productPath: "/shop/" + handle, onlineStoreUrl: null,
      variants: { after: null, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{
        id: "gid://shopify/ProductVariant/988", productId: id, title: "Regular", identifiers: { state: "not_provided", sku: null, barcode: null },
        price: { amountCents: 2195, currencyCode: "USD" }, availability: { state: "unavailable", availableForSale: false, currentlyNotInStock: false, quantityAvailable: null },
      }] },
    }] }));
  const lock = jest.fn();
  await renderRouter({ _layout: () => <PrivatePreviewContext.Provider value={{ api, lock }}><Root /></PrivatePreviewContext.Provider>,
    "(tabs)/_layout": Tabs, "(tabs)/index": Home, "(tabs)/shop": Shop, "(tabs)/scan": Scan,
    "(tabs)/account": Account, "(tabs)/wallet": Wallet, "product/[handle]": Product }, { initialUrl: "/shop" });
  await waitFor(() => expect(screen.getByText("Synthetic selected merchandise")).toBeVisible());
  expect(screen.getByText("Private selection · Browsing only")).toBeVisible();
  await fireEvent.press(screen.getByRole("link", { name: /Synthetic selected merchandise.*Private selection/ }));
  await waitFor(() => expect(screen.getByText("Not offered for purchase in this private selection.")).toBeVisible());
  expect(screen.getByText(/Catalog snapshot/)).toBeVisible();
  expect(screen.queryByText("Available online")).toBeNull();
  expect(screen.queryByRole("button", { name: /Checkout|Add to cart|Buy now/ })).toBeNull();
  await fireEvent.press(screen.getByRole("link", { name: "Back to Shop" }));
  await fireEvent.changeText(screen.getByLabelText("Search products"), "does-not-match");
  await fireEvent.press(screen.getByRole("button", { name: "Search catalog" }));
  await waitFor(() => expect(screen.getByText("No items in this private selection match your search.")).toBeVisible());
  await fireEvent.press(screen.getByRole("radio", { name: "Pokemon" }));
  await fireEvent.press(screen.getByLabelText(/^Home, tab,/));
  await fireEvent.press(screen.getByRole("link", { name: "Browse Sports Cards" }));
  await waitFor(() => expect(screen.getByText("Synthetic selected merchandise")).toBeVisible());
  expect(screen.getByLabelText("Search products")).toHaveDisplayValue("");
  expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
  await fireEvent.press(screen.getByRole("radio", { name: "Pokemon" }));
  await fireEvent.press(screen.getByLabelText(/^Home, tab,/));
  await fireEvent.press(screen.getByRole("link", { name: "Browse Pokémon" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Pokemon" })).toBeChecked());
  expect(screen.getByLabelText("Search products")).toHaveDisplayValue("");
  expect(screen.getByText("Synthetic selected merchandise")).toBeVisible();
  await fireEvent.press(screen.getByRole("button", { name: "Lock private selection" }));
  expect(lock).toHaveBeenCalledTimes(1);
});
