export type AccountExportFormatPayload = {
  generatedAt: string;
  account: {
    name: string;
    libraries: Array<{
      name: string;
      sources: Array<{ name: string; status: string; type: string; url: string | null }>;
      items: Array<{
        title: string;
        url: string | null;
        author: string | null;
        document: { text: string | null } | null;
        annotations: Array<{ quote: string; note: string | null }>;
      }>;
    }>;
  };
};

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function markdownText(value: string | null | undefined) {
  return value?.trim() || "";
}

export function formatAccountExportMarkdown(payload: AccountExportFormatPayload) {
  const lines = [`# Curioflow export: ${payload.account.name}`, "", `Generated: ${payload.generatedAt}`, ""];
  for (const library of payload.account.libraries) {
    lines.push(`## ${library.name}`, "");
    for (const item of library.items) {
      lines.push(`### ${item.title}`, "");
      if (item.url) lines.push(`Source: ${item.url}`, "");
      if (item.author) lines.push(`Author: ${item.author}`, "");
      if (item.document?.text) lines.push(markdownText(item.document.text), "");
      for (const annotation of item.annotations) {
        lines.push(`> ${markdownText(annotation.quote)}`);
        if (annotation.note) lines.push("", markdownText(annotation.note));
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export function formatAccountExportOpml(payload: AccountExportFormatPayload) {
  const sources = payload.account.libraries.flatMap((library) => library.sources)
    .filter((source) => ["rss", "podcast"].includes(source.type) && source.status !== "unsubscribed" && source.url);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head><title>Curioflow subscriptions</title></head>",
    "  <body>",
    ...sources.map((source) => `    <outline type="rss" text="${xml(source.name)}" title="${xml(source.name)}" xmlUrl="${xml(source.url!)}" />`),
    "  </body>",
    "</opml>",
    ""
  ].join("\n");
}
