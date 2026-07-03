/**
 * Font extraction API client for GigaPDF.
 * Consumes the backend endpoints:
 *   GET /api/pdf/fonts/:documentId          → list of embedded font metadata
 *   GET /api/pdf/fonts/:documentId/:fontId  → font binary as base64
 *
 * These endpoints are served by the Next.js API layer (Phase 2.1 backend agent).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single font found in a PDF document.
 * Returned by the /api/pdf/fonts/:documentId list endpoint.
 */
export interface ExtractedFontMetadata {
  /** Stable opaque identifier (sha256-prefix 16 chars) */
  fontId: string;
  /** Original internal PDF name, e.g. "ABCDEF+Calibri" */
  originalName: string;
  /** PostScript name if available, e.g. "Calibri-Bold" */
  postscriptName: string | null;
  /** Normalized font family, e.g. "Calibri" */
  fontFamily: string | null;
  /** PDF font subtype: Type0, Type1, TrueType, CIDFontType2, etc. */
  subtype: string;
  /** Whether the font program bytes are embedded in the PDF stream */
  isEmbedded: boolean;
  /** Whether this is a subset (original name has prefix like "ABCDEF+") */
  isSubset: boolean;
  /** Detected font format when embedded */
  format: 'ttf' | 'otf' | 'cff' | null;
  /** Approximate byte size of the embedded font program */
  sizeBytes: number | null;
  /**
   * Every `/BaseFont` alias wrapped around this physical program (the list is
   * one entry per program since the `embeddedFontsV2` backend). Optional —
   * absent on older payloads.
   */
  baseFonts?: string[];
}

/**
 * Font binary payload returned by the /api/pdf/fonts/:documentId/:fontId endpoint.
 */
export interface FontData {
  /** Must match fontId from metadata */
  fontId: string;
  /** Font program bytes, base64-encoded */
  dataBase64: string;
  /** Detected format */
  format: 'ttf' | 'otf' | 'cff';
  /** MIME type for use in FontFace source descriptor */
  mimeType: string;
  /** Original PDF internal name */
  originalName: string;
}

/**
 * Response wrapper produced by the Next.js API routes.
 */
interface FontApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleFontResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = (await response.json()) as FontApiResponse<unknown>;
      if (json.error) message = json.error;
    } catch {
      // ignore parse error — use status message
    }
    throw new Error(message);
  }
  const json = (await response.json()) as FontApiResponse<T>;
  if (!json.success) {
    throw new Error(json.error ?? 'Font API request failed');
  }
  return json.data as T;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const fontsService = {
  /**
   * Fetch the list of fonts embedded in a PDF document session.
   *
   * @param documentId - Session document ID (returned by /api/pdf/open)
   * @returns Array of font metadata for all fonts found in the document
   */
  list: async (documentId: string): Promise<{ fonts: ExtractedFontMetadata[] }> => {
    const response = await fetch(`/api/pdf/fonts/${encodeURIComponent(documentId)}`, {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
      },
    });
    return handleFontResponse<{ fonts: ExtractedFontMetadata[] }>(response);
  },

  /**
   * Fetch the binary data for a specific embedded font.
   * Only call this for fonts where `isEmbedded === true`.
   *
   * @param documentId - Session document ID
   * @param fontId     - Font identifier from ExtractedFontMetadata.fontId
   * @returns Font binary data as base64, with format and MIME type
   */
  getData: async (documentId: string, fontId: string): Promise<FontData> => {
    const response = await fetch(
      `/api/pdf/fonts/${encodeURIComponent(documentId)}/${encodeURIComponent(fontId)}`,
      {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          Accept: 'application/json',
        },
      },
    );
    return handleFontResponse<FontData>(response);
  },
};

// Re-export types for package consumers
export type { FontApiResponse };
