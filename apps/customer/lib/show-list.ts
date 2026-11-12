import type { Show } from "./engagement";

export type ShowListState =
  { status: "ready"; shows: Show[] } | { status: "unavailable" };

/** An unsuccessful read is never evidence that no shows are published. */
export async function showListState(
  read: () => Promise<Show[]>,
): Promise<ShowListState> {
  try {
    return { status: "ready", shows: await read() };
  } catch {
    // Provider/database errors may contain private configuration. Do not project them.
    return { status: "unavailable" };
  }
}
