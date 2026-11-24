import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const assetTypes = new Map([
  ["cmaps", "application/octet-stream"],
  ["standard_fonts", "application/octet-stream"],
  ["iccs", "application/octet-stream"],
  ["wasm", "application/wasm"]
]);

export async function GET(_request: Request, context: { params: Promise<{ asset: string[] }> }) {
  const { asset } = await context.params;
  const [folder, name] = asset;
  const worker = folder === "build" && name === "pdf.worker.min.mjs";
  const type = worker ? "text/javascript" : assetTypes.get(folder);
  if (asset.length !== 2 || !type || (!worker && !/^[\w-]+\.[\w-]+$/.test(name))) {
    return new Response(null, { status: 404 });
  }
  const bytes = await readFile(join(process.cwd(), "node_modules", "pdfjs-dist", folder, name)).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "content-type": name.endsWith(".js") ? "text/javascript" : type,
      "x-content-type-options": "nosniff"
    }
  });
}
