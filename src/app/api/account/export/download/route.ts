import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { resolveAccountExportDownload } from "@/server/account-exports";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const format = url.searchParams.get("format")?.trim() ?? "json";
  if (!token) return Response.json({ error: "Download token is required" }, { status: 400 });
  const file = await resolveAccountExportDownload(token, format);
  if (!file) return Response.json({ error: "Download link is invalid or expired" }, { status: 404 });
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "content-type": file.contentType,
      "x-content-type-options": "nosniff"
    }
  });
}
