import "server-only";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  prepareZXingModule,
  writeBarcode,
  ZXING_WASM_SHA256,
} from "zxing-wasm/writer";
import { requireRole, type Sql, type Actor } from "./db";
import { AccessError, privateHeaders } from "./security";
import { qrLink, storeMode, type StoreMode } from "./store";
import { uuid } from "./loyalty";
let ready: Promise<unknown> | undefined;
export async function encodeStoreQR(link: string) {
  ready ??= (async () => {
    const b = await readFile(
      "public/vendor/zxing-wasm/3.1.4/zxing_writer.wasm",
    );
    if (createHash("sha256").update(b).digest("hex") !== ZXING_WASM_SHA256)
      throw Error("Invalid QR writer asset");
    return prepareZXingModule({
      overrides: {
        wasmBinary: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      },
      fireImmediately: true,
    });
  })();
  await ready;
  const result = await writeBarcode(link, {
    format: "QRCode",
    scale: 6,
    addHRT: true,
    addQuietZones: true,
    options: "ecLevel=H",
  });
  if (result.error || !result.image || !result.svg)
    throw new AccessError(503, "label_generation_failed");
  return result;
}
export async function storeLabel(
  db: Sql,
  a: Actor,
  id: string,
  format: string,
  mode: StoreMode = "live",
) {
  requireRole(a, ["owner", "admin", "operations", "read_only"]);
  if (!["svg", "png"].includes(format))
    throw new AccessError(400, "invalid_label_format");
  const qr = (
    await db.query<{ token: string }>(
      "select q.token from ns.store_qr q join ns.store_products p on p.tenant_id=q.tenant_id and p.id=q.product_id where q.tenant_id=$1 and q.id=$2 and q.active and p.fixture=$3",
      [a.tenant_id, uuid(id), storeMode(mode)],
    )
  ).rows[0];
  if (!qr) throw new AccessError(404, "active_label_not_found");
  const result = await encodeStoreQR(qrLink(qr.token, mode));
  // Keep the vetted symbol unchanged, including its quiet zone. Caption lives below it.
  const width = Number(result.svg.match(/<svg width="(\d+)"/)?.[1]);
  const height = Number(result.svg.match(/height="(\d+)"/)?.[1]);
  if (!width || !height)
    throw new AccessError(503, "label_dimensions_unavailable");
  const inner = result.svg.slice(result.svg.indexOf("<svg"));
  const label =
    mode === "sample" ? "SAMPLE — NOT FOR STORE USE" : "NORTHSIDE COLLECTIBLES";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 48}" viewBox="0 0 ${width} ${height + 48}"><rect width="100%" height="100%" fill="white"/>${inner}<text x="${width / 2}" y="${height + 22}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">${label}</text></svg>`;
  const bytes =
    format === "svg"
      ? svg
      : new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  return new Response(bytes, {
    headers: {
      ...privateHeaders(),
      "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
      "Content-Disposition": `attachment; filename="${mode === "sample" ? "SAMPLE-" : ""}northside-${qr.token}.${format}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
