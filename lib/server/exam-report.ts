import "server-only";
import { photoLabels, scoreFields, type ExamRevision } from "../exam";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function examReport(
  revision: ExamRevision,
  cardId: string,
  images: Record<string, string>,
  fixture: boolean,
) {
  // Whitelisted public fields only. Never interpolate drafts, internal notes,
  // correction reasons, paper exam photos, or an arbitrary database object.
  const timestamp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(revision.signed_at));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northside Exam — Revision ${revision.revision}</title><style>
  *{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;color:#152d3a;margin:0;background:#edf3f6}main{max-width:900px;margin:24px auto;padding:32px;background:white}h1{font-size:30px;margin-bottom:4px}h2{font-size:20px}p{overflow-wrap:anywhere}.logo{width:230px;height:auto}.meta{font-size:13px;color:#435565}.photos{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;break-inside:avoid}figure img{width:100%;height:310px;object-fit:contain;background:#f5f7f8}figcaption{font-weight:bold}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #ccd6dc;padding:10px;text-align:left}.notes{white-space:pre-wrap}.sample{padding:12px;background:#fff0c9;font-weight:bold}.sign{border-top:2px solid #3695c3;margin-top:24px;padding-top:12px;break-inside:avoid}button{font:inherit;padding:10px 18px;cursor:pointer}.print-help{margin-bottom:24px}.privacy-hidden body{visibility:hidden}@media(max-width:550px){main{padding:18px;margin:0}.photos{grid-template-columns:1fr}}@media print{body{background:white}main{max-width:none;margin:0;padding:0}.print-help{display:none}.photos{grid-template-columns:1fr 1fr}figure img{height:75mm}h2,th{break-after:avoid}@page{size:letter;margin:15mm}}
  </style><script src="/exam-report.js"></script></head><body><main><div class="print-help"><button id="print-report" type="button">Print / Save as PDF</button><p>Review all pages before sharing. This report contains private customer card information.</p></div><img class="logo" src="/northside-logo.svg" alt="Northside Collectibles">${fixture ? '<p class="sample">SAMPLE — LOCAL PREVIEW, NOT A REAL EXAMINATION</p>' : ""}<h1>Northside Exam</h1><p>Published revision ${revision.revision}</p><h2>${escape(revision.description)}</h2><p class="meta">Card ID: ${escape(cardId)}<br>Report ID: ${escape(revision.id)}</p><div class="photos">${revision.photos
    .filter((p) => p.kind !== "paper")
    .map(
      (p) =>
        `<figure><img src="${escape(images[p.id])}" alt="${escape(photoLabels[p.kind])} of card"><figcaption>${escape(photoLabels[p.kind])}</figcaption></figure>`,
    )
    .join(
      "",
    )}</div><h2>Assessment</h2><table><thead><tr><th>Paper field</th><th>Score</th></tr></thead><tbody>${scoreFields.map((k) => `<tr><th>${k[0].toUpperCase() + k.slice(1)}</th><td>${revision[k]} / 10</td></tr>`).join("")}</tbody></table><h2>Notes</h2><p class="notes">${escape(revision.notes || "No additional findings recorded.")}</p><h2>Projected grade</h2><p>${escape(revision.unable_to_estimate ? "Unable to estimate" : revision.projected_grade)}</p><p>Manually assessed by Northside. This estimate is not a guaranteed grade or an external grading company's final result.</p><div class="sign"><h2>Signature</h2><p>Electronically signed by authenticated Northside examiner<br>${escape(revision.signed_by)}</p><p>${escape(timestamp)} (America/Chicago)<br><span class="meta">${escape(new Date(revision.signed_at).toISOString())}</span></p></div></main></body></html>`;
}
