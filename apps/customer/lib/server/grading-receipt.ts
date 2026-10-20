import "server-only";
import type { IntakeReceipt } from "../grading-portal";
import { examMoney } from "../grading";
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function gradingReceipt(receipt: IntakeReceipt, fixture: boolean) {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(receipt.received_at));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northside intake receipt</title><style>.privacy-hidden body{visibility:hidden!important}body{font:16px/1.5 system-ui,sans-serif;color:#153c50;margin:32px auto;max-width:800px;padding:16px}img{width:240px;height:auto}td,th{padding:10px;text-align:left;border-bottom:1px solid #ccc;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}small{overflow-wrap:anywhere}button{padding:12px} @media print{button{display:none}body{margin:0;font-size:11pt}} @page{size:letter;margin:18mm}</style><script src="/exam-report.js"></script></head><body><button id="print-report">Print / Save as PDF</button><p><img src="/northside-logo.svg" alt="Northside Collectibles"></p>${fixture ? "<p><strong>SAMPLE — LOCAL INTAKE RECEIPT</strong></p>" : ""}<h1>Grading intake receipt</h1><p>Received ${escape(date)} · America/Chicago</p><small>Receipt ${escape(receipt.id)}</small><table><thead><tr><th>Received card</th><th>Examination</th></tr></thead><tbody>${receipt.cards.map((c) => `<tr><td>${escape(c.description)}<br><small>${escape(c.card_id)}</small></td><td>${examMoney(c.examination_cents)}</td></tr>`).join("")}</tbody></table><p><strong>Examination subtotal: ${examMoney(receipt.examination_subtotal_cents)}</strong></p><p>${receipt.voided_at ? "This intake was reversed." : "Receipt of physical cards; not proof of payment."}</p><p>External grading, shipping, insurance and other charges remain separate and unset until quoted. Unset charges are not free. Review each card’s current itemized submission quote before approving external grading.</p></body></html>`;
}
