import type { PDFDataRangeTransport } from "pdfjs-dist";

export const PDF_RANGE_SIZE = 64 * 1024;

async function fetchRange(url: string, begin: number, end: number, signal: AbortSignal) {
  const response = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal });
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const length = Number(range?.[3]);
  const expectedEnd = Math.min(end, length);
  if (response.status !== 206 || Number(range?.[1]) !== begin || Number(range?.[2]) !== expectedEnd - 1) {
    await response.body?.cancel();
    throw new Error("Invalid PDF range response");
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length !== expectedEnd - begin) throw new Error("Incomplete PDF range response");
  return { data, length };
}

export async function openPdfSource(
  RangeTransport: typeof PDFDataRangeTransport,
  url: string,
  controller: AbortController,
  onError: () => void
) {
  // Next.js strips Content-Length from streamed route responses. Use Content-Range
  // to discover the file size and let PDF.js request the ranges it needs.
  const { signal } = controller;
  const initial = await fetchRange(url, 0, PDF_RANGE_SIZE, signal);
  return new class extends RangeTransport {
    constructor() {
      super(initial.length, initial.data);
    }

    requestDataRange(begin: number, end: number) {
      void fetchRange(url, begin, end, signal).then(({ data, length }) => {
        if (length !== initial.length) throw new Error("PDF size changed");
        if (!signal.aborted) this.onDataRange(begin, data);
      }).catch(() => {
        if (!signal.aborted) onError();
      });
    }

    abort() {
      controller.abort();
    }
  }();
}
