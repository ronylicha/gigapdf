"use client";

import { useTranslations } from "next-intl";
import { History, Sparkles, Bug, Wrench, Zap, Package, Shield, Globe } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  changes: {
    type: "feature" | "fix" | "improvement" | "security";
    description: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.22.0",
    date: "2026-07-03",
    type: "minor",
    changes: [
      { type: "improvement", description: "The editor toolbar wraps onto multiple lines instead of running off-screen (its ~50 tools overflowed even on a laptop). On smaller screens the 17 document tools (merge, split, compress, OCR…) fold into a single 'Tools' menu — nothing removed, same behaviours." },
      { type: "feature", description: "The editor works on a phone: side panels (Pages, Properties, Forms, Document info) become slide-in drawers so the document gets the whole width; the header and footer compact themselves; dialogs fit the visible height with internal scrolling; a floating zoom pill (− % +) sits bottom-right at thumb reach, with a tap on the percentage cycling fit-width → fit-page → 100%." },
      { type: "feature", description: "Real touch editing: touch scrolling and panning work across the whole document (the canvas used to swallow every touch), pinch-to-zoom anchors under your fingers in both view modes, the Hand tool works with a finger, selection handles and form fields get larger touch targets, and hover-only actions are reachable on touch screens." },
    ],
  },
  {
    version: "1.21.0",
    date: "2026-07-03",
    type: "minor",
    changes: [
      { type: "feature", description: "Paragraph editing (Adobe-style): double-click a paragraph and edit it as ONE multi-line block — real wrapping, the document's own alignment (justified included) and inline bold/italic preserved as per-word styles. Leaving without a change restores the pixel-exact original rendering; edits rewrite only the touched lines in place, or reflow the paragraph within its frame. Powered by an engine fix aligning structural blocks with the editable runs (the actual root cause of the v1.19.2 'vanishing footer')." },
      { type: "feature", description: "Form filling reaches Adobe parity: an empty field occupies its whole box (visible border, clickable anywhere — in Fill & Sign one click puts the caret in the field); typed text respects alignment, multi-line wrapping, comb cells (one character per cell), auto-size and max-length, so values never overflow or overlap; Oui/Non checkbox pairs are mutually exclusive and 'Non' can actually be selected; clicking a signature widget fits your signature to its box." },
      { type: "fix", description: "Filling a field no longer duplicates it on save: the value is written into the existing AcroForm field and the engine regenerates a faithful appearance (comb, wrap, auto-size, alignment measured with the field's real font) — no more overlapping widgets or conflicting values in Adobe." },
      { type: "fix", description: "The document's original embedded fonts are ALWAYS used, even incomplete subsets: fonts are matched by the identity of the physical font program instead of by name (a dense CERFA shares 20 programs across 69 name variants), so accents no longer disappear or swap to a substitute face. Google/Helvetica only apply when a font truly isn't embedded (engine 0.114.0)." },
      { type: "fix", description: "Editing can no longer silently corrupt text: replacing a run's text now re-encodes through the exact inverse of the document's own decoding. On the reference CERFA, 527/527 identical-text replacements survive (was 140 — the rest came back empty or garbled) (engine 0.114.1)." },
    ],
  },
  {
    version: "1.20.0",
    date: "2026-07-02",
    type: "minor",
    changes: [
      { type: "feature", description: "Fill & Sign mode (Adobe-style): a new toolbar button puts the document in fill mode — form fields become clickable — so you can complete a form in place." },
      { type: "feature", description: "Insert a signature or initials from a capture dialog with three ways to create one: Draw (freehand, trimmed to the ink), Type (a handwriting font), or Upload an image. It drops onto the page as a movable, resizable stamp." },
      { type: "feature", description: "Save signatures to your account once: a saved signature or initials reappears in the dialog for one-click reuse on any future document, and can be deleted. Stored per user, isolated from other accounts, image validated and never logged." },
    ],
  },
  {
    version: "1.19.3",
    date: "2026-07-02",
    type: "patch",
    changes: [
      { type: "fix", description: "Editor: the document now fits the width of the canvas as soon as it opens, instead of showing small at 100% in a large empty area. A manual zoom still takes over from there." },
      { type: "fix", description: "Form fields: a field name can now contain spaces and accents (\"NAIS ENF 5\", \"Prénom\", \"Nom d'usage\"). The old validator wrongly rejected spaces — a PDF field name is a text string, so only a truly empty name is refused now." },
    ],
  },
  {
    version: "1.19.2",
    date: "2026-07-02",
    type: "patch",
    changes: [
      { type: "fix", description: "Editor: text no longer jumps out of place on dense forms (CERFA and the like). When the engine mis-grouped visually unrelated runs — a \"paragraph\" or table cell spanning the footer and the header — the editor folded them into one box and relocated their words: a footer legal line lost its middle, a header's \"VOLET 2\" slid to the top-left corner, small fragments floated below the line. A geometric-coherence gate now only folds a block when its runs form a genuine single column, so everything else renders exactly where it belongs (verified pixel-identical to the page image on both pages of a filled CERFA)." },
    ],
  },
  {
    version: "1.19.1",
    date: "2026-07-02",
    type: "patch",
    changes: [
      { type: "fix", description: "Editor: the last remaining overlaps in a justified legal footer are gone. Single-word runs sitting between justified words (\"'obtenir\", \"le versement\") are now fitted to their exact width like the rest of the line, so the whole footer reproduces the original word-for-word." },
    ],
  },
  {
    version: "1.19.0",
    date: "2026-07-01",
    type: "minor",
    changes: [
      { type: "fix", description: "Editor: justified legal small-print (a CERFA footer) now tiles word-for-word like the original. Each word is fitted to its exact width from the PDF, so the browser's slightly-wider fonts can no longer collapse the spaces between words (\"amende et/ou\" → \"amendeet/ou\") while the text stays editable (engine 0.112.0)" },
      { type: "fix", description: "Form fields: a field that repeats on more than one page — an official form's carbon copy — is now placed on ALL its pages. Fill it once on page 1 and the value appears on page 2, exactly as the PDF intends. Every radio button is placed with the correct checked state, and empty or unselected fields are placed too, at their exact size (engine 0.113.0)" },
    ],
  },
  {
    version: "1.18.0",
    date: "2026-07-01",
    type: "minor",
    changes: [
      { type: "fix", description: "Editor: justified small-print text (e.g. the legal footer of a CERFA form) no longer renders scrambled and overlapping. Runs whose glyphs are spread across the line are now painted fragment by fragment at their exact positions — computed the same way the page is rendered — so the text reads exactly as printed while staying editable (engine 0.111.0)" },
      { type: "fix", description: "Editor: multi-line intro paragraphs no longer drift downward and separate from the rest of the line. Line spacing is now taken from the document's real measurements instead of a fixed default, and irregularly-spaced blocks are shown line by line for a 1:1 match" },
    ],
  },
  {
    version: "1.17.2",
    date: "2026-06-30",
    type: "patch",
    changes: [
      { type: "fix", description: "Editor: form labels that use a repacked embedded subset font (e.g. the small-print labels in CERFA forms) no longer render as garbage — the embedded fonts now carry a correct character map rebuilt from the document's encoding, so the text shows as written (engine 0.110.4)" },
    ],
  },
  {
    version: "1.17.1",
    date: "2026-06-30",
    type: "patch",
    changes: [
      { type: "fix", description: "Editor: documents using a standard base font (e.g. Times-Bold, common in CERFA administrative forms) no longer show their static text with missing spaces and overlapping letters — the embedded fonts now carry the correct character widths (engine 0.110.3)" },
    ],
  },
  {
    version: "1.17.0",
    date: "2026-06-30",
    type: "minor",
    changes: [
      { type: "improvement", description: "OCR is faster and runs as an always-on engine (engine 0.110.2): scanned pages are now recognized by a dedicated service that loads its models once at startup instead of reloading them on every request — covering 14 writing systems (Latin, Cyrillic, Arabic, Hebrew, Simplified & Traditional Chinese, Japanese, Korean, Devanagari, Tamil, Telugu, Kannada) plus Latin handwriting, with automatic per-line script detection. Extract text, build a searchable PDF, or make a scan editable — all unchanged in how you use them" },
      { type: "improvement", description: "Editor: sharper on-screen text — the overlay now loads each document's own embedded fonts through the in-house engine (engine 0.110.2), so administrative forms (e.g. CERFA) and other subset fonts render exactly as in the source" },
    ],
  },
  {
    version: "1.16.0",
    date: "2026-06-30",
    type: "minor",
    changes: [
      { type: "feature", description: "TIFF images are now supported across the app (engine 0.109.0): convert a TIFF to PDF, insert one into a document, add a TIFF watermark, or import a TIFF into your library — alongside PNG, JPEG, GIF, WebP and AVIF" },
      { type: "improvement", description: "Editor: Replace image now accepts every supported raster — GIF, TIFF and AVIF on top of PNG, JPEG and WebP — to swap an image in place with any of them" },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-06-30",
    type: "minor",
    changes: [
      { type: "improvement", description: "Export to Office is far more faithful (engine 0.108.0): exporting a PDF to Word, PowerPoint or OpenDocument — from the editor and your document library — now produces a real flowing document with proper paragraphs, styled text, tables, multi-column layout, headers/footers and page margins recovered from the original, instead of fixed-position text boxes that clipped text mid-sentence" },
      { type: "improvement", description: "Office import is cleaner: Word and OpenDocument files now import with continuous styled text instead of every word becoming a separate fragment, making converted documents much easier to edit" },
      { type: "improvement", description: "PDF to Office export now carries over the document's metadata (title, author, subject, creation and modification dates)" },
    ],
  },
  {
    version: "1.14.1",
    date: "2026-06-27",
    type: "patch",
    changes: [
      { type: "fix", description: "Document library: the Download button and document Preview no longer fail with \"file not found\" — both now use an authenticated request instead of a direct URL" },
      { type: "fix", description: "Document library: the full-screen import dropzone now shows an upload progress bar and disappears when the upload finishes (no more leftover overlay needing a page reload)" },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-06-27",
    type: "minor",
    changes: [
      { type: "fix", description: "Editor: faithful overlay fonts — text inside form fields and page headers/footers no longer mixes fonts within a phrase or overlaps; runs use the document's embedded fonts with correct metrics (engine 0.106.0)" },
      { type: "improvement", description: "Editor: smoother editing in continuous view — editing or reordering an element re-renders only the affected page instead of every visible page" },
      { type: "feature", description: "Editor: header/footer and the Word-style page controls now work in single-page view too (parity with the continuous view)" },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-06-27",
    type: "minor",
    changes: [
      { type: "feature", description: "Editor: Word-style editable header & footer zones — place text and images directly on the page, with a contextual toolbar (insert image, page-number/date/title tokens, alignment, font and colour), a different first page and different odd/even pages, all saved with the PDF" },
      { type: "feature", description: "Editor: insert blank pages in multiple formats — A4, A3, Letter, Legal or custom, in portrait or landscape, from a Word-style Add page menu" },
      { type: "fix", description: "Editor: text no longer disappears behind background images — page layers now load in the correct stacking order" },
      { type: "fix", description: "Editor: bring forward / send backward no longer reloads the document or loses your edits — the change applies instantly" },
      { type: "fix", description: "Editor: Word-style margin rulers no longer blank the page; margins are saved with the document and never crop it" },
      { type: "fix", description: "Faithful text extraction (engine 0.105.0): subset fonts that repack glyphs (e.g. administrative forms like CERFA) no longer garble accented words and numbers" },
      { type: "improvement", description: "Editor: opening a document now shows a real progress bar with a page-flip animation instead of a spinner" },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-06-23",
    type: "minor",
    changes: [
      { type: "security", description: "Long-term signature validation (PAdES-B-LT): embed revocation data (OCSP/CRL) into a digital signature so it stays verifiable for years, even after the signing certificate expires" },
      { type: "feature", description: "Editor: native optional-content layers (OCG) — show and toggle a PDF's layers — plus a dedicated annotations panel and a document-language badge" },
      { type: "feature", description: "Document library: organize pages of a stored document (reorder, rotate, delete) from a visual grid, without opening the editor" },
      { type: "feature", description: "Document library: export a stored document to 12 formats and apply PDF→PDF transforms in place" },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-06-23",
    type: "minor",
    changes: [
      { type: "improvement", description: "Faithful document conversion (in-house engine 0.71.1): import Word, Excel, PowerPoint and OpenDocument (.docx, .xlsx, .pptx, .odt, .ods, .odp) keeping images, links, styles, formulas and tables; HTML to PDF with full CSS; images in WebP, AVIF, SVG and GIF; and OpenType text shaping" },
      { type: "feature", description: "Export to Markdown, CSV and EPUB — straight from the editor and your document library, alongside the existing Office and image formats" },
      { type: "feature", description: "Ten new conversion tools: PDF to ODS, ODP, HTML, RTF, text, Markdown, CSV and EPUB, plus CSV to PDF and Markdown to PDF" },
      { type: "feature", description: "Editor: edit the table of contents (outline) — add, rename, reorder and remove bookmarks, written back into the PDF" },
      { type: "feature", description: "Editor: automatic PII redaction — detect and truly remove personal data (emails, phone numbers…) from the page, not just mask it" },
      { type: "feature", description: "Editor: page resizing and new annotation types" },
      { type: "feature", description: "Document library: imported images and RTF files are converted automatically, and a one-click OCR action makes scans searchable" },
      { type: "feature", description: "Image watermarks — stamp a logo or picture across your pages, not just text, from both the watermark tool and the editor" },
      { type: "security", description: "Timestamped digital signatures (PAdES-B-T): add an eIDAS advanced electronic signature sealed with a trusted RFC 3161 timestamp, proving when a document was signed" },
      { type: "feature", description: "List-box form fields — build interactive PDF forms with multi-choice list boxes, alongside text fields, checkboxes, radios and dropdowns" },
      { type: "feature", description: "Word-style rulers with draggable margin guides in the single-page editor view" },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-06-21",
    type: "minor",
    changes: [
      { type: "improvement", description: "Live shape styling: change a vector shape's fill, stroke color, width or dash pattern and see it update instantly on the page — shapes are now real editable objects, never a stale picture" },
      { type: "feature", description: "Element transparency: set the opacity of any shape or image, baked into the PDF with no quality loss" },
      { type: "feature", description: "Stacking order is now written into the PDF itself, so the bring-to-front / send-to-back order is preserved when the file is reopened anywhere" },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-06-21",
    type: "minor",
    changes: [
      { type: "feature", description: "Edit every element of a PDF, not just text: images and vector shapes from the original file can now be selected, moved, resized, deleted and duplicated directly on the page — applied in place, with no re-compression of images or re-drawing of shapes" },
      { type: "feature", description: "Change vector shape styles — fill color, stroke color, stroke width and dash pattern — from the properties panel, baked back into the PDF" },
      { type: "feature", description: "Layers: organize page elements into named layers — create, rename, reorder, assign elements, and lock or hide a whole layer; layers and their membership now persist across sessions" },
      { type: "feature", description: "Stacking order: bring an element to front or send it to back from the toolbar or with Ctrl/Cmd+] and Ctrl/Cmd+[" },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-06-21",
    type: "minor",
    changes: [
      { type: "improvement", description: "Direct text editing: the editor now renders real, editable text instead of a flat image — each page is rasterized without its text and the real text is drawn on top in its embedded font and true color, so editing works over any background, gradients and patterns included" },
      { type: "improvement", description: "1:1 text fidelity even with broken embedded fonts: subset fonts with a missing or corrupt character map are repaired server-side, so the browser always renders the original glyphs" },
      { type: "improvement", description: "Full editing on every page of the continuous, Word-like view: the focused page is now a complete editor — create text and shapes, move, resize, retype, delete, undo/redo — while other pages stay fast read-only previews" },
      { type: "fix", description: "Text and form fields no longer appear duplicated when opening a document in the continuous editor" },
      { type: "fix", description: "Embedded-font loading no longer floods the server, fixing failed font loads on font-heavy documents" },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-06-21",
    type: "minor",
    changes: [
      { type: "feature", description: "Universal merge: combine any files — PDF, Word, Excel, PowerPoint, OpenDocument, images, HTML or text — into a single PDF; every file is converted automatically before merging" },
      { type: "feature", description: "Global command palette (Ctrl/Cmd+K): jump to any tool or page, or run a semantic search across your documents from anywhere" },
      { type: "feature", description: "Nine new tools, now 29 in total: universal merge, image to PDF, PDF to image, PDF to PowerPoint, PDF to Excel, RTF and PDF, text to PDF, redact PDF and unlock PDF" },
      { type: "feature", description: "New 'Features' mega-menu listing every tool by category, available on every page" },
      { type: "improvement", description: "Image to PDF now handles PNG (including transparency), JPEG, GIF, WebP and AVIF, with full color-depth and interlacing support" },
      { type: "improvement", description: "Unified header and footer across the whole marketing site" },
      { type: "fix", description: "The semantic search page (/search) no longer returns a 404" },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-18",
    type: "minor",
    changes: [
      { type: "improvement", description: "All PDF processing — rendering, thumbnails, redaction, compression, text extraction, search and conversions — now runs on the in-house Rust-to-WebAssembly engine, with no third-party PDF library" },
      { type: "feature", description: "New /engine page (French and English) presenting the in-house engine: real content editing, AcroForm forms, annotations, RC4/AES encryption, PKCS#7 digital signatures, Office conversions and OCR" },
      { type: "feature", description: "Dedicated /open-source page covering the license, the technology stack and how to contribute" },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-14",
    type: "minor",
    changes: [
      { type: "feature", description: "Every export format — PNG, JPEG, WebP, DOCX, XLSX, PPTX, ODT, ODP — is now selectable directly from the editor toolbar and the document library" },
      { type: "fix", description: "PDF-to-image export no longer returns an error: pages are rasterized correctly, including documents containing embedded images" },
      { type: "fix", description: "'Document not found' errors on rapid export bursts are resolved" },
      { type: "security", description: "All 76 open dependency security alerts cleared — critical and high-severity transitive dependencies patched" },
      { type: "improvement", description: "Continuous deployment: every change merged to the main branch is now automatically deployed to production once checks pass" },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-13",
    type: "minor",
    changes: [
      { type: "improvement", description: "The entire public site (landing, auth, legal and SEO pages) is now statically pre-rendered per language — faster page loads and fully crawlable HTML in French and English" },
      { type: "feature", description: "Expanded self-hosting documentation on /docs: step-by-step Docker and native install guide, plus links to the interactive Swagger and Redoc API references" },
      { type: "security", description: "Editor hyperlinks now open only http/https URLs with noopener and noreferrer — javascript: and data: URI injection through PDF links is blocked" },
      { type: "security", description: "The embeddable viewer now validates the parent page origin before responding to messages and returning the file" },
      { type: "fix", description: "Unknown or cross-language tool and solution URLs now return a real 404 instead of a soft 200" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-13",
    type: "minor",
    changes: [
      { type: "feature", description: "The public site is now available in English under /en/* — French stays the default with unchanged URLs" },
      { type: "feature", description: "32 new guide pages in French and English: 20 PDF tools (edit, merge, compress, sign, OCR…) and 10 professions, with localized URLs" },
      { type: "feature", description: "Redesigned home page with a 'print-shop editorial' look: crop marks, scroll ruler, numbered sections and subtle animations" },
      { type: "feature", description: "Pro canvas navigation: scroll naturally while zoomed, Ctrl+wheel zooms to your cursor, presets from 50% to 400%, Fit page / Fit width (Ctrl+0 / Ctrl+1), pan with Space or middle-click" },
      { type: "feature", description: "Pro form designer: multiline text, dates, radio groups and dropdowns with editable options; required fields, defaults and max length; Design/Fill modes with highlighting of existing fields; tab-order reordering and flattening after filling" },
      { type: "improvement", description: "Honest pricing: every feature on every plan, including free — you pay for volumes, not features" },
      { type: "fix", description: "Signing up with Google no longer fails with 'unable_to_create_user'" },
      { type: "fix", description: "Plan quotas are now consistent everywhere, and unlimited plans are truly unlimited" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-13",
    type: "minor",
    changes: [
      { type: "feature", description: "Trash: deleted documents can now be restored for 30 days before being permanently removed" },
      { type: "feature", description: "Tags on documents, with filtering and autocomplete from your existing tags" },
      { type: "feature", description: "Full-text search across document names and their content" },
      { type: "feature", description: "Real document thumbnails in your library, generated at upload and refreshed after editing" },
      { type: "feature", description: "Import Word, Excel, PowerPoint and OpenDocument files (.doc, .docx, .xls, .xlsx, .ppt, .pptx, .odt, .ods, .odp) — converted to PDF automatically" },
      { type: "feature", description: "Real-time collaboration: edits from other participants now appear live on the canvas" },
      { type: "feature", description: "Digital signature (PKCS#7) with your own P12/PFX certificate — processed in memory, never stored" },
      { type: "feature", description: "PDF compression with the space saved shown before you apply it" },
      { type: "feature", description: "Searchable PDF: OCR adds an invisible text layer to scanned documents so their text can be selected and searched" },
      { type: "feature", description: "Layers panel: show, hide and lock individual elements" },
      { type: "feature", description: "Multi-selection editing: change opacity, colors and alignment of several elements at once" },
      { type: "feature", description: "Export to ODT and ODP, alongside DOCX, XLSX and PPTX" },
      { type: "improvement", description: "Document duplication, folder renaming, parallel uploads (3 at a time) and an activity history on the document page" },
      { type: "fix", description: "Self-hosted: database migrations could be silently skipped on existing installs — fixed. Run 'alembic upgrade head' after updating" },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-06-12",
    type: "patch",
    changes: [
      { type: "fix", description: "Self-hosted: corrected the reference nginx configuration so every app API route works in production — Office conversion, health checks, the server-side Google Fonts proxy and the embed widget no longer return 404, and new Next.js API routes work without touching nginx" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-12",
    type: "minor",
    changes: [
      { type: "feature", description: "Faithful fonts: the editor identifies the PDF's fonts and downloads the matching Google Font on demand — through our server, never from your browser (GDPR-friendly). The font is embedded in the saved PDF." },
      { type: "feature", description: "Real text formatting in the editor: bold, italic, underline and alignment" },
      { type: "feature", description: "New text automatically uses the document's dominant font" },
      { type: "feature", description: "Watermark can now be applied to the whole document at once" },
      { type: "feature", description: "Share button directly in the editor" },
      { type: "feature", description: "Document detail page with preview, metadata, version history and one-click restore" },
      { type: "improvement", description: "Unified toast notifications across the app" },
      { type: "improvement", description: "Self-host Docker images now ship every PDF dependency out of the box (Office conversions, font fidelity, OCR, HTML to PDF)" },
      { type: "fix", description: "Folder deletion now works from the documents list view" },
      { type: "fix", description: "Added missing translations" },
    ],
  },
  {
    version: "1.0.0",
    date: "2025-01-15",
    type: "major",
    changes: [
      { type: "feature", description: "Initial public release" },
      { type: "feature", description: "WYSIWYG PDF editor with canvas-based editing" },
      { type: "feature", description: "Real-time collaboration via WebSocket" },
      { type: "feature", description: "REST API with OpenAPI documentation" },
      { type: "feature", description: "Multi-tenant organizations with shared quotas" },
      { type: "feature", description: "Stripe billing integration" },
      { type: "feature", description: "OCR text extraction" },
      { type: "feature", description: "Export to PNG, JPEG, DOCX, HTML" },
      { type: "feature", description: "S3-compatible storage (Scaleway, AWS, MinIO)" },
      { type: "security", description: "JWT RS256 authentication via BetterAuth" },
    ],
  },
  {
    version: "0.9.0",
    date: "2025-01-10",
    type: "minor",
    changes: [
      { type: "feature", description: "Document sharing via email invitations" },
      { type: "feature", description: "Public link sharing with expiration" },
      { type: "improvement", description: "Improved canvas rendering performance" },
      { type: "fix", description: "Fixed Safari canvas rendering issues" },
      { type: "fix", description: "Fixed memory leak in WebSocket connections" },
    ],
  },
  {
    version: "0.8.0",
    date: "2025-01-05",
    type: "minor",
    changes: [
      { type: "feature", description: "Folder organization for documents" },
      { type: "feature", description: "Drag and drop file upload" },
      { type: "feature", description: "Bulk document operations" },
      { type: "improvement", description: "Redesigned document explorer UI" },
      { type: "fix", description: "Fixed PDF merge ordering issue" },
    ],
  },
  {
    version: "0.7.0",
    date: "2024-12-28",
    type: "minor",
    changes: [
      { type: "feature", description: "Admin dashboard for system management" },
      { type: "feature", description: "User management and role assignment" },
      { type: "feature", description: "System health monitoring" },
      { type: "security", description: "Rate limiting and API quotas" },
    ],
  },
  {
    version: "0.6.0",
    date: "2024-12-20",
    type: "minor",
    changes: [
      { type: "feature", description: "Shape tools (rectangle, circle, arrow, line)" },
      { type: "feature", description: "Text annotations and comments" },
      { type: "feature", description: "Freehand drawing tool" },
      { type: "improvement", description: "Better touch support for mobile" },
    ],
  },
  {
    version: "0.5.0",
    date: "2024-12-15",
    type: "minor",
    changes: [
      { type: "feature", description: "Page operations (add, delete, reorder, rotate)" },
      { type: "feature", description: "Document merge and split" },
      { type: "feature", description: "Page thumbnail navigation" },
      { type: "fix", description: "Fixed page rotation persistence" },
    ],
  },
];

const typeConfig = {
  feature: { icon: Sparkles, color: "terminal-green", label: "New" },
  fix: { icon: Bug, color: "terminal-amber", label: "Fix" },
  improvement: { icon: Zap, color: "terminal-cyan", label: "Improved" },
  security: { icon: Shield, color: "terminal-purple", label: "Security" },
};

const versionTypeConfig = {
  major: { color: "primary", label: "Major Release" },
  minor: { color: "accent", label: "Minor Release" },
  patch: { color: "muted-foreground", label: "Patch" },
};

export default function ChangelogContent() {
  const t = useTranslations("legal.changelog");

  return (
    <div className="max-w-none">
      {/* Header */}
      <div className="mb-12 not-prose">
        <div className="inline-flex items-center gap-2 rounded-full border border-terminal-amber/30 bg-terminal-amber/5 px-4 py-1.5 text-sm mb-6">
          <History className="h-4 w-4 text-terminal-amber" />
          <span className="font-mono text-terminal-amber">changelog</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">{t("title")}</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          {t("description")}
        </p>
      </div>

      {/* Changelog entries */}
      <div className="space-y-12 not-prose">
        {changelog.map((entry, index) => (
          <article key={entry.version} className="relative">
            {/* Version header */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="flex items-center gap-2">
                <Package className={`h-5 w-5 text-${versionTypeConfig[entry.type].color}`} />
                <span className="font-mono text-2xl font-bold">v{entry.version}</span>
              </div>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full bg-${versionTypeConfig[entry.type].color}/10 text-${versionTypeConfig[entry.type].color}`}>
                {versionTypeConfig[entry.type].label}
              </span>
              <span className="text-sm text-muted-foreground font-mono">
                {entry.date}
              </span>
            </div>

            {/* Changes list */}
            <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
              {entry.changes.map((change, changeIndex) => {
                const config = typeConfig[change.type];
                const Icon = config.icon;
                return (
                  <div
                    key={changeIndex}
                    className={`flex items-start gap-4 p-4 ${
                      changeIndex !== entry.changes.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div className={`flex items-center gap-2 shrink-0 w-24`}>
                      <Icon className={`h-4 w-4 text-${config.color}`} />
                      <span className={`text-xs font-mono text-${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <span className="text-sm">{change.description}</span>
                  </div>
                );
              })}
            </div>

            {/* Connector line */}
            {index !== changelog.length - 1 && (
              <div className="absolute left-[11px] top-[60px] bottom-[-48px] w-px bg-border" />
            )}
          </article>
        ))}
      </div>

      {/* Subscribe section */}
      <section className="mt-16 rounded-xl border border-border bg-card/50 p-8 not-prose">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">{t("subscribe.title")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("subscribe.description")}
            </p>
            <a
              href="https://github.com/QrCommunication/gigapdf/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              {t("subscribe.link")}
              <Wrench className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
