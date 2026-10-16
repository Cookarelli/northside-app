import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/pwa", { recursive: true });
for (const size of [180, 192, 512]) {
  const artwork = await sharp("public/northside-logo.svg")
    .resize({
      width: Math.round(size * 0.7),
      height: Math.round(size * 0.3),
      fit: "inside",
    })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: artwork, gravity: "centre" }])
    .png()
    .toFile(`public/pwa/icon-${size}.png`);
}
