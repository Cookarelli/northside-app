import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "test-renderer";
import { CatalogPhoto } from "../../customer/components/catalog-photo";

// The actual web client component uses a DOM-compatible renderer and synthetic
// image host. These state tests do not claim browser/CDN or device acceptance.
jest.mock("../../customer/node_modules/react", () =>
  jest.requireActual("react"),
);
jest.mock("../../customer/node_modules/next/image", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: (props: object) => React.createElement("img", props),
  };
});
const roots: Root[] = [];
async function renderPhoto(element: ReactElement) {
  const root = createRoot({
    textComponentTypes: ["div"],
    publicTextComponentTypes: ["div"],
  });
  roots.push(root);
  await act(async () => root.render(element));
  return {
    root,
    rerender: async (next: ReactElement) => {
      await act(async () => root.render(next));
    },
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

const first = {
  url: "https://cdn.shopify.com/s/files/1/1234/synthetic-web-a.jpg",
  altText: "Synthetic web photo",
};
describe("web catalog image boundary", () => {
  it("shows an honest placeholder after a load error and recovers for a new approved URL", async () => {
    const view = await renderPhoto(
      <CatalogPhoto featuredImage={first} title="Synthetic web card" />,
    );
    const image = view.root.container.queryAll(
      (instance) => instance.type === "img",
    )[0];
    expect(image.props.src).toBe(first.url);
    await act(async () => image.props.onError());
    expect(
      view.root.container.queryAll((instance) => instance.type === "div")[0]
        .props["aria-label"],
    ).toBe("Product photo unavailable: Synthetic web card");
    await view.rerender(
      <CatalogPhoto
        featuredImage={{ ...first, url: first.url + "?v=2" }}
        title="Synthetic web card"
      />,
    );
    expect(
      view.root.container.queryAll((instance) => instance.type === "img")[0]
        .props.src,
    ).toBe(first.url + "?v=2");
  });
  it.each([
    null,
    { ...first, url: "https://private.example.test/photo" },
    {
      ...first,
      url: "https://user:synthetic@cdn.shopify.com/s/files/1/photo.jpg",
    },
    { ...first, url: first.url + "?token=synthetic" },
  ])(
    "never creates an image request for missing or unsafe source %j",
    async (featuredImage) => {
      const view = await renderPhoto(
        <CatalogPhoto
          featuredImage={featuredImage}
          title="Synthetic web card"
        />,
      );
      expect(
        view.root.container.queryAll((instance) => instance.type === "img"),
      ).toHaveLength(0);
      expect(
        view.root.container.queryAll((instance) => instance.type === "div")[0]
          .props.role,
      ).toBe("img");
    },
  );
});
