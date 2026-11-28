import { createHash } from "node:crypto";

export function readerRevision(item: {
  type?: string;
  status: string;
  title: string;
  document: { id: string; contentHash: string; metadataJson: string } | null;
}) {
  // Reading progress writes must not cause a refresh while the user scrolls.
  return createHash("sha256").update(JSON.stringify([
    item.type ?? "article", item.status, item.title, item.document?.id, item.document?.contentHash, item.document?.metadataJson
  ])).digest("hex");
}
