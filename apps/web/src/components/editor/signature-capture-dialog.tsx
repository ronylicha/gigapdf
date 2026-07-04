"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, PenLine, Type, Upload, Trash2, FileSignature } from "lucide-react";
import {
  fetchUserSignatures,
  type SignatureInsertPayload,
  type SignatureKind,
  type UserSignatureMark,
} from "./lib/user-signatures";

/** Which capture method the user is currently on. */
type CaptureTab = "draw" | "type" | "upload";

/** The payload produced by any of the three capture methods. */
interface CapturedSignature {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Everything one kind's pad owns. Signature and initials each keep a FULL
 * independent pad: switching kinds never resets the other pad's in-progress
 * drawing, typed text, upload or active method.
 */
interface PadState {
  tab: CaptureTab;
  typeText: string;
  upload: CapturedSignature | null;
  uploadError: string | null;
  hasInk: boolean;
}

const KINDS: readonly SignatureKind[] = ["signature", "initials"];

function emptyPad(): PadState {
  return {
    tab: "draw",
    typeText: "",
    upload: null,
    uploadError: null,
    hasInk: false,
  };
}

function emptyPads(): Record<SignatureKind, PadState> {
  return { signature: emptyPad(), initials: emptyPad() };
}

export interface SignatureCaptureDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the captured mark; the dialog closes right after. */
  onInsert: (sig: SignatureInsertPayload) => void;
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
 * The two kinds are TWO INDEPENDENT PADS: each keeps its own in-progress
 * drawing (both draw canvases stay mounted — the inactive one is only
 * CSS-hidden so its bitmap survives), its own typed text, its own upload and
 * its own active method. Toggling kinds never destroys the other pad.
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
  const [pads, setPads] = useState<Record<SignatureKind, PadState>>(emptyPads);

  const patchPad = useCallback(
    (k: SignatureKind, patch: Partial<PadState>) => {
      setPads((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));
    },
    [],
  );

  // Draw state — one full set per kind (the pads are independent).
  const canvasRefs = useRef<Record<SignatureKind, HTMLCanvasElement | null>>({
    signature: null,
    initials: null,
  });
  const ctxRefs = useRef<
    Record<SignatureKind, CanvasRenderingContext2D | null>
  >({ signature: null, initials: null });
  const strokeRefs = useRef<
    Record<SignatureKind, { drawing: boolean; points: { x: number; y: number }[] }>
  >({
    signature: { drawing: false, points: [] },
    initials: { drawing: false, points: [] },
  });
  // Whether a kind's backing store was sized for THIS dialog session. Init is
  // once-per-open-per-kind: re-running it would reset canvas.width and wipe
  // the ink, which is exactly what pad independence forbids.
  const drawInitRef = useRef<Record<SignatureKind, boolean>>({
    signature: false,
    initials: false,
  });

  // Persistence.
  const [saveToAccount, setSaveToAccount] = useState(false);
  const [saved, setSaved] = useState<UserSignatureMark[]>([]);

  const loadSaved = useCallback(async () => {
    setSaved(await fetchUserSignatures());
  }, []);

  // Reset BOTH pads each time the dialog opens (a fresh capture session).
  useEffect(() => {
    if (!open) return;
    setKind(defaultKind ?? "signature");
    setPads(emptyPads());
    strokeRefs.current = {
      signature: { drawing: false, points: [] },
      initials: { drawing: false, points: [] },
    };
    // Force a re-init of each draw surface on first visibility (sizing the
    // backing store clears any ink left over from a previous session).
    drawInitRef.current = { signature: false, initials: false };
    void loadSaved();
  }, [open, defaultKind, loadSaved]);

  // Initialise the ACTIVE kind's drawing canvas with a device-pixel-ratio-aware
  // backing store the first time its Draw tab becomes visible in this session.
  // Never re-runs for an already-initialised kind: switching kind (or method)
  // and coming back must find the ink exactly as it was left.
  useEffect(() => {
    if (!open || pads[kind].tab !== "draw") return;
    if (drawInitRef.current[kind]) return;
    const canvas = canvasRefs.current[kind];
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
    ctxRefs.current[kind] = ctx;
    drawInitRef.current[kind] = true;
  }, [open, kind, pads]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (
    k: SignatureKind,
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const ctx = ctxRefs.current[k];
    if (!ctx) return;
    // Optional chaining: setPointerCapture is absent in jsdom (same guard as
    // page-margin-overlay) — in browsers it keeps the stroke through fast
    // pointer moves that leave the canvas.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    strokeRefs.current[k] = { drawing: true, points: [pt] };
    // Emit a dot so a simple tap registers as ink.
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01);
    ctx.stroke();
    if (!pads[k].hasInk) patchPad(k, { hasInk: true });
  };

