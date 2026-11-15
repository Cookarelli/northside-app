import "server-only";
import { constants } from "node:fs";
import { mkdir, open, link, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixturesAllowed } from "../policy.mjs";
import { MAX_PHOTO_BYTES } from "../exam";
import { AccessError } from "./security";
import type { PhotoStore } from "./exam-storage";

const id = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
const requestKey = new RegExp(`^${id}/${id}/requests/${id}/${id}\\.jpg$`);
/** Explicit loopback-fixture storage. Production callers must use private Storage. */
export function localRequestPhotoStore(
  directory = resolve("work/service-request-photos"),
): PhotoStore {
  const available = () => {
    if (!fixturesAllowed(process.env)) throw new AccessError(404, "not_found");
  };
  available();
  const path = (key: string) => {
    available();
    if (!requestKey.test(key)) throw new AccessError(400, "invalid_object_key");
    return resolve(directory, key);
  };
  return {
    async put(key, bytes) {
      const file = path(key);
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
        throw new AccessError(413, "photo_exceeds_4_MiB");
      const temporary = `${file}.${randomUUID()}.pending`;
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        // Linking a complete temporary file atomically creates the final name.
        // A duplicate is recovery, never permission to overwrite confirmed bytes.
        try {
          await link(temporary, file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      } catch {
        throw new AccessError(503, "request_photo_storage_unavailable_retry");
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },
    async read(key) {
      const file = path(key);
      try {
        const handle = await open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || !stat.size || stat.size > MAX_PHOTO_BYTES)
            throw new Error("Invalid local photo");
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      } catch {
        throw new AccessError(503, "request_photo_storage_unavailable_retry");
      }
    },
  };
}
