"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { getUiCopy, type SystemLanguage } from "@/app/i18n";
import { appHref } from "@/app/routes";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

type UploadPhase = "idle" | "uploading" | "processing" | "opening";

type PdfUploadFormProps = {
  externalFile: File | null;
  initialError: string | null;
  isActive: boolean;
  locale: SystemLanguage;
  onExternalFileConsumed: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

function isLikelyPdfDrag(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? []);
  const fileItems = items.filter((item) => item.kind === "file");
  if (fileItems.length === 0) return true;
  return fileItems.some((item) => !item.type || item.type === "application/pdf");
}

function isPdfCandidate(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function PdfStageArtwork({ active, invalid }: { active: boolean; invalid: boolean }) {
  return (
    <div className={`pdfStageArtwork ${active ? "isActive" : ""} ${invalid ? "isInvalid" : ""}`} aria-hidden="true">
      <span className="pdfSheetBack pdfSheetLeft" />
      <span className="pdfSheetBack pdfSheetRight" />
      <span className="pdfSheetFront">
        <span className="pdfSheetFold" />
        <span className="pdfSheetTag">PDF</span>
        <span className="pdfSheetLines">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="pdfStageBadge">
        {invalid ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17V5M7 10l5-5 5 5" />
          </svg>
        )}
      </span>
    </div>
  );
}

function PdfDocumentIcon() {
  return (
    <span className="pdfFileIcon" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" />
        <path d="M14 2.5v5h5" />
        <path d="M8.5 13h7M8.5 16.5h4.5" />
      </svg>
      <em>PDF</em>
    </span>
  );
}

