import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("rendered photo dialogs have unique visible names, labeled controls and private unoptimized images", () => {
  // These are client components: render with regular React, separately from the
  // SQL/service suite's react-server condition. Focus/Escape needs browser QA.
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=commonjs"],
    {
      encoding: "utf8",
      input: `
      const { createElement } = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { PhotoView } = require('./components/northside-exam.tsx');
      const photo = { id: 'qa-photo', kind: 'front', ready: true, width: 120, height: 200 };
      console.log(renderToStaticMarkup(createElement('div', null,
        createElement(PhotoView, { photo, endpoint: '/api/private/exam?card=qa-card' }),
        createElement(PhotoView, { photo: { ...photo, id: 'qa-back', kind: 'back' }, endpoint: '/api/private/exam?card=qa-card' })
      )));
    `,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const html = result.stdout;
  const names = [
    ...html.matchAll(/<dialog[^>]*aria-labelledby="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2, "each photo dialog needs its own label");
  assert.ok(html.includes(`id="${names[0]}">Front photo</strong>`));
  assert.ok(html.includes(`id="${names[1]}">Back photo</strong>`));
  assert.equal((html.match(/aria-label="Photo zoom"/g) || []).length, 2);
  assert.equal((html.match(/>Close<\/button>/g) || []).length, 2);
  assert.ok(html.includes("/api/private/exam?card=qa-card&amp;photo=qa-photo"));
  assert.ok(
    !html.includes("/_next/image"),
    "private photos must stay out of the public optimizer",
  );
});
