import "server-only";
import type { BreakEvent } from "../breaks";
import { SHOP } from "./providers";
import { AccessError } from "./security";
const stamp = (v: string) =>
  new Date(v)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const escape = (s: string) =>
  s
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
function fold(s: string) {
  let line = "",
    length = 0;
  const lines: string[] = [];
  for (const c of s) {
    const n = Buffer.byteLength(c);
    if (length + n > 75) {
      lines.push(line);
      line = " ";
      length = 1;
    }
    line += c;
    length += n;
  }
  lines.push(line);
  return lines.join("\r\n");
}
export function breakCalendar(e: BreakEvent) {
  if (!e.starts_at) throw new AccessError(409, "break_date_unconfirmed");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Northside Collectibles//Break schedule//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:break-${e.id}@${SHOP}`,
      `SEQUENCE:${e.version}`,
      `DTSTAMP:${stamp(e.updated_at)}`,
      `LAST-MODIFIED:${stamp(e.updated_at)}`,
      `DTSTART:${stamp(e.starts_at)}`,
      `DTEND:${stamp(new Date(Date.parse(e.starts_at) + e.duration_minutes * 60000).toISOString())}`,
      `SUMMARY:${escape((e.fixture ? "SAMPLE — " : "") + e.title)}`,
      `DESCRIPTION:${escape((e.fixture ? "Fictional local sample. " : "") + e.description + "\nSchedule status: " + e.status + ". Times are staff recorded; scheduled start does not prove live status.\n" + e.terms)}`,
      `STATUS:${e.status === "canceled" ? "CANCELLED" : e.status === "delayed" ? "TENTATIVE" : "CONFIRMED"}`,
      ...(e.stream_url ? [`URL:${e.stream_url}`] : []),
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}
