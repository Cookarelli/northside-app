import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
import { parsePrivateCatalog } from "../src/private-preview/catalog";
import { PRIVATE_FORMAT, PRIVATE_ITERATIONS, PRIVATE_CATALOG_PATH } from "../src/private-preview/crypto";

// Operator-only: read an explicitly selected, locally projected Shopify snapshot.
// No Shopify credentials, network requests, mutations or automatic product selection.
async function main() {
const [inputArg, exportArg, credentialsArg] = process.argv.slice(2);
if (!inputArg || !exportArg || !credentialsArg) throw new Error("Use: package-private-preview.ts selected-source.json web-export-dir private-access.json");
const input = resolve(inputArg), output = resolve(exportArg), credentials = resolve(credentialsArg);
for (const p of [input, credentials]) {
  const path = relative(output, p);
  if (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path))
    throw new Error("Plaintext input and access code must remain outside the public export");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid selected Shopify record");
  return value as Record<string, unknown>;
}
const raw = record(JSON.parse(await readFile(input, "utf8")));
if (raw.shop !== "9i3hnb-jw.myshopify.com" || !Array.isArray(raw.products) || !raw.products.length || raw.products.length > 6)
  throw new Error("Require one to six explicitly selected Northside products");
function cents(price: unknown) {
  if (typeof price !== "string" || !/^\d+(\.\d{1,2})?$/.test(price)) throw new Error("Invalid Shopify price");
  const [whole, fraction = ""] = price.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid Shopify price");
  return amount;
}
const products = raw.products.map((product: unknown) => {
  const p = record(product);
  if (p.status !== "DRAFT" || p.currencyCode !== "USD" || !Array.isArray(p.variants) || p.variants.length !== p.totalVariants)
    throw new Error("Require Draft status, USD and complete variant evidence");
  const handle = "preview-" + randomBytes(12).toString("hex");
  const variants = p.variants.map(record);
  const image = p.featuredImage ? record(p.featuredImage) : null;
  return {
    id: p.id, handle, title: p.title, description: "", productType: p.productType,
    publication: "draft", availableForSale: false,
    featuredImage: image ? { url: image.url, altText: image.altText } : null,
    minVariantPrice: { amountCents: Math.min(...variants.map(v => cents(v.price))), currencyCode: "USD" },
    variants: { after: null, pageInfo: { hasNextPage: false, endCursor: null }, nodes: variants.map(v => ({
      id: v.id, productId: p.id, title: v.title,
      identifiers: { state: "not_provided", sku: null, barcode: null },
      price: { amountCents: cents(v.price), currencyCode: "USD" },
      availability: { state: "unavailable", availableForSale: false, currentlyNotInStock: false, quantityAvailable: null },
    })) },
    selectedVariantId: null, productPath: "/shop/" + handle, onlineStoreUrl: null,
  };
});
const captured = Date.now();
const capturedAt = new Date(captured).toISOString(), expiresAt = new Date(captured + 86400000).toISOString();
const selection = parsePrivateCatalog({ version: "northside.private-catalog.v1", shop: raw.shop, capturedAt, expiresAt, products });
const accessCode = randomBytes(32).toString("base64url"), salt = randomBytes(16), iv = randomBytes(12);
const key = pbkdf2Sync(accessCode, salt, PRIVATE_ITERATIONS, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from(PRIVATE_FORMAT));
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(selection), "utf8"), cipher.final(), cipher.getAuthTag()]);
key.fill(0);
const envelope = { version: PRIVATE_FORMAT, iterations: PRIVATE_ITERATIONS, salt: salt.toString("base64"), iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64") };
await mkdir(output, { recursive: true });
await writeFile(credentials, JSON.stringify({ accessCode, capturedAt, expiresAt, project: "@northside-collectibles/northside-customer", url: null,
  note: "Share this code only with Joey. It is never uploaded. Refresh, backgrounding or Lock clears the local viewing session. This encrypted static snapshot cannot remotely revoke previously downloaded data." }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
await writeFile(resolve(output, "." + PRIVATE_CATALOG_PATH), JSON.stringify(envelope) + "\n", { flag: "wx" });
console.log(JSON.stringify({ encryptedProducts: products.length, capturedAt, expiresAt, credentialsSavedOutsideExport: true, ciphertextOnly: true }));
}
void main().catch(() => { console.error("Private preview packaging failed. Check the selected source, output paths and existing access-file destination."); process.exitCode = 1; });
