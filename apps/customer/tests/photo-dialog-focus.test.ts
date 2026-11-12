import test from "node:test";
import assert from "node:assert/strict";
import { wrapPhotoDialogTab } from "../lib/photo-dialog-focus";

function setup() {
  const doc = { activeElement: null as unknown };
  const control = () => ({
    tabIndex: 0,
    getClientRects: () => [1],
    focus() {
      doc.activeElement = this;
    },
  });
  const close = control(),
    zoom = control();
  const dialog = {
    ownerDocument: doc,
    querySelectorAll: () => [close, zoom],
  } as unknown as HTMLElement;
  let prevented = false;
  const event = (key = "Tab", shiftKey = false, ctrlKey = false) => ({
    key,
    shiftKey,
    ctrlKey,
    metaKey: false,
    altKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  return { doc, close, zoom, dialog, event, prevented: () => prevented };
}
test("Tab on the last photo control wraps to Close", () => {
  const h = setup();
  h.zoom.focus();
  wrapPhotoDialogTab(h.event(), h.dialog);
  assert.equal(h.doc.activeElement, h.close);
  assert.equal(h.prevented(), true);
});
test("Shift-Tab on Close wraps to the last photo control", () => {
  const h = setup();
  h.close.focus();
  wrapPhotoDialogTab(h.event("Tab", true), h.dialog);
  assert.equal(h.doc.activeElement, h.zoom);
  assert.equal(h.prevented(), true);
});
test("ordinary interior Tab keeps native focus handling", () => {
  const h = setup();
  h.close.focus();
  wrapPhotoDialogTab(h.event(), h.dialog);
  assert.equal(h.doc.activeElement, h.close);
  assert.equal(h.prevented(), false);
});
test("Escape and browser modifier shortcuts are not trapped", () => {
  for (const event of [
    (h: ReturnType<typeof setup>) => h.event("Escape"),
    (h: ReturnType<typeof setup>) => h.event("Tab", false, true),
  ]) {
    const h = setup();
    h.zoom.focus();
    wrapPhotoDialogTab(event(h), h.dialog);
    assert.equal(h.doc.activeElement, h.zoom);
    assert.equal(h.prevented(), false);
  }
});
test("hidden or non-tabbable controls cannot become the wrapped focus target", () => {
  const h = setup();
  h.close.focus();
  const hidden = {
    tabIndex: 0,
    getClientRects: () => [],
    focus: () => assert.fail("hidden target"),
  };
  const skipped = {
    tabIndex: -1,
    getClientRects: () => [1],
    focus: () => assert.fail("non-tabbable target"),
  };
  h.dialog.querySelectorAll = (() => [
    hidden,
    skipped,
    h.close,
    h.zoom,
  ]) as unknown as typeof h.dialog.querySelectorAll;
  wrapPhotoDialogTab(h.event("Tab", true), h.dialog);
  assert.equal(h.doc.activeElement, h.zoom);
  assert.equal(h.prevented(), true);
});
