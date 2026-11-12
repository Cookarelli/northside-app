import test from "node:test";
import assert from "node:assert/strict";
import { showListState } from "../lib/show-list";
import type { Show } from "../lib/engagement";

test("a successful empty show read remains a confirmed empty result", async () => {
  assert.deepEqual(await showListState(async () => []), {
    status: "ready",
    shows: [],
  });
});

test("published shows retain exact server identities, fields and ordering", async () => {
  const shows: Show[] = [
    {
      id: "test-id",
      slug: "test-show",
      brand: "northside",
      title: "SAMPLE show",
      description: "Local test only",
      starts_at: null,
      location: null,
      published: true,
      fixture: true,
      version: 1,
    },
  ];
  const result = await showListState(async () => shows);
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.shows, shows);
});

test("failed show reads are unavailable, never empty or raw private provider errors", async () => {
  const result = await showListState(async () => {
    throw Error("private database/provider configuration");
  });
  assert.deepEqual(result, { status: "unavailable" });
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!("shows" in result));
});

test("a retry can recover from unavailable to a successful empty response", async () => {
  let reads = 0;
  const read = async (): Promise<Show[]> => {
    if (++reads === 1) throw Error("connection lost");
    return [];
  };
  assert.equal((await showListState(read)).status, "unavailable");
  assert.deepEqual(await showListState(read), { status: "ready", shows: [] });
  assert.equal(reads, 2);
});
