import { JSDOM } from "jsdom";
import { sanitizeArticleHtmlWithToc } from "./reader/rendering.ts";

export function sanitizeNewsletterContent(input: { html?: string | null; text?: string | null }) {
  const prepared = sanitizeArticleHtmlWithToc(input.html, input.text, "newsletter");
  if (!prepared.html) {
    const text = input.text?.replace(/\r\n/g, "\n").trim() ?? "";
    return { html: null, text };
  }

  const dom = new JSDOM(`<main>${prepared.html}</main>`);
  const main = dom.window.document.querySelector("main");
  if (!main) return { html: null, text: input.text?.trim() ?? "" };

  // Email images can act as tracking pixels. Removing them at ingestion keeps
  // opening a newsletter from making an implicit request to the sender.
  for (const image of Array.from(main.querySelectorAll("img"))) image.remove();

  const text = (main.textContent ?? input.text ?? "").replace(/\s+/g, " ").trim();
  return { html: main.innerHTML.trim() || null, text };
}
