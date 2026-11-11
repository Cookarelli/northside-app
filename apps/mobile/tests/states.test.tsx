import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StatePanel } from "../src/components/StatePanel";

describe("reusable native states", () => {
  it("announces an actual loading state without displaying invented records", async () => {
    await render(
      <StatePanel
        icon="shop"
        state={{
          status: "loading",
          title: "Loading products",
          message: "Please wait.",
        }}
      />,
    );
    expect(screen.getByLabelText("Loading")).toBeVisible();
    expect(
      screen.getByRole("header", { name: "Loading products" }),
    ).toBeVisible();
  });
  it("keeps confirmed empty and unavailable copy explicit", async () => {
    const view = await render(
      <StatePanel
        icon="shop"
        state={{
          status: "empty",
          title: "No matching products",
          message: "Try another search.",
        }}
      />,
    );
    expect(screen.getByText("No matching products")).toBeVisible();
    await view.rerender(
      <StatePanel
        icon="shop"
        state={{
          status: "unavailable",
          title: "Catalog unavailable",
          message: "Try again later.",
        }}
      />,
    );
    expect(screen.getByText("Catalog unavailable")).toBeVisible();
    expect(screen.queryByText("No matching products")).toBeNull();
    expect(screen.queryByLabelText("Loading")).toBeNull();
  });
});
