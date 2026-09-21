import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

let localKey: Promise<string> | undefined;
export async function articleImageSigningKey() {
  const configured = process.env.CURIOFLOW_SECRET_KEY?.trim();
  if (configured) return configured;
  // Development installations may not configure the production encryption key.
  localKey ??= (async () => {
    const directory = join(process.cwd(), "storage");
    const path = join(directory, ".article-image-key");
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.${randomUUID()}`;
    try {
      await writeFile(temporary, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await unlink(temporary).catch(() => undefined); }
    const key = (await readFile(path, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid article image signing key");
    return key;
  })();
  try { return await localKey; } catch (error) { localKey = undefined; throw error; }
}

function imageSignature(path: string, itemId: string, key: string) {
  return createHmac("sha256", key).update(JSON.stringify(["article-image-v1", itemId, path])).digest("hex");
}

export function signedArticleImageUrl(path: string, itemId: string, origin: string, key: string) {
  const url = new URL(path, origin);
  url.searchParams.set("item", itemId);
  url.searchParams.set("signature", imageSignature(path, itemId, key));
  return url.href;
}

export function validArticleImageSignature(path: string, itemId: string, signature: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(imageSignature(path, itemId, key), "hex"));
}
