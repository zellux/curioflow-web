"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const HIGHLIGHT_COLORS = ["#F3D27A", "#A9D4B2", "#A9C8EC", "#EBA9A2"];

type AnnotationInput = {
  id: string;
  quote: string;
  note: string | null;
  locationJson: string;
  createdAt: string;
};

type HighlightTarget = {
  quote: string;
  top: number;
  left: number;
};

type ReaderHighlighterProps = {
  annotations: AnnotationInput[];
  itemId: string;
  itemTitle: string;
  targetId: string;
};

type ViewAnnotation = AnnotationInput & {
  color: string;
};

function parseAnnotationColor(locationJson: string) {
  try {
    const location = JSON.parse(locationJson) as { color?: unknown };
    return typeof location.color === "string" && location.color ? location.color : HIGHLIGHT_COLORS[0];
  } catch {
    return HIGHLIGHT_COLORS[0];
  }
}

function selectionInside(target: HTMLElement, selection: Selection) {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  if (!element || !target.contains(element)) return null;

  const quote = selection.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    quote,
    top: Math.max(12, rect.top - 12),
    left: Math.min(window.innerWidth - 160, Math.max(80, rect.left + rect.width / 2))
  };
}

function unwrapExistingHighlights(root: HTMLElement) {
  root.querySelectorAll("mark[data-annotation-id]").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });

  root.querySelectorAll("sup[data-annotation-note]").forEach((noteMarker) => noteMarker.remove());
}

function textNodes(root: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE", "TEXTAREA", "BUTTON", "MARK"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function highlightFirstMatch(root: HTMLElement, annotation: ViewAnnotation, onOpen: (id: string) => void) {
  const quote = annotation.quote.replace(/\s+/g, " ").trim();
  if (!quote) return;

  for (const node of textNodes(root)) {
    const value = node.nodeValue ?? "";
    const normalizedValue = value.replace(/\s+/g, " ");
    const index = normalizedValue.indexOf(quote);
    if (index < 0) continue;

    const exactIndex = value.indexOf(quote);
    if (exactIndex < 0) continue;

    const range = document.createRange();
    range.setStart(node, exactIndex);
    range.setEnd(node, exactIndex + quote.length);

    const mark = document.createElement("mark");
    mark.dataset.annotationId = annotation.id;
    mark.className = "readerSavedHighlight";
    mark.style.backgroundColor = annotation.color;
    mark.title = annotation.note || "Highlight";
    mark.addEventListener("click", (event) => {
      event.stopPropagation();
      onOpen(annotation.id);
    });

    range.surroundContents(mark);

    if (annotation.note) {
      const noteMarker = document.createElement("sup");
      noteMarker.dataset.annotationNote = annotation.id;
      noteMarker.className = "readerNoteMarker";
      noteMarker.textContent = "*";
      noteMarker.addEventListener("click", (event) => {
        event.stopPropagation();
        onOpen(annotation.id);
      });
      mark.after(noteMarker);
    }

    return;
  }
}

