export type PdfPoint = { x: number; y: number };

export type PdfLocation =
  | { type: "pdf-underline"; page: number; x: number; y: number; width: number }
  | ({ type: "pdf-note"; page: number } & PdfPoint);

function isUnit(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

export function pdfLocation(value: unknown): PdfLocation | null {
  if (!value || typeof value !== "object") return null;
  const { type, page, x, y, width } = value as Record<string, unknown>;
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || !isUnit(x) || !isUnit(y)) return null;
  if (type === "pdf-note") return { type, page, x, y };
  if (type === "pdf-underline" && isUnit(width) && width > 0 && x + width <= 1.000001) {
    return { type, page, x, y, width };
  }
  return null;
}
