import { parsePrivateCatalog } from "./catalog";

export const PRIVATE_FORMAT = "northside.private-catalog.aes256gcm.v1";
export const PRIVATE_ITERATIONS = 600000;
export const PRIVATE_CATALOG_PATH = "/private-catalog.enc.json";
function bytes(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error("Invalid encrypted selection");
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (length !== undefined && result.length !== length) throw new Error("Invalid encrypted selection");
  return result;
}
export async function decryptPrivateCatalog(envelope: unknown, code: string, provider = globalThis.crypto) {
  if (!provider?.subtle || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("Cannot unlock selection");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Invalid encrypted selection");
  const e = envelope as Record<string, unknown>;
  if (Object.keys(e).sort().join(",") !== "ciphertext,iterations,iv,salt,version" ||
      e.version !== PRIVATE_FORMAT || e.iterations !== PRIVATE_ITERATIONS) throw new Error("Invalid encrypted selection");
  const material = await provider.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await provider.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: PRIVATE_ITERATIONS, salt: bytes(e.salt, 16) },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await provider.subtle.decrypt({ name: "AES-GCM", iv: bytes(e.iv, 12), tagLength: 128,
    additionalData: new TextEncoder().encode(PRIVATE_FORMAT) }, key, bytes(e.ciphertext));
  if (plain.byteLength > 1000000) throw new Error("Invalid encrypted selection");
  return parsePrivateCatalog(JSON.parse(new TextDecoder().decode(plain)));
}
export async function loadPrivateCatalog(code: string, signal: AbortSignal) {
  const response = await fetch(PRIVATE_CATALOG_PATH, {
    signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Selection unavailable");
  if (Number(response.headers.get("content-length")) > 1500000) throw new Error("Selection too large");
  const body = await response.text();
  if (body.length > 1500000 || signal.aborted) throw new Error("Selection unavailable");
  return decryptPrivateCatalog(JSON.parse(body), code);
}
