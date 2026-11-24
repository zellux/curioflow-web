import { MAX_PDF_UNDERLINE_SEGMENTS, type PdfUnderlineSegment } from "@/app/pdf-location";

export function pdfSelection(container: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString().trim();
  return quote ? { range, quote } : null;
}

export function selectedUnderlineSegments(container: HTMLElement, sheet: HTMLElement, range: Range, rotation: number) {
  const page = sheet.getBoundingClientRect();
  const vertical = rotation % 180 !== 0;
  const along = vertical ? page.height : page.width;
  const across = vertical ? page.width : page.height;
  const lines: { start: number; end: number; edge: number }[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

  // A range spanning whole elements also yields their boxes. Read the selected
  // part of each text node so each line uses the glyph bounds only.
  const fragment = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    fragment.setStart(node, node === range.startContainer ? range.startOffset : 0);
    fragment.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent?.length ?? 0);
    for (const rect of fragment.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const start = vertical ? rect.top - page.top : rect.left - page.left;
      const end = start + (vertical ? rect.height : rect.width);
      const edge = vertical
        ? (rotation === 90 ? rect.left - page.left : rect.right - page.left)
        : (rotation === 180 ? rect.top - page.top : rect.bottom - page.top);
      if (start < along && end > 0 && edge >= 0 && edge <= across) {
        lines.push({ start: Math.max(0, start), end: Math.min(along, end), edge });
      }
    }
  }

  const merged: typeof lines = [];
  for (const line of lines.sort((a, b) => a.start - b.start)) {
    const adjacent = merged.find(candidate => Math.abs(candidate.edge - line.edge) <= 2 && line.start <= candidate.end + 3);
    if (adjacent) adjacent.end = Math.max(adjacent.end, line.end);
    else merged.push(line);
    if (merged.length > MAX_PDF_UNDERLINE_SEGMENTS) return [];
  }

  return merged.sort((a, b) => a.edge - b.edge || a.start - b.start).map<PdfUnderlineSegment>(({ start, end, edge }) => (
    vertical ? { x: edge / across, y: start / along, height: (end - start) / along }
      : { x: start / along, y: edge / across, width: (end - start) / along }
  ));
}