export function ReaderHighlighter({ annotations, itemId, itemTitle, targetId }: ReaderHighlighterProps) {
  const router = useRouter();
  const [target, setTarget] = useState<HighlightTarget | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const viewAnnotations = useMemo(
    () =>
      annotations.map((annotation) => ({
        ...annotation,
        color: parseAnnotationColor(annotation.locationJson)
      })),
    [annotations]
  );

  const openAnnotation = useCallback(
    (annotationId: string) => {
      const annotation = viewAnnotations.find((entry) => entry.id === annotationId);
      setNotesOpen(true);
      setEditingId(annotationId);
      setNoteDraft(annotation?.note ?? "");

      requestAnimationFrame(() => {
        document.querySelector(`[data-note-card="${annotationId}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      });
    },
    [viewAnnotations]
  );

  const applyHighlights = useCallback(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    unwrapExistingHighlights(root);
    for (const annotation of viewAnnotations) {
      highlightFirstMatch(root, annotation, openAnnotation);
    }
  }, [openAnnotation, targetId, viewAnnotations]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  const inspectSelection = useCallback(() => {
    const root = document.getElementById(targetId);
    const selection = window.getSelection();
    if (!root || !selection) {
      setTarget(null);
      return;
    }

    setTarget(selectionInside(root, selection));
  }, [targetId]);

  useEffect(() => {
    document.addEventListener("mouseup", inspectSelection);
    document.addEventListener("keyup", inspectSelection);
    document.addEventListener("selectionchange", inspectSelection);

    const dismiss = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("[data-selection-toolbar]")) return;
      if (!window.getSelection()?.toString()) setTarget(null);
    };
    const clear = () => setTarget(null);

    document.addEventListener("mousedown", dismiss, true);
    window.addEventListener("scroll", clear, { passive: true });

    return () => {
      document.removeEventListener("mouseup", inspectSelection);
      document.removeEventListener("keyup", inspectSelection);
      document.removeEventListener("selectionchange", inspectSelection);
      document.removeEventListener("mousedown", dismiss, true);
      window.removeEventListener("scroll", clear);
    };
  }, [inspectSelection]);

  const createHighlight = async (color: string, openNote: boolean) => {
    if (!target || isSaving) return;
    setIsSaving(true);

    const response = await fetch(`/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color,
        quote: target.quote,
        location: {
          targetId,
          capture: "selection",
          savedAt: new Date().toISOString()
        }
      })
    });

    const body = (await response.json().catch(() => null)) as { annotation?: AnnotationInput } | null;
    window.getSelection()?.removeAllRanges();
    setTarget(null);
    setIsSaving(false);

    if (openNote && body?.annotation?.id) {
      setNotesOpen(true);
      setEditingId(body.annotation.id);
      setNoteDraft("");
    }

    router.refresh();
  };

  const updateNote = async () => {
    if (!editingId || isSaving) return;
    setIsSaving(true);
    await fetch(`/api/items/${itemId}/annotations`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        annotationId: editingId,
        note: noteDraft
      })
    });
    setEditingId(null);
    setNoteDraft("");
    setIsSaving(false);
    router.refresh();
  };

  const deleteAnnotation = async (annotationId: string) => {
    if (isSaving) return;
    setIsSaving(true);
    await fetch(`/api/items/${itemId}/annotations`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotationId })
    });
    if (editingId === annotationId) {
      setEditingId(null);
      setNoteDraft("");
    }
    setIsSaving(false);
    router.refresh();
  };

  return (
    <>
      <button className="readerNotesButton" onClick={() => setNotesOpen(true)} type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M4 5h16M4 12h10M4 19h7" />
        </svg>
        Notes
        {viewAnnotations.length > 0 ? <span>{viewAnnotations.length}</span> : null}
      </button>

      {target ? (
        <div
          className="selectionToolbar"
          data-selection-toolbar="true"
          onMouseDown={(event) => event.preventDefault()}
          style={{ left: target.left, top: target.top }}
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              aria-label="Highlight selected text"
              disabled={isSaving}
              key={color}
              onClick={() => createHighlight(color, false)}
              style={{ backgroundColor: color }}
              title="Highlight"
              type="button"
            />
          ))}
          <i />
          <button className="selectionNoteButton" disabled={isSaving} onClick={() => createHighlight(HIGHLIGHT_COLORS[0], true)} type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Note
          </button>
          <b />
        </div>
      ) : null}

      {notesOpen ? (
        <aside className="notesDrawer" aria-label="Highlights and notes">
          <header>
            <div>
              <h2>Highlights & notes</h2>
              <p>{itemTitle}</p>
            </div>
            <button aria-label="Close notes" onClick={() => setNotesOpen(false)} type="button">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="notesDrawerBody">
            {viewAnnotations.length > 0 ? (
              <div className="notesList">
                {viewAnnotations.map((annotation) => {
                  const isEditing = editingId === annotation.id;
                  return (
                    <article className="noteCard" data-note-card={annotation.id} key={annotation.id}>
                      <button className="noteQuote" onClick={() => openAnnotation(annotation.id)} type="button">
                        <span style={{ backgroundColor: annotation.color }} />
                        <strong>{annotation.quote}</strong>
                      </button>

                      {isEditing ? (
                        <div className="noteEditor">
                          <textarea
                            autoFocus
                            onChange={(event) => setNoteDraft(event.target.value)}
                            placeholder="Write a note..."
                            value={noteDraft}
                          />
                          <div>
                            <button disabled={isSaving} onClick={updateNote} type="button">
                              Save note
                            </button>
                            <button disabled={isSaving} onClick={() => setEditingId(null)} type="button">
                              Cancel
                            </button>
                            <button
                              aria-label="Delete highlight"
                              className="noteDeleteIcon"
                              disabled={isSaving}
                              onClick={() => deleteAnnotation(annotation.id)}
                              title="Delete highlight"
                              type="button"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="noteMeta">
                          {annotation.note ? <p>{annotation.note}</p> : null}
                          <div>
                            <button
                              onClick={() => {
                                setEditingId(annotation.id);
                                setNoteDraft(annotation.note ?? "");
                              }}
                              type="button"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                              {annotation.note ? "Edit note" : "Add note"}
                            </button>
                            <button disabled={isSaving} onClick={() => deleteAnnotation(annotation.id)} type="button">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                              </svg>
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="notesEmpty">
                <span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M4 5h16M4 12h10M4 19h7" />
                  </svg>
                </span>
                <h2>No highlights yet</h2>
                <p>Select any text in the article to highlight it or attach a note. They will collect here.</p>
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </>
  );
}
