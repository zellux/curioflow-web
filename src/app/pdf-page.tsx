"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfLocation, PdfPoint } from "@/app/pdf-location";

export type PdfTool = "read" | "underline" | "note";
export type PdfZoom = "page" | "width" | number;
export type PdfMark = { id: string; note: string | null; quote: string; location: PdfLocation | null };
export type LocatedPdfMark = PdfMark & { location: PdfLocation };

export function PdfMarkOverlay({ location, onClick, label }: {
  location: PdfLocation;
  onClick?: () => void;
  label?: string;
}) {
  const style = {
    left: `${location.x * 100}%`,
    top: `${location.y * 100}%`,
    width: location.type === "pdf-underline" ? `${location.width * 100}%` : undefined
  };
  const className = location.type === "pdf-underline" ? "pdfUnderline" : "pdfNotePin";
  return onClick
    ? <button type="button" className={className} style={style} onClick={onClick} aria-label={label} title={label}/>
    : <span className={className} style={style} aria-hidden="true"/>;
}

function underline(page: number, start: PdfPoint, end: PdfPoint): PdfLocation {
  return { type: "pdf-underline", page, x: Math.min(start.x, end.x), y: start.y, width: Math.abs(end.x - start.x) };
}

function point(event: PointerEvent<HTMLElement>): PdfPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

export function PdfPage({ pdf, number, zoom, tool, marks, draft, onMark, onSelect, loadingLabel, errorLabel, pageLabel }: {
  pdf: PDFDocumentProxy;
  number: number;
  zoom: PdfZoom;
  tool: PdfTool;
  marks: LocatedPdfMark[];
  draft?: PdfLocation;
  onMark: (location: PdfLocation) => void;
  onSelect: (mark: LocatedPdfMark) => void;
  loadingLabel: string;
  errorLabel: string;
  pageLabel: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; start: PdfPoint } | null>(null);
  const [drag, setDrag] = useState<PdfLocation | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [page, setPage] = useState<PDFPageProxy>();
  const [painted, setPainted] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(number).then(value => {
      if (!cancelled) setPage(value);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [pdf, number]);

  const natural = page?.getViewport({ scale: 1 });
  const fitWidth = size && natural ? size.width / natural.width : 1;
  const fitHeight = size && natural ? size.height / natural.height : 1;
  const scale = zoom === "page" ? Math.min(fitWidth, fitHeight) : (zoom === "width" ? fitWidth : zoom);
  const view = page && size ? page.getViewport({ scale }) : null;
  const width = view?.width ?? 0;
  const height = view?.height ?? 0;
  const renderKey = `${number}:${width}:${height}`;
  const ready = painted === renderKey;

  useEffect(() => {
    if (!canvasHost.current || !page || width <= 0 || height <= 0) return;
    const host = canvasHost.current;
    const canvas = document.createElement("canvas");
    const resolution = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (width * height)));
    canvas.width = Math.max(1, Math.floor(width * resolution));
    canvas.height = Math.max(1, Math.floor(height * resolution));
    const task = page.render({
      canvas,
      viewport: page.getViewport({ scale }),
      transform: [canvas.width / width, 0, 0, canvas.height / height, 0, 0]
    });
    let cancelled = false;
    void task.promise.then(() => {
      if (cancelled) return;
      host.replaceChildren(canvas);
      setPainted(renderKey);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; task.cancel(); };
  }, [height, page, renderKey, scale, width]);

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!ready || tool === "read" || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const start = point(event);
    pointer.current = { id: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (tool === "underline" && pointer.current?.id === event.pointerId) {
      setDrag(underline(number, pointer.current.start, point(event)));
    }
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    const endPoint = point(event);
    const distance = Math.abs(endPoint.x - pointer.current.start.x) * width;
    if (tool === "underline" && distance > 5) onMark(underline(number, pointer.current.start, endPoint));
    if (tool === "note") onMark({ type: "pdf-note", page: number, ...endPoint });
    clearPointer();
  }

  function clearPointer() {
    pointer.current = null;
    setDrag(null);
  }

  return <div className="pdfViewport" ref={viewport} tabIndex={0} aria-label={pageLabel}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || event.key !== "Enter" || tool !== "note" || !ready) return;
      event.preventDefault();
      onMark({ type: "pdf-note", page: number, x: 0.5, y: 0.5 });
    }}>
    {!error && view ? (
      <div className="pdfSheet" role="group" aria-label={pageLabel} style={{ width, height }}>
        <div className="pdfCanvas" ref={canvasHost} aria-hidden="true" />
        {ready ? (
          <div className="pdfMarkLayer" data-tool={tool}
            onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={clearPointer} onLostPointerCapture={clearPointer}>
            {marks.map(mark => <PdfMarkOverlay key={mark.id} location={mark.location} onClick={() => onSelect(mark)} label={mark.note || pageLabel} />)}
            {drag || draft ? <PdfMarkOverlay location={drag ?? draft!} /> : null}
          </div>
        ) : null}
      </div>
    ) : null}
    {!ready || error ? <div className="pdfPageMessage" role={error ? "alert" : "status"}>{error ? errorLabel : loadingLabel}</div> : null}
  </div>;
}
