export type PdfPoint = { x: number; y: number };
export type PdfUnderlineSegment = PdfPoint & ({ width: number; height?: never } | { height: number; width?: never });

export const MAX_PDF_UNDERLINE_SEGMENTS = 400;

export type PdfLocation =
  | ({ type: "pdf-underline"; page: number; width: number } & PdfPoint)
  | { type: "pdf-text-underline"; page: number; segments: PdfUnderlineSegment[] }
  | ({ type: "pdf-note"; page: number } & PdfPoint);

function isUnit(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function underlineSegment(value: unknown): PdfUnderlineSegment | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isUnit(x) || !isUnit(y)) return null;
  if (isUnit(width) && width > 0 && x + width <= 1.000001) return { x, y, width };
  if (isUnit(height) && height > 0 && y + height <= 1.000001) return { x, y, height };
  return null;
}

export function pdfLocation(value: unknown): PdfLocation | null {
  if (!value || typeof value !== "object") return null;
  const { type, page, x, y, width, segments } = value as Record<string, unknown>;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return null;
  if (type === "pdf-text-underline") {
    if (!Array.isArray(segments) || !segments.length || segments.length > MAX_PDF_UNDERLINE_SEGMENTS) return null;
    const parsed = segments.map(underlineSegment);
    return parsed.every(segment => segment !== null) ? { type, page, segments: parsed } : null;
  }
  if (!isUnit(x) || !isUnit(y)) return null;
  if (type === "pdf-note") return { type, page, x, y };
  if (type === "pdf-underline" && isUnit(width) && width > 0 && x + width <= 1.000001) {
    return { type, page, x, y, width };
  }
  return null;
}
