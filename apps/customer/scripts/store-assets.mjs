import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const hashes = {};
for (const kind of ["reader", "writer"]) {
  const zxing = await import(`zxing-wasm/${kind}`);
  if (zxing.ZXING_WASM_VERSION !== "3.1.4")
    throw Error("Review the scanner upgrade before changing assets");
  const bytes = await readFile(
    new URL(import.meta.resolve(`zxing-wasm/${kind}/zxing_${kind}.wasm`)),
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== zxing.ZXING_WASM_SHA256) throw Error("WASM hash mismatch");
  const dir = "public/vendor/zxing-wasm/3.1.4";
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/zxing_${kind}.wasm`, bytes);
  hashes[kind] = hash;
}
await writeFile(
  "public/vendor/zxing-wasm/3.1.4/SHA256.json",
  JSON.stringify(hashes, null, 2) + "\n",
);
