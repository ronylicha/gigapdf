"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, PenLine, Type, Upload, Trash2, FileSignature } from "lucide-react";

/** Whether the mark is a full signature or a short set of initials. */
type SignatureKind = "signature" | "initials";

/** Which capture method the user is currently on. */
type CaptureTab = "draw" | "type" | "upload";

/** The payload produced by any of the three capture methods. */
interface CapturedSignature {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * A signature persisted to the caller's account.
 *
 * Mirrors the JSON shape returned by `/api/user/signatures` — kept local to
 * this component so the dialog stays self-contained.
 */
interface UserSignature {
  id: string;
  kind: SignatureKind;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface SignatureCaptureDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the captured mark; the dialog closes right after. */
  onInsert: (sig: {
    dataUrl: string;
    width: number;
    height: number;
    kind: SignatureKind;
  }) => void;
  /** Which kind to preselect when the dialog opens. Defaults to "signature". */
  defaultKind?: SignatureKind;
}

/** Handwriting-style font stack used to render typed signatures. */
const HANDWRITING_FONT =
  "'Segoe Script','Brush Script MT','Lucida Handwriting',cursive";

/** Route-aligned cap on uploaded image size (3 MB). */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Alpha threshold (0-255) above which a pixel counts as "ink". */
const INK_ALPHA_THRESHOLD = 10;

/**
 * SignatureCaptureDialog — an Adobe "Fill & Sign" style capture surface.
 *
 * The user picks a **kind** (signature / initials) and a **method**:
 *  - **Draw**   freehand ink on a DPR-aware canvas, exported trimmed to the
 *               ink bounding box.
 *  - **Type**   text rendered in a handwriting font, exported at its measured
 *               extent.
 *  - **Upload** a PNG/JPEG/SVG image, sized from its natural dimensions.
 *
 * Optionally the mark is persisted to the caller's account
 * (`/api/user/signatures`); previously-saved marks of the current kind are
 * listed as one-click inserts. Insertion is never blocked by a failed save.
 */
export function SignatureCaptureDialog({
  open,
  onClose,
  onInsert,
  defaultKind,
}: SignatureCaptureDialogProps): React.JSX.Element | null {
  const t = useTranslations("editor.signature");

  const [kind, setKind] = useState<SignatureKind>(defaultKind ?? "signature");
  const [tab, setTab] = useState<CaptureTab>("draw");

  // Draw state.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokeRef = useRef<{ drawing: boolean; points: { x: number; y: number }[] }>({
    drawing: false,
    points: [],
  });
  const [hasInk, setHasInk] = useState(false);

  // Type state.
  const [typeText, setTypeText] = useState("");

  // Upload state.
  const [upload, setUpload] = useState<CapturedSignature | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Persistence.
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [saved, setSaved] = useState<UserSignature[]>([]);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/user/signatures", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setSaved([]);
        return;
      }
      const data: unknown = await res.json();
      const list = (data as { signatures?: UserSignature[] } | null)?.signatures;
      setSaved(Array.isArray(list) ? list : []);
    } catch {
      // Tolerate any failure silently — the saved list is a convenience only.
      setSaved([]);
    }
  }, []);

  // Reset the volatile selections each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? "signature");
    setTab("draw");
    setTypeText("");
    setUpload(null);
    setUploadError(null);
    setHasInk(false);
    void loadSaved();
  }, [open, defaultKind, loadSaved]);

  // (Re)initialise the drawing canvas with a device-pixel-ratio-aware backing
  // store whenever the Draw tab becomes visible.
  useEffect(() => {
    if (!open || tab !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 500;
    const cssH = canvas.clientHeight || 200;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Draw in CSS pixels; the backing store is scaled for crispness.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";
    ctxRef.current = ctx;
    setHasInk(false);
  }, [open, tab]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = pointFromEvent(e);
    strokeRef.current = { drawing: true, points: [pt] };
    // Emit a dot so a simple tap registers as ink.
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01);
    ctx.stroke();
    setHasInk(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = strokeRef.current;
    if (!st.drawing) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pt = pointFromEvent(e);
    st.points.push(pt);
    const pts = st.points;
    const n = pts.length;
    if (n >= 3) {
      // Quadratic smoothing through the midpoints of consecutive segments.
      const p0 = pts[n - 3];
      const p1 = pts[n - 2];
      const p2 = pts[n - 1];
      if (!p0 || !p1 || !p2) return; // noUncheckedIndexedAccess: narrow before use
      const c1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const c2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, c2.x, c2.y);
      ctx.stroke();
    } else if (n >= 2) {
      // First segment (n === 2): a straight line between the two points.
      const a = pts[n - 2];
      const b = pts[n - 1];
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // n === 1 (single point so far): nothing to connect yet — the dot is painted
    // on pointer-down; a segment appears once the second point arrives.
  };

  const handlePointerUp = () => {
    strokeRef.current.drawing = false;
  };

  const clearDrawing = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    strokeRef.current = { drawing: false, points: [] };
    setHasInk(false);
  };

  /** Export the drawn ink cropped to its bounding box, or null when empty. */
  const exportDrawing = (): CapturedSignature | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const { width, height } = canvas;
    if (width === 0 || height === 0) return null;
    let data: ImageData;
    try {
      data = ctx.getImageData(0, 0, width, height);
    } catch {
      return null;
    }
    const px = data.data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Index is always in-bounds (px.length === width*height*4); `?? 0` only
        // satisfies noUncheckedIndexedAccess (0 is below the ink threshold).
        if ((px[(y * width + x) * 4 + 3] ?? 0) > INK_ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null;
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = cropW;
    out.height = cropH;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return { dataUrl: out.toDataURL("image/png"), width: cropW, height: cropH };
  };

  /** Render the typed text to a transparent canvas sized to fit. */
  const exportTyped = (): CapturedSignature | null => {
    const text = typeText.trim();
    if (!text) return null;
    const fontPx = 72;
    const pad = 16;
    const font = `${fontPx}px ${HANDWRITING_FONT}`;
    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    if (!mctx) return null;
    mctx.font = font;
    const metrics = mctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8;
    const descent = metrics.actualBoundingBoxDescent || fontPx * 0.3;
    const width = Math.max(1, Math.ceil(metrics.width) + pad * 2);
    const height = Math.max(1, Math.ceil(ascent + descent) + pad * 2);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.font = font;
    octx.textBaseline = "alphabetic";
    octx.fillStyle = "#000000";
    octx.fillText(text, pad, pad + ascent);
    return { dataUrl: out.toDataURL("image/png"), width, height };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUpload(null);
      setUploadError(t("uploadTooLarge"));
      return;
    }
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      const img = new Image();
      img.onload = () => {
        setUpload({
          dataUrl,
          width: img.naturalWidth || img.width || 300,
          height: img.naturalHeight || img.height || 150,
        });
      };
      img.onerror = () => setUpload(null);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const buildCurrentSignature = (): CapturedSignature | null => {
    if (tab === "draw") return exportDrawing();
    if (tab === "type") return exportTyped();
    return upload;
  };

  const insertDisabled =
    tab === "draw"
      ? !hasInk
      : tab === "type"
        ? typeText.trim() === ""
        : upload === null || uploadError !== null;

  const handleInsert = async () => {
    const sig = buildCurrentSignature();
    if (!sig) return;
    if (saveToAccount) {
      // Best-effort persist FIRST; a failure must never block insertion.
      try {
        await fetch("/api/user/signatures", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            dataUrl: sig.dataUrl,
            width: sig.width,
            height: sig.height,
          }),
        });
      } catch {
        // Ignore — the user still gets their signature inserted.
      }
    }
    onInsert({ ...sig, kind });
    onClose();
  };

  const handleInsertSaved = (sig: UserSignature) => {
    onInsert({
      dataUrl: sig.dataUrl,
      width: sig.width,
      height: sig.height,
      kind: sig.kind,
    });
    onClose();
  };

  const handleDeleteSaved = async (id: string) => {
    // Optimistically drop it from the list; tolerate a failed request.
    setSaved((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/user/signatures?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      // Ignore — a stale entry is harmless and refreshed on next open.
    }
  };

  if (!open) return null;

  const savedForKind = saved.filter((s) => s.kind === kind);

  const kinds: ReadonlyArray<{ value: SignatureKind; label: string }> = [
    { value: "signature", label: t("kindSignature") },
    { value: "initials", label: t("kindInitials") },
  ];

  const tabs: ReadonlyArray<{ value: CaptureTab; Icon: typeof PenLine; label: string }> =
    [
      { value: "draw", Icon: PenLine, label: t("tabDraw") },
      { value: "type", Icon: Type, label: t("tabType") },
      { value: "upload", Icon: Upload, label: t("tabUpload") },
    ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-capture-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <FileSignature size={18} className="text-muted-foreground" />
            <div>
              <h2
                id="signature-capture-title"
                className="text-lg font-semibold text-foreground"
              >
                {t("title")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Kind toggle */}
        <div
          role="group"
          aria-label={t("title")}
          className="mx-6 mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                kind === k.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Method tabs */}
        <div
          role="tablist"
          aria-label={t("title")}
          className="mx-6 mt-2 mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {tabs.map((tabItem) => (
            <button
              key={tabItem.value}
              type="button"
              role="tab"
              aria-selected={tab === tabItem.value}
              onClick={() => setTab(tabItem.value)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                tab === tabItem.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tabItem.Icon size={14} className="shrink-0" />
              {tabItem.label}
            </button>
          ))}
        </div>

        <div className="px-6 pb-6 pt-2 space-y-4">
          {/* Draw */}
          {tab === "draw" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("drawHint")}</p>
              {/* Adaptive drawing height: shorter on small screens so the
                  dialog (kind toggle + tabs + footer) fits a 360×740 viewport
                  without clipping. The init effect sizes the DPR backing store
                  from clientWidth/clientHeight, and the ink-trim export crops
                  to the drawn bounding box — neither depends on a fixed size. */}
              <canvas
                ref={canvasRef}
                className="h-[160px] sm:h-[200px] w-full rounded-md border border-input bg-white touch-none cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={clearDrawing}
                  disabled={!hasInk}
                  className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50"
                >
                  {t("clear")}
                </button>
              </div>
            </div>
          )}

          {/* Type */}
          {tab === "type" && (
            <div className="space-y-2">
              <input
                type="text"
                value={typeText}
                onChange={(e) => setTypeText(e.target.value)}
                placeholder={t("typePlaceholder")}
                aria-label={t("tabType")}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div
                className="flex items-center justify-center rounded-md border border-input bg-white px-4 py-6 text-black overflow-hidden"
                style={{ minHeight: 96 }}
                aria-hidden="true"
              >
                <span
                  className="truncate text-4xl leading-none text-black"
                  style={{ fontFamily: HANDWRITING_FONT }}
                >
                  {typeText.trim() || t("typePlaceholder")}
                </span>
              </div>
            </div>
          )}

          {/* Upload */}
          {tab === "upload" && (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                aria-label={t("tabUpload")}
                className="w-full text-sm text-foreground file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium file:text-foreground hover:file:bg-muted file:cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">{t("uploadHint")}</p>
              {uploadError && (
                <p className="text-xs text-destructive">{uploadError}</p>
              )}
              {upload && (
                <div className="flex items-center justify-center rounded-md border border-input bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={upload.dataUrl}
                    alt=""
                    className="max-h-40 max-w-full object-contain"
                  />
                </div>
              )}
            </div>
          )}

          {/* Save to account */}
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={saveToAccount}
              onChange={(e) => setSaveToAccount(e.target.checked)}
              className="accent-primary"
            />
            {t("saveToAccount")}
          </label>

          {/* Saved signatures */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t("savedTitle")}</p>
            {savedForKind.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("savedEmpty")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {savedForKind.map((sig) => (
                  <li
                    key={sig.id}
                    className="relative rounded-md border border-input bg-white p-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleInsertSaved(sig)}
                      className="block w-full"
                      aria-label={t("insert")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sig.dataUrl}
                        alt=""
                        className="h-14 w-full object-contain"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSaved(sig.id)}
                      aria-label={t("delete")}
                      className="absolute right-1 top-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={insertDisabled}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("insert")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
