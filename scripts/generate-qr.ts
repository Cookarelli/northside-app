import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import jsQR from "jsqr";
async function main() {
  const base = process.env.NORTHSIDE_PUBLIC_URL || "http://127.0.0.1:3100";
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Set a public Northside base URL without credentials.");
  const directory = resolve("outputs/qr-samples");
  await mkdir(directory, { recursive: true });
  const report = [];
  for (const [code, label] of [
    ["N001", "Product — Rookie Series pack"],
    ["N002", "Product — explicit box/case selection"],
    ["C001", "Collection — Starting lineup"],
    ["STORE", "Store entry"],
  ]) {
    const target = new URL(`/in-store/q/${code}`, url).toString();
    const buffer = await QRCode.toBuffer(target, {
      width: 800,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#123d55", light: "#ffffff" },
    });
    const png = PNG.sync.read(buffer);
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    if (decoded?.data !== target) throw new Error(`QR decode failed: ${code}`);
    await writeFile(resolve(directory, `${code}.png`), buffer);
    report.push({ code, label, url: target, decodeVerified: true });
  }
  await writeFile(
    resolve(directory, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        geometry:
          "Standard square modules, 4-module quiet zone. Start at 35mm square or larger. Print/device testing required.",
        artwork: "No logo or rounded modules applied; placeholder design.",
        samples: report,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Generated and decoded ${report.length} QR samples in ${directory}. Printed/device scanning remains unverified.`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "QR generation failed",
  );
  process.exitCode = 1;
});
