import { describe, expect, it } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { CatalogPhoto } from "../src/mvp/CatalogPhoto";

const first = {
  url: "https://cdn.shopify.com/s/files/1/1234/synthetic-a.jpg",
  altText: "Synthetic first photo",
};
const second = {
  url: "https://cdn.shopify.com/s/files/1/1234/synthetic-b.jpg",
  altText: "Synthetic replacement photo",
};

describe("catalog photo load attempts", () => {
  it("renders an honest accessible state for missing or unapproved images", async () => {
    const view = await render(
      <CatalogPhoto image={null} title="Synthetic card" height={190} />,
    );
    expect(
      screen.getByLabelText("Image unavailable: Synthetic card"),
    ).toBeVisible();
    await view.rerender(
      <CatalogPhoto
        image={{
          url: "https://private.example.test/secret",
          altText: "Unsafe",
        }}
        title="Synthetic card"
        height={190}
      />,
    );
    expect(screen.queryByLabelText("Unsafe")).toBeNull();
    expect(screen.getByText("Image unavailable")).toBeVisible();
  });
  it("recovers a failed load when the approved source changes", async () => {
    const view = await render(
      <CatalogPhoto image={first} title="Synthetic card" height={190} />,
    );
    await fireEvent(screen.getByLabelText("Synthetic first photo"), "error", {
      nativeEvent: { error: "SYNTHETIC decode failure" },
    });
    expect(screen.getByText("Image unavailable")).toBeVisible();
    await view.rerender(
      <CatalogPhoto image={second} title="Synthetic card" height={190} />,
    );
    expect(screen.getByLabelText("Synthetic replacement photo")).toBeVisible();
    expect(screen.queryByText("Image unavailable")).toBeNull();
  });
  it("explicit retry can load the same URL after a transient failure", async () => {
    const view = await render(
      <CatalogPhoto
        image={first}
        title="Synthetic card"
        height={300}
        attempt={0}
      />,
    );
    await fireEvent(screen.getByLabelText("Synthetic first photo"), "error", {
      nativeEvent: { error: "SYNTHETIC network failure" },
    });
    await view.rerender(
      <CatalogPhoto
        image={first}
        title="Synthetic card"
        height={300}
        attempt={1}
      />,
    );
    expect(screen.getByLabelText("Synthetic first photo")).toBeVisible();
  });
});
