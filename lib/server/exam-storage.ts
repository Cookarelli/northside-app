import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { MAX_PHOTO_BYTES } from "../exam";
import { fixturesAllowed } from "../policy.mjs";
import { AccessError, matchesFileType } from "./security";
import { supabase } from "./providers";

export const photoHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type PhotoStore = {
  put: (key: string, bytes: Uint8Array) => Promise<void>;
  read: (key: string) => Promise<Uint8Array>;
};
export async function photoBytes(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_PHOTO_BYTES)
    throw new AccessError(413, "photo_exceeds_4_MiB");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "photo_required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PHOTO_BYTES) {
      await reader.cancel();
      throw new AccessError(413, "photo_exceeds_4_MiB");
    }
    chunks.push(value);
  }
  if (!size) throw new AccessError(400, "photo_required");
  return Buffer.concat(chunks);
}
export async function normalizePhoto(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw new AccessError(413, "photo_exceeds_4_MiB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime))
    throw new AccessError(415, "unsupported_photo_export_as_JPEG_PNG_or_WebP");
  if (!matchesFileType(bytes, mime))
    throw new AccessError(415, "file_contents_do_not_match_image_type");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 24000000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1)
      throw new AccessError(415, "animated_images_are_not_supported");
    // Decode the full image, honor EXIF orientation, and strip EXIF/GPS on output.
    const { data, info } = await image
      .autoOrient()
      .flatten({ background: "#fff" })
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
    if (data.length > MAX_PHOTO_BYTES)
      throw new AccessError(
        413,
        "processed_photo_exceeds_4_MiB_export_a_smaller_JPEG",
      );
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      hash: photoHash(data),
    };
  } catch (e) {
    if (e instanceof AccessError) throw e;
    throw new AccessError(
      415,
      "image_cannot_be_decoded_use_a_valid_JPEG_PNG_or_WebP_under_24_megapixels",
    );
  }
}
export function localPhotoStore(
  directory = resolve("work/grading-photos"),
): PhotoStore {
  const path = (key: string) => {
    if (
      !/^[a-f0-9-]{36}\/grading\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/.test(key)
    )
      throw new AccessError(400, "invalid_object_key");
    return resolve(directory, key);
  };
  return {
    async put(key, bytes) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.pending`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Atomic create-without-overwrite. A crash cannot leave half an image at
        // the final key; old confirmed photos can never be silently replaced.
        try {
          await link(temporary, file);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      } catch {
        throw new AccessError(503, "photo_storage_unavailable_retry");
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async read(key) {
      try {
        return await readFile(path(key));
      } catch {
        throw new AccessError(503, "photo_storage_unavailable_retry");
      }
    },
  };
}
export function examPhotoStore(fixture: boolean): PhotoStore {
  if (fixture) {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
    return localPhotoStore();
  }
  const storage = supabase(true, 10000).storage.from("northside-private");
  return {
    async put(key, bytes) {
      const { error } = await storage.upload(key, bytes, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "0",
      });
      // Never overwrite. A duplicate may be recovery after storage success and a
      // lost response/DB rollback. The caller must download and verify the bytes.
      if (error && !["409", "400"].includes(String(error.statusCode)))
        throw new AccessError(503, "photo_upload_unconfirmed_retry");
    },
    async read(key) {
      const { data, error } = await storage.download(key);
      if (error || !data)
        throw new AccessError(503, "photo_storage_unavailable_retry");
      if (data.size > MAX_PHOTO_BYTES)
        throw new AccessError(503, "stored_photo_size_mismatch");
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
