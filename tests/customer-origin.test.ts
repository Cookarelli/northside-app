import { expect, test } from "vitest";
import config from "../apps/customer/next.config";

test("native account login preserves Origin without exposing callback referrers", async () => {
  const rules = await config.headers!();
  const baseline = rules.find((rule) => rule.source === "/:path*")!;
  expect(baseline.headers).toContainEqual({
    key: "Referrer-Policy",
    value: "no-referrer",
  });
  const overrides = rules.filter((rule) =>
    rule.headers.some(
      (header) =>
        header.key === "Referrer-Policy" && header.value !== "no-referrer",
    ),
  );
  expect(overrides).toEqual([
    {
      source: "/account",
      headers: [{ key: "Referrer-Policy", value: "same-origin" }],
    },
  ]);
  expect(rules.indexOf(overrides[0])).toBeGreaterThan(rules.indexOf(baseline));
});
