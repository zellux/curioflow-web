import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { sanitizeArticleHtml } from "@/server/reader/rendering";

export type TranslationUnit = { id: string; text: string };
export type TranslationPlan = { html: string; chunks: TranslationUnit[][] };

export function translationSourceHash(item: { title: string; document: { text: string; articleHtml: string | null } | null }) {
  return createHash("sha256").update(JSON.stringify([item.title, item.document?.text, item.document?.articleHtml])).digest("hex");
}

function translatableNodes(root: Element) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.textContent?.trim() || node.parentElement?.closest("pre, code, math, svg, .katex, [translate=no]")) continue;
    nodes.push(node);
  }
  return nodes;
}

// Split at sentence/word boundaries when possible, with a hard bound even for
// a single unbroken paragraph. Preserve every character and surrogate pair.
export function splitTranslationText(text: string, maxCharacters: number) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxCharacters) {
    let end = maxCharacters;
    const candidate = rest.slice(0, end);
    const boundary = [...candidate.matchAll(/[.!?。！？]\s*|\s+/gu)].at(-1);
    if (boundary && boundary.index + boundary[0].length >= maxCharacters / 2) end = boundary.index + boundary[0].length;
    if (/[\uD800-\uDBFF]/u.test(rest[end - 1])) end -= 1;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) parts.push(rest);
  return parts;
}

export function createTranslationPlan(title: string, articleHtml: string | null, text: string, maxCharacters: number): TranslationPlan {
  const dom = new JSDOM("<main><h1></h1><section></section></main>");
  try {
    const root = dom.window.document.querySelector("main")!;
    root.querySelector("h1")!.textContent = title;
    const body = root.querySelector("section")!;
    const sanitized = sanitizeArticleHtml(articleHtml);
    if (sanitized) body.innerHTML = sanitized;
    else {
      for (const paragraph of text.split(/\n{2,}/).filter(part => part.trim())) {
        const p = dom.window.document.createElement("p");
        p.textContent = paragraph;
        body.append(p);
      }
    }
    const units = translatableNodes(root).flatMap((node, index) =>
      splitTranslationText(node.textContent!, maxCharacters).map((part, partIndex) => ({ id: `${index}:${partIndex}`, text: part })));
    const chunks: TranslationUnit[][] = [];
    let size = 0;
    for (const unit of units) {
      if (!chunks.length || size + unit.text.length > maxCharacters || chunks.at(-1)!.length >= 20) {
        chunks.push([]);
        size = 0;
      }
      chunks.at(-1)!.push(unit);
      size += unit.text.length;
    }
    return { html: root.innerHTML, chunks };
  } finally { dom.window.close(); }
}

export function parseTranslationResponse(response: string, units: TranslationUnit[]): TranslationUnit[] {
  const parsed: unknown = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!Array.isArray(parsed) || parsed.length !== units.length) throw new Error("Translation is incomplete.");
  const byId = new Map<string, string>();
  for (const entry of parsed) {
    if (!entry || typeof entry.id !== "string" || typeof entry.text !== "string" || !entry.text.trim() || byId.has(entry.id)) {
      throw new Error("Translation contains invalid or duplicate segments.");
    }
    byId.set(entry.id, entry.text);
  }
  return units.map(unit => {
    const text = byId.get(unit.id);
    if (!text) throw new Error("Translation is missing a segment.");
    // Keep whitespace around inline elements and across split text nodes.
    return { id: unit.id, text: (unit.text.match(/^\s*/u)?.[0] ?? "") + text.trim() + (unit.text.match(/\s*$/u)?.[0] ?? "") };
  });
}

export function assembleTranslation(plan: TranslationPlan, parts: TranslationUnit[][]) {
  const expected = plan.chunks.flat();
  const actual = parts.flat();
  if (actual.length !== expected.length || actual.some((unit, index) => unit.id !== expected[index].id)) throw new Error("Translation is incomplete.");
  const dom = new JSDOM("<main></main>");
  try {
    const root = dom.window.document.querySelector("main")!;
    root.innerHTML = plan.html;
    const nodes = translatableNodes(root);
    const values = new Map<number, string[]>();
    for (const unit of actual) {
      const index = Number(unit.id.split(":")[0]);
      const valuesForNode = values.get(index) ?? [];
      valuesForNode.push(unit.text);
      values.set(index, valuesForNode);
    }
    for (const [index, texts] of values) nodes[index].textContent = texts.join("");
    return { title: root.querySelector("h1")!.textContent!, articleHtml: root.querySelector("section")!.innerHTML };
  } finally { dom.window.close(); }
}