  const handlePointerMove = (
    k: SignatureKind,
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const st = strokeRefs.current[k];
    if (!st.drawing) return;
    const ctx = ctxRefs.current[k];
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

  const handlePointerUp = (k: SignatureKind) => {
    strokeRefs.current[k].drawing = false;
  };

  const clearDrawing = (k: SignatureKind) => {
    const canvas = canvasRefs.current[k];
    const ctx = ctxRefs.current[k];
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    strokeRefs.current[k] = { drawing: false, points: [] };
    patchPad(k, { hasInk: false });
  };

  /** Export a kind's drawn ink cropped to its bounding box, or null when empty. */
  const exportDrawing = (k: SignatureKind): CapturedSignature | null => {
    const canvas = canvasRefs.current[k];
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

  /** Render a kind's typed text to a transparent canvas sized to fit. */
  const exportTyped = (k: SignatureKind): CapturedSignature | null => {
    const text = pads[k].typeText.trim();
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
      patchPad(kind, { upload: null, uploadError: t("uploadTooLarge") });
      return;
    }
    // Capture the target kind NOW: the async reader callbacks must land on the
    // pad that received the file even if the user switches kinds meanwhile.
    const k = kind;
    patchPad(k, { uploadError: null });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      const img = new Image();
      img.onload = () => {
        patchPad(k, {
          upload: {
            dataUrl,
            width: img.naturalWidth || img.width || 300,
            height: img.naturalHeight || img.height || 150,
          },
        });
      };
      img.onerror = () => patchPad(k, { upload: null });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const buildCurrentSignature = (): CapturedSignature | null => {
    const pad = pads[kind];
    if (pad.tab === "draw") return exportDrawing(kind);
    if (pad.tab === "type") return exportTyped(kind);
    return pad.upload;
  };

  const activePad = pads[kind];
  const insertDisabled =
    activePad.tab === "draw"
      ? !activePad.hasInk
      : activePad.tab === "type"
        ? activePad.typeText.trim() === ""
        : activePad.upload === null || activePad.uploadError !== null;

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

  const handleInsertSaved = (sig: UserSignatureMark) => {
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

        {/* Kind toggle — two INDEPENDENT pads: switching never resets the
            other kind's in-progress drawing / text / upload / method. */}
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

        {/* Method tabs (per-kind: each pad remembers its own active method) */}
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
              aria-selected={activePad.tab === tabItem.value}
              onClick={() => patchPad(kind, { tab: tabItem.value })}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                activePad.tab === tabItem.value
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
          {/* Draw — BOTH kinds' canvases stay mounted so each keeps its ink;
              only the active kind's (when its pad is on Draw) is visible. */}
          {KINDS.map((k) => (
            <div
              key={k}
              data-testid={`signature-draw-pad-${k}`}
              className={
                kind === k && pads[k].tab === "draw" ? "space-y-2" : "hidden"
              }
            >
              <p className="text-xs text-muted-foreground">{t("drawHint")}</p>
              {/* Adaptive drawing height: shorter on small screens so the
                  dialog (kind toggle + tabs + footer) fits a 360×740 viewport
                  without clipping. The init effect sizes the DPR backing store
                  from clientWidth/clientHeight, and the ink-trim export crops
                  to the drawn bounding box — neither depends on a fixed size. */}
              <canvas
                ref={(el) => {
                  canvasRefs.current[k] = el;
                }}
                className="h-[160px] sm:h-[200px] w-full rounded-md border border-input bg-white touch-none cursor-crosshair"
                onPointerDown={(e) => handlePointerDown(k, e)}
                onPointerMove={(e) => handlePointerMove(k, e)}
                onPointerUp={() => handlePointerUp(k)}
                onPointerCancel={() => handlePointerUp(k)}
                onPointerLeave={() => handlePointerUp(k)}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => clearDrawing(k)}
                  disabled={!pads[k].hasInk}
                  className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50"
                >
                  {t("clear")}
                </button>
              </div>
            </div>
          ))}

          {/* Type */}
          {activePad.tab === "type" && (
            <div className="space-y-2">
              <input
                type="text"
                value={activePad.typeText}
                onChange={(e) => patchPad(kind, { typeText: e.target.value })}
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
                  {activePad.typeText.trim() || t("typePlaceholder")}
                </span>
              </div>
            </div>
          )}

          {/* Upload */}
          {activePad.tab === "upload" && (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                aria-label={t("tabUpload")}
                className="w-full text-sm text-foreground file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium file:text-foreground hover:file:bg-muted file:cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">{t("uploadHint")}</p>
              {activePad.uploadError && (
                <p className="text-xs text-destructive">
                  {activePad.uploadError}
                </p>
              )}
              {activePad.upload && (
                <div className="flex items-center justify-center rounded-md border border-input bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activePad.upload.dataUrl}
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
