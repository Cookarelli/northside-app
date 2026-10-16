import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("eslint-config-next"));
const nextRequire = createRequire(pluginRequire.resolve("@next/eslint-plugin-next"));
const globRequire = createRequire(nextRequire.resolve("fast-glob"));
const matchRequire = createRequire(globRequire.resolve("micromatch"));
const braces = matchRequire("braces");

describe("installed braces security patch", () => {
  it("preserves normal glob compilation, expansion and escaped literals", () => {
    expect(braces.expand("apps/{customer,control}/**/*.{ts,tsx}")).toEqual([
      "apps/customer/**/*.ts", "apps/customer/**/*.tsx",
      "apps/control/**/*.ts", "apps/control/**/*.tsx",
    ]);
    expect(braces.compile("file-{1..3}.ts")).toBe("file-([1-3]).ts");
    expect(braces.expand("\\{literal\\}")).toEqual(["{literal}"]);
    expect(braces.stringify("{abc}", { escapeInvalid: true })).toBe("{abc}");
    expect(braces.expand("${a,b}", { escapeInvalid: true })).toEqual(["${a,b}"]);
  });

  it("rejects deep brace, parenthesis and mixed patterns before stack exhaustion", () => {
    for (const [open, close] of [["{", "}"], ["(", ")"], ["{(", ")}"]]) {
      const pattern = open.repeat(2000) + "a,b" + close.repeat(2000);
      for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
        expect(() => operation(pattern)).toThrow(SyntaxError);
        expect(() => operation(pattern)).toThrow("maximum depth");
      }
    }
  });

  it("bounds cyclic AST node trees in each recursive walker", () => {
    for (const operation of [braces.compile, braces.expand, braces.stringify]) {
      const root = { type: "root", nodes: [] as unknown[] };
      root.nodes.push(root);
      expect(() => operation(root)).toThrow("maximum depth");
    }
  });

  it("accepts 128 nested braces and rejects 129 consistently", () => {
    const pattern = (depth: number) => "{".repeat(depth) + "a,b" + "}".repeat(depth);
    for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
      expect(() => operation(pattern(128))).not.toThrow();
      expect(() => operation(pattern(129))).toThrow("maximum depth");
    }
  });
});
