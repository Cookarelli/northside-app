type TabEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
>;

/** Keep the photo's Close/range controls in a loop, including embedded webviews. */
export function wrapPhotoDialogTab(event: TabEvent, dialog: HTMLElement) {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled])",
    ),
  ].filter(
    (control) => control.tabIndex >= 0 && control.getClientRects().length > 0,
  );
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) return;
  const active = dialog.ownerDocument.activeElement;
  if (
    (!event.shiftKey && active === last) ||
    (event.shiftKey && active === first)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