export function PdfUploadForm({
  externalFile,
  initialError,
  isActive,
  locale,
  onExternalFileConsumed
}: PdfUploadFormProps) {
  const copy = getUiCopy(locale).addSource;
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const dragDepthRef = useRef(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(initialError);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [dragState, setDragState] = useState<"idle" | "valid" | "invalid">("idle");

  const uploading = phase !== "idle";

  const syncInputFile = useCallback((file: File | null) => {
    const input = inputRef.current;
    if (!input) return;
    if (!file) {
      input.value = "";
      return;
    }
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Safari / older environments may restrict programmatic FileList assignment; state still holds the File.
    }
  }, []);

  const acceptFile = useCallback(async (file: File | null | undefined) => {
    if (!file || uploading) return;
    setUploadError(null);

    if (file.size === 0) {
      setUploadError(copy.pdfErrorEmpty);
      return;
    }
    if (!isPdfCandidate(file)) {
      setUploadError(copy.pdfErrorType);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setUploadError(copy.pdfErrorTooLarge(formatBytes(file.size)));
      return;
    }

    try {
      const header = await file.slice(0, 5).text();
      if (header !== "%PDF-") {
        setUploadError(copy.pdfErrorInvalid);
        return;
      }
    } catch {
      // Fall back to server-side magic byte verification if slice read fails.
    }

    setSelectedFile(file);
    syncInputFile(file);
  }, [copy, syncInputFile, uploading]);

  useEffect(() => {
    if (!externalFile) return;
    void acceptFile(externalFile);
    onExternalFileConsumed();
  }, [acceptFile, externalFile, onExternalFileConsumed]);

  useEffect(() => {
    if (!isActive || uploading) return;
    function handlePaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      const pdfFile = files.find(isPdfCandidate) ?? files[0];
      if (!pdfFile) return;
      event.preventDefault();
      void acceptFile(pdfFile);
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [acceptFile, isActive, uploading]);

  useEffect(() => {
    if (!isActive) {
      dragDepthRef.current = 0;
      setDragState("idle");
    }
  }, [isActive]);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      xhrRef.current = null;
    };
  }, []);

  function openPicker(event?: MouseEvent<HTMLElement>) {
    event?.stopPropagation();
    if (uploading) return;
    inputRef.current?.click();
  }

  function clearFile(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (uploading) return;
    setSelectedFile(null);
    setUploadError(null);
    syncInputFile(null);
  }

  function cancelUpload(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase("idle");
    setProgress(0);
    setUploadedBytes(0);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) {
      void acceptFile(file);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (uploading) return;
    dragDepthRef.current += 1;
    setDragState(isLikelyPdfDrag(event.dataTransfer) ? "valid" : "invalid");
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (uploading) return;
    const valid = isLikelyPdfDrag(event.dataTransfer);
    event.dataTransfer.dropEffect = valid ? "copy" : "none";
    setDragState(valid ? "valid" : "invalid");
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragState("idle");
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragState("idle");
    if (uploading) return;

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    const pdfFile = files.find(isPdfCandidate) ?? files[0];
    void acceptFile(pdfFile);
  }

  function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const file = selectedFile ?? inputRef.current?.files?.[0];
    if (!file) {
      openPicker();
      return;
    }

    setUploadError(null);
    setPhase("uploading");
    setProgress(0);
    setUploadedBytes(0);

    const formData = new FormData();
    formData.set("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/uploads/pdf");
    xhr.responseType = "text";

    xhr.upload.onprogress = (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      const pct = Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100));
      setUploadedBytes(progressEvent.loaded);
      setProgress(pct);
      if (pct >= 100) {
        setPhase("processing");
      }
    };

    xhr.upload.onload = () => {
      setProgress(100);
      setUploadedBytes(file.size);
      setPhase("processing");
    };

    xhr.onload = () => {
      xhrRef.current = null;
      let result: { item?: { id?: string }; error?: string } | null = null;
      try {
        result = JSON.parse(xhr.responseText) as { item?: { id?: string }; error?: string };
      } catch {
        result = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && typeof result?.item?.id === "string") {
        setPhase("opening");
        window.location.assign(appHref({ item: result.item.id }));
        return;
      }

      setUploadError(result?.error || copy.pdfErrorUpload);
      setPhase("idle");
      setProgress(0);
      setUploadedBytes(0);
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setUploadError(copy.pdfErrorUpload);
      setPhase("idle");
      setProgress(0);
      setUploadedBytes(0);
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      setPhase("idle");
      setProgress(0);
      setUploadedBytes(0);
    };

    xhr.send(formData);
  }

  const dropClasses = [
    "pdfDrop",
    dragState === "valid" ? "isDragging" : "",
    dragState === "invalid" ? "isDragInvalid" : "",
    selectedFile ? "hasFile" : "",
    uploading ? "isUploading" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const phaseStatusText =
    phase === "opening"
      ? copy.pdfOpening
      : phase === "processing"
        ? copy.pdfProcessing
        : `${copy.pdfUploading} ${progress}%`;

  return (
    <form
      action="/api/uploads/pdf"
      method="post"
      encType="multipart/form-data"
      onSubmit={uploadPdf}
      className="sourceForm pdfUploadForm"
    >
      <label className="pdfSectionLabel" htmlFor="pdf-file">{copy.pdf}</label>

      <div
        className={dropClasses}
        onClick={() => {
          if (!selectedFile && !uploading) openPicker();
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="pdfCorner pdfCornerTl" aria-hidden="true" />
        <span className="pdfCorner pdfCornerTr" aria-hidden="true" />
        <span className="pdfCorner pdfCornerBl" aria-hidden="true" />
        <span className="pdfCorner pdfCornerBr" aria-hidden="true" />

        <input
          ref={inputRef}
          id="pdf-file"
          className="pdfFileInput"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          tabIndex={selectedFile ? -1 : 0}
          disabled={uploading}
          onChange={handleFileChange}
        />

        {!selectedFile || dragState !== "idle" ? (
          <div className="pdfDropEmpty">
            <PdfStageArtwork active={dragState === "valid"} invalid={dragState === "invalid"} />
            <div className="pdfDropCopy">
              <strong>
                {dragState === "valid"
                  ? copy.pdfDropActive
                  : dragState === "invalid"
                    ? copy.pdfDropInvalid
                    : copy.pdfDropTitle}
              </strong>
              <small>{copy.pdfDropSubtitle}</small>
            </div>
            {dragState === "idle" ? (
              <span className="pdfBrowsePill" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4M7 9l5-5 5 5M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
                </svg>
                {copy.pdfBrowse}
              </span>
            ) : null}
            <div className="pdfDropChips" aria-hidden="true">
              <span>PDF</span>
              <span>{copy.pdfLimitChip}</span>
              <span>{copy.pdfReaderChip}</span>
            </div>
          </div>
        ) : (
          <div className="pdfStagedStage">
            <div className="pdfFileCard">
              <PdfDocumentIcon />
              <div className="pdfFileMeta">
                <strong title={selectedFile.name}>{selectedFile.name}</strong>
                <div className="pdfFileStats">
                  <span>{formatBytes(selectedFile.size)}</span>
                  <span className={`pdfReadyBadge ${phase === "opening" ? "isDone" : ""}`}>
                    {uploading ? (phase === "opening" ? copy.pdfReady : `${progress}%`) : copy.pdfReady}
                  </span>
                </div>
              </div>
              {!uploading ? (
                <div className="pdfFileActions">
                  <button type="button" className="pdfReplaceButton" onClick={openPicker}>
                    {copy.pdfReplace}
                  </button>
                  <button
                    type="button"
                    className="pdfRemoveButton"
                    onClick={clearFile}
                    aria-label={copy.pdfRemove}
                    title={copy.pdfRemove}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              ) : phase === "uploading" ? (
                <button type="button" className="pdfReplaceButton" onClick={cancelUpload}>
                  {copy.pdfCancelUpload}
                </button>
              ) : null}
            </div>

            {uploading ? (
              <div className="pdfProgressBox" role="status" aria-live="polite">
                <div className="pdfProgressHeader">
                  <span>{phaseStatusText}</span>
                  <span>
                    {phase === "uploading"
                      ? `${formatBytes(uploadedBytes)} / ${formatBytes(selectedFile.size)}`
                      : `${progress}%`}
                  </span>
                </div>
                <div className={`pdfProgressTrack ${phase === "processing" ? "isProcessing" : ""}`}>
                  <div
                    className="pdfProgressFill"
                    style={{ width: `${Math.max(phase === "uploading" ? 4 : 100, progress)}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="pdfReplaceHint">{copy.pdfReplaceHint}</p>
            )}
          </div>
        )}
      </div>

      {uploadError ? <div className="sourceError" role="alert">{uploadError}</div> : null}

      <button type="submit" className="pdfSubmitButton" disabled={!selectedFile || uploading}>
        {uploading ? (
          <>
            <span className="pdfSubmitSpinner" aria-hidden="true" />
            {phaseStatusText}
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
            </svg>
            {copy.uploadPdf}
          </>
        )}
      </button>
    </form>
  );
}
