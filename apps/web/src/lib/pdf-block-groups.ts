/**
 * Best-effort structural block grouping for parsed PDF pages.
 *
 * Attaches the native engine's `pageBlocks` grouping (paragraphs / headings /
 * tables / lists expressed as engine `source_index`es that map 1:1 onto the
 * parsed `TextElement.index`) onto each parsed page, so the editor coalesces
 * text runs from the lib — the source of structure — instead of falling back
 * to its much weaker positional heuristic.
 *
 * Shared by POST /api/pdf/parse-from-s3 (initial editor load) and
 * POST /api/pdf/parse (re-parse after every page operation: rotate,
 * apply-elements, watermark, forms, …). Both routes MUST attach the same
 * grouping — otherwise the first page operation of a session silently drops
 * the paragraph grouping for the rest of the session.
 *
 * Best-effort by contract: any failure leaves the pages WITHOUT `blockGroups`
 * (the editor degrades to its heuristic grouping) and never surfaces as an
 * HTTP error.
 */

import 'server-only';

import { extractPageBlockGroupsByPage } from '@giga-pdf/pdf-engine';
import type { PageBlockGroup } from '@giga-pdf/pdf-engine';
import { serverLogger } from '@/lib/server-logger';

/** Minimal structural shape of a parsed page (matches `PageObject`). */
interface BlockGroupPage {
  pageNumber: number;
  blockGroups?: PageBlockGroup[];
}

/**
 * Mutates `pages` in place, setting `page.blockGroups` for every page the
 * engine resolved at least one structural group for. Pages without groups are
 * left untouched (no empty arrays), keeping the response shape identical to
 * the pre-blockGroups behaviour for group-less pages.
 */
export async function attachPageBlockGroups(
  pages: BlockGroupPage[],
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  logPrefix: string,
  logContext: Record<string, unknown> = {},
): Promise<void> {
  try {
    const blockGroupsByPage = await extractPageBlockGroupsByPage(pdfBytes);
    if (blockGroupsByPage.size === 0) return;
    for (const page of pages) {
      const groups = blockGroupsByPage.get(page.pageNumber);
      if (groups && groups.length > 0) page.blockGroups = groups;
    }
  } catch (err) {
    serverLogger.warn(`${logPrefix} pageBlocks grouping failed — heuristic fallback`, {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
