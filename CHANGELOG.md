# Changelog

All notable changes to GigaPDF are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.25.0] - 2026-07-04

### Added — real-time collaboration

- **Share a document by email.** People who already have an account get
  instant access; others receive an invitation link and land on an acceptance
  page. Invited collaborators with edit permission can save.
- **Live presence.** See who else has the document open, and watch their
  cursors and element edits appear in real time (the socket is now
  authenticated and every collaborator joins the same shared room).
- **Notifications bell** in the dashboard header surfaces shares and
  invitations, with unread counts and one-click mark-as-read.
- **Public read-only link** (`/public/<token>`) opens a document in a viewer
  without an account; `noindex`, token never logged.

### Changed — paragraph recognition

- Opening a Word or PDF document no longer produces dozens of tiny
  disconnected text boxes: related lines are grouped into editable blocks (a
  27-page business plan dropped from 308 fragments to 197). A single click
  selects the whole block, a second click drills into an individual run, and
  the grouping now survives every page operation (it was previously lost on
  the first re-parse). Table cells are banded into visual lines so a
  "Label: value" cell is one editable unit.

### Added — document library file-type icons

- Each document shows a coloured icon for its type (PDF, Word, Excel,
  PowerPoint, image, archive, EPUB, Markdown, JSON, …) across the grid, list,
  trash, shared, and detail views.

### Changed — Fill & Sign

- Signature and initials are now two fully independent capture pads (drawing
  on one no longer affects the other), each reachable directly from the
  toolbar with one-click reuse of a saved mark. Every placed signature is
  immediately selectable, movable and resizable on the page; a signed widget
  no longer re-opens the capture dialog.

### Changed — conversion fidelity (engine 0.117.0)

- Roughly seventy two-way fidelity fixes across every supported format and the
  HTML/CSS engine. Highlights: Word tables keep their borders and theme fonts;
  bullet and numbered lists round-trip; Excel exports are typed; right-to-left
  text, footnotes, chart data labels, slide backgrounds, frozen panes, tab
  stops and rotation are preserved; `modelToPdf` and legacy `.doc/.xls/.ppt`
  render images and full Unicode; and the HTML→PDF engine gained `var()`,
  generated content, `@page`, `calc()`, stacking contexts, multi-column,
  `writing-mode`, and more. Full detail in the engine's own changelog.

## [1.24.0] - 2026-07-03

### Fixed — exports keep their images and layout in every format (engine 0.116.0)

- **HTML, RTF, EPUB and Markdown exports carry their images again.** A
  serialization bug rounded the internal image identifiers in the export
  bridge (JavaScript cannot represent 64-bit integers), so every image was
  silently dropped — a pitch deck went from 0 to 37 images in HTML, RTF and
  EPUB exports.
- **Excel and ODS exports moved onto the faithful path**: typed tables with
  merged cells, bold header rows and shading — and no more missing text
  (names, dates and reference numbers were measurably lost by the old
  glyph-grid conversion). PDFs without spreadsheet content get one clean
  worksheet per page in reading order.
- Fixed a switchover port-pairing bug in the blue/green deployment that could
  serve editor API errors (502) for a short window around a deploy — the
  services of each color now pair with each other explicitly, verified live
  with a double switchover under continuous probing (zero errors).

### Added — a compact mobile toolbar (the document gets the screen back)

- On a phone, the editor chrome went from **~50 % of the screen to ~22 %**:
  the toolbar becomes a single compact row (undo/redo, select, text, hand,
  Fill & Sign) plus a **Tools button** opening a bottom sheet organised in
  clear sections (Edit, Colours, Insert, Annotate, Forms, Document, View) —
  every tool from the desktop toolbar, same behaviour, thumb-sized targets.
  The desktop layout is unchanged.

## [1.23.0] - 2026-07-03

### Fixed — conversion fidelity, both directions (engine 0.115.0)

- **Word bullet lists show their bullets** — and more broadly, the text layer
  of every Office-converted document no longer garbles bullets, accents, € or
  dashes (a font table bug declared `•` as `¥` in the extracted text of ALL
  converted documents). Numbered lists keep their real format (`1.` vs `a)`),
  start values and nesting, in imports AND exports.
- **Exports to formats other than PDF keep their formatting** — exported Word
  files open in Word/LibreOffice again (they were refused whenever a header
  contained a line), margins are sane, a one-column letter no longer comes out
  as two columns, images land at their exact position instead of inline at a
  default size, page numbers become live fields, and PowerPoint exports carry
  positioned images and shapes instead of empty slides.
- **Real-world files open at all**: documents saved with streaming zip
  archives (many real Word/Excel/PowerPoint files, and every LibreOffice
  ODT/ODP) previously imported as empty; presentations now paginate one slide
  per page (an 11-slide deck no longer collapses onto one unreadable page)
  with their images and true 16:9 geometry.
- **Opening a Word file looks like Word**: strikethrough, highlight,
  superscript/subscript now render; tables get their cell shading, real
  borders and merged cells; headers and footers repeat on every page with
  live page numbers; two-column sections render in two columns.

### Fixed — file upload: live progress and reliable completion

- **The progress bar actually moves** during upload: progress is now measured
  in bytes sent (per file and cumulative across a batch), not per completed
  file — a single large file no longer sits at 0 % until the end.
- **The import dialog and full-screen overlay always close**: post-upload
  enrichment steps are time-boxed, every path (success, error, cancel) resets
  the UI, failures are listed inline with a retry hint instead of locking the
  dialog, and a working **Cancel** button aborts the batch.

### Added — zero-downtime deployments (infrastructure)

- Deploys now build in a separate release while the site keeps serving, then
  switch atomically (blue/green with health gates and instant rollback).
  Measured during the migration itself: 970/970 requests answered 200 —
  the brief maintenance flashes some users saw during deploys are gone.

## [1.22.0] - 2026-07-03

### Added — the editor works on a phone

- **The toolbar wraps onto multiple lines instead of running off-screen.** Its
  ~50 tools used to sit on one ~1,800 px row that overflowed even on a laptop;
  it now wraps (2 lines on desktop, ~3 on a phone), and on smaller screens the
  17 document tools (merge, split, compress, OCR…) fold into a single "Tools"
  menu — nothing was removed, every tool keeps its exact behaviour.
- **The side panels become slide-in drawers on mobile.** Pages, Properties,
  Document info and Forms used to claim 700+ fixed pixels, leaving no room for
  the document below ~900 px. They are now hidden on small screens and open as
  touch-friendly drawers; the canvas gets the whole width, with the fit-to-width
  zoom recomputed as the layout changes. The header and footer compact
  themselves too.
- **Real touch editing.** Touch scrolling and panning now work across the whole
  document (the canvas used to swallow every touch), **pinch-to-zoom** zooms the
  document anchored under your fingers in both view modes, the Hand tool works
  with a finger, selection handles and form fields get larger touch targets,
  menus close on tap, and hover-only actions (page thumbnails, content-edit
  zones) are reachable on touch screens.
- **Dialogs fit small screens** — capped to the visible height with internal
  scrolling and safe margins (the signature capture pad adapts too) — and a
  **floating zoom pill** (−  %  +) sits bottom-right on mobile, thumb-reach,
  with a tap on the percentage cycling fit-width → fit-page → 100 %.

## [1.21.0] - 2026-07-03

### Added — edit whole paragraphs, like Adobe (engine 0.114.x)

- **Double-click a paragraph and edit it as one block.** Instead of hundreds of
  tiny independent text boxes, the runs of a paragraph are now linked: entering
  edit mode swaps them for a single multi-line box — real line wrapping, the
  document's own alignment (justified included) and per-word styles (inline
  bold/italic keep their look) — and leaving without a change restores the
  pixel-exact per-run rendering untouched.
- **Edits write back surgically.** Changing a line rewrites just that line's
  source runs in place; adding or removing lines reflows the paragraph within
  its original frame. On a plain administrative letter, the body paragraphs
  went from 0 to 6/6 editable as blocks — including a 10-line justified one.
- This is powered by an engine fix: the structural blocks and the editable text
  runs now share the same index space (images and shapes no longer shift the
  mapping — the actual root cause of the v1.19.2 "vanishing footer" incident),
  and the engine's paragraph reconstruction is geometrically hardened so a
  footer and a header can never fuse into one "paragraph" again.

### Added — form filling reaches Adobe parity

- **An empty field now occupies its whole allotted box**: visible background and
  border, clickable anywhere inside — and in Fill & Sign mode a **single click
  puts the caret in the field** so you just type.
- **What you type respects the field's format**: alignment (left/centre/right),
  multi-line fields wrap inside their box, comb fields (one character per cell —
  social-security numbers, dates) lay out cell by cell, auto-size fields shrink
  to fit, and a max-length is enforced while typing. Long values no longer
  overflow or overlap the neighbouring content.
- **Filling no longer duplicates fields.** A filled field used to be re-created
  on save (two overlapping widgets, format lost, values in conflict in Adobe).
  The value is now written into the existing AcroForm field and the engine
  regenerates its appearance faithfully (comb cells, wrapping, auto-size,
  alignment measured with the field's real font).
- **Yes/No checkbox pairs work**: official forms often model "Oui/Non" as one
  checkbox with two named states — checking one now unchecks the other, on
  every page it appears, and "Non" can actually be selected.
- **Sign inside a signature field**: in Fill & Sign, clicking a signature widget
  opens the capture dialog and fits your signature to the field's box.

### Fixed — the document's original fonts are always used

- **The editor now always serves each run's original embedded font — even when
  the subset is incomplete.** Fonts are matched by the identity of the physical
  font program instead of by name: a dense CERFA shares 20 real font programs
  across 69 name variants, each declaring only a few characters; the old
  name-based match picked the wrong variant and dropped the accents (à/â/é/ê/è
  showed as tofu or a substituted face). Coverage is no longer a reason to
  reject a present font — Google/Helvetica fallbacks only apply when a font
  truly isn't embedded.
- **Editing can no longer corrupt text silently** (engine 0.114.1): replacing a
  run's text re-encodes through the exact inverse of how the document decodes
  it. On the reference CERFA, 527/527 identical-text replacements now survive
  (it was 140 — the rest came back empty or garbled, the root cause of the
  historical "tangled text" incidents on saved CERFAs).

### Added — "Fill & Sign" mode with reusable signatures (Adobe-style)

- **A new "Fill & Sign" toolbar button** puts the document in fill mode — the form
  fields become clickable and the forms panel switches to filling — so you can
  complete a form without leaving the page.
- **Insert a signature or initials** from a capture dialog offering three ways to
  create one, exactly like Adobe: **Draw** (freehand, trimmed to the ink),
  **Type** (a handwriting font), or **Upload** an image. The signature drops onto
  the page as a movable, resizable stamp.
- **Save signatures to your account, once.** A "Save to my account" option stores
  the signature (or initials) so it appears in the dialog for one-click reuse on
  any future document; each saved item can be deleted. Stored per user, isolated
  from other accounts.
- All saved-signature endpoints authenticate the caller and are ownership-scoped
  (you can only ever see or delete your own). The image is validated (raster PNG/
  JPEG/WebP, size-capped) and never logged.

## [1.19.3] - 2026-07-02

### Fixed — document fills the canvas on open; form-field names accept spaces

- **The page now fits the width of the editor as soon as a document opens**, instead
  of showing at 100 % (a small A4 sheet floating in a large empty canvas). The
  continuous view computes the exact fit-to-width zoom from its live width; a manual
  zoom still takes over from there.
- **A form field can be named with spaces (and accents).** The name validator wrongly
  rejected `NAIS ENF 5`, `Prénom`, `Nom d'usage`… — a PDF field name is a text
  string, so spaces and punctuation are valid. Only a truly empty name is refused now.

## [1.19.2] - 2026-07-02

### Fixed — no more vanishing footer lines or misplaced headers on dense forms

- **Text no longer jumps out of place on complex forms (CERFA and the like).** The
  editor coalesces the engine's paragraphs, headings, table cells and list items
  into Word-style editable blocks — but on dense administrative layouts the engine's
  structural reconstruction sometimes groups runs that are visually unrelated (a
  "paragraph" or "table cell" spanning the footer AND the header). Folding those into
  one text box relocated their words: a footer legal line lost its middle
  ("La loi rend passible d'… des avantages indus" with the whole clause missing),
  a header banner's "VOLET 2" slid to the top-left corner, small fragments floated
  below their line.
- A **geometric-coherence gate** now guards every coalesced block: a block is only
  folded into one editable box when its runs form a genuine single column — one run
  per line, line-contiguous, left-aligned, and never a justified (per-word
  positioned) run. Anything the engine mis-grouped falls back to rendering each run
  at its exact position, which is pixel-identical to the page image. Verified
  against the engine's own rasterizer on both pages of a filled CERFA form: footer
  and header now reproduce the original exactly.

### Fixed — the last legal-footer overlaps (plain runs interleaved in a justified line)

- A justified line's **plain single-word runs** (a footer's `'obtenir`, `le
  versement`, `et de`) were still drawn at the browser's hmtx advance — a hair wider
  than the PDF `/Widths` — so they overflowed and overlapped the neighbouring words.
  They are now fitted to their exact `/Widths` box like the positioned segments, so
  the whole footer reproduces the original word-for-word (verified pixel-identical
  against the engine's rasterizer).

## [1.19.0] - 2026-07-01

### Fixed — legal small-print now reproduces the original exactly

- **Justified small print (the legal footer of a CERFA form) tiles word-for-word
  like the source.** Each word is fitted to its exact PDF advance (`/Widths`), so
  the browser's slightly-wider font metrics can no longer eat the inter-word
  spaces ("amende et/ou" → "amendeet/ou"). Consumes `gigapdf-lib` 0.112.0 (per-word
  positioned segments) plus a per-word width fit in the editable overlay.

### Fixed — every form-field widget is placed (duplicate pages + radio buttons)

- **A form field that appears on more than one page (an official form's carbon
  copy) is now shown on ALL its pages.** Fill it once on page 1 and the value
  appears on page 2, as the PDF intends — previously only the field's first widget
  was placed, so page-2 copies were missing entirely.
- **Radio groups place every button** with the correct checked state (a button is
  ticked only when the field's value equals its own on-state), not just the first.
- **Empty and unselected fields are placed too**, at their exact `/Rect` size — so
  the whole form is editable, not only the pre-filled boxes.
- Consumes `gigapdf-lib` 0.113.0 (`FieldInfo.widgets` — every widget placement).

## [1.18.0] - 2026-07-01

### Fixed — 1:1 editor fidelity for justified & multi-line PDF text (CERFA forms)

- **Justified / per-glyph-positioned runs (a legal footer, a spread-out table
  cell) no longer render as scrambled, overlapping text** ("peuveht fabjet",
  "finanlolère", "oudbtenir") in the editor. Such a run is drawn as ONE `Tj`/`TJ`
  but spreads its glyphs with internal `TJ` position jumps, which a single
  editable box cannot reproduce — the fragments piled up. The engine
  (gigapdf-lib 0.111.0) now returns each run's **positioned fragments**
  (`TextElementInfo.segments`), each computed from the **same pen walk the
  rasterizer uses** (real glyph widths + `Tc`/`Tw`/`Tz` + `TJ` kerns), and the
  editor paints one text box per fragment — 1:1 with the page. Every fragment
  shares the run's identity, so selecting/moving/deleting still targets the whole
  run. The CERFA legal footer now reads exactly as printed ("peuvent faire
  l'objet d'une pénalité financière en application de l'article L. 114-17-1 du
  Code de la sécurité sociale").
- **Multi-line intro paragraphs no longer drift and separate.** A coalesced
  paragraph rendered with Word's hardcoded 1.2 line height over-spaced tight PDF
  text (a 10 pt body at ~10.5 pt advance), so the folded lines drifted away from
  their same-line runs ("texte emmêlé en haut"). The editor now derives a
  coalesced block's line spacing from the runs' **measured** advance, and blocks
  with a non-uniform advance render per-run (1:1) instead of reflowing — Word-like
  editing is kept for genuinely uniform paragraphs.

## [1.17.2] - 2026-06-30

### Fixed — editor text fidelity for repacked subset fonts (gigapdf-lib 0.110.4)

- **Form labels that used a repacked embedded subset font (e.g. the "Nom et
  adresse de l'organisme d'assurance maladie…" labels in CERFA forms) no longer
  render as garbage** ("Nç ê Dçê D ê") in the editor. The embedded font served to
  the overlay now carries a correct character map rebuilt from the document's
  authoritative encoding, so the text renders as written. The PDF itself was
  always correct. (A few rare non-é accents may still fall back; ASCII and é are
  faithful.)

## [1.17.1] - 2026-06-30

### Fixed — editor text fidelity for standard CFF base fonts (gigapdf-lib 0.110.3)

- **Documents using a CFF/Type1 subset of a standard base font (e.g. `Times-Bold`,
  as in many CERFA administrative forms) no longer render their static text with
  collapsed spaces and overlapping letters in the editor** ("DEMANDEDERATTACHEMENT…").
  The embedded font served to the editor overlay now carries the correct advance
  widths (read from the CFF `nominalWidthX`/`defaultWidthX`), so words are spaced
  and glyphs sit correctly. Introduced with the 1.17.0 engine-served fonts; the
  PDF rendering itself was always correct.

## [1.17.0] - 2026-06-30

### Changed — OCR re-architected to a host-side engine (gigapdf-lib 0.110.2)

- **OCR recognition moved from the in-browser WASM recognizer to a native,
  always-on host-side service** (`gigapdf-ocr-rten` — PaddleOCR PP-OCR on RTen, a
  pure-Rust ONNX runtime). gigapdf-lib 0.110.x removed the client WASM recognizer
  (`.gpocr` models, the `doc.ocr()` API); the app now renders each page on the
  server and sends it to a persistent OCR microservice (`gigapdf-ocr` systemd
  unit) that loads its models **once at boot** and answers over a local HTTP
  endpoint — so OCR no longer pays a multi-hundred-MB model load per request.
- **14 recognizers**: Latin, Cyrillic, Arabic, Hebrew, Simplified & Traditional
  Chinese, Japanese, Korean, Devanagari, Tamil, Telugu, Kannada/Georgian, plus
  Latin handwriting — with automatic per-line script selection.
- The editor/GED OCR dialogs, the three modes (extract text / searchable PDF /
  editable PDF) and the `/api/pdf/ocr(+page)` contracts are **unchanged in shape**;
  only the recognition backend moved. PDF rasterization + invisible/visible
  text-layer baking stay in TypeScript via gigapdf-lib 0.110.2.

### Changed — editor embedded fonts served by the engine (no external font tooling)

- **The editor overlay now serves each PDF's own embedded fonts through the
  in-house engine** (`extractWebFont`, gigapdf-lib 0.110.2): CFF/Type1 are wrapped
  to a browser-loadable OpenType with a synthesized cmap, TrueType is repaired
  in place, and the original glyphs are kept — so administrative forms (e.g.
  CERFA) and other subset fonts render on-screen exactly as in the source. This
  replaces the previous Python (pikepdf/fontTools) font-extraction backend.

### Removed
- The `gigapdf-lib-ocr` npm alias (the last version carrying the in-browser WASM
  recognizer) and the `.gpocr` model bundling / Next.js file-tracing.
- The server-side Python font-extraction service and its `/api/v1/fonts`
  endpoint (superseded by the engine-backed `/api/pdf/fonts` path above).

## [1.16.0] - 2026-06-30

### Added
- **TIFF image support across the app (gigapdf-lib 0.109.0).** Convert a TIFF to
  PDF, insert one into a document (editor), stamp a TIFF watermark, and import a
  TIFF into the document library — joining PNG, JPEG, GIF, WebP and AVIF. Format
  guards (magic bytes + `accept`) were widened in the image→PDF / convert / merge
  routes, the editor image-renderer (decoding delegated to the engine), the GED
  import routing, the watermark pickers, and the dashboard tool.

### Improved
- **Editor "Replace image" now accepts every supported raster** — GIF, TIFF and
  AVIF in addition to PNG, JPEG and WebP. `replaceImage` shares the `addImage`
  decode path, documented as such since engine 0.109.1.

### Changed
- Bump **gigapdf-lib 0.108.0 → 0.109.1** (image-pipeline completeness + conversion
  fidelity; image-format documentation corrected). Fixed the corrupt 1×1 PNG test
  fixtures (invalid IDAT CRC + Adler32) shared by five pdf-engine test files — the
  package test baseline is now fully green.

## [1.15.0] - 2026-06-30

### Improved
- **PDF → Office export now produces real flowing documents (engine 0.108.0).**
  Exporting a PDF to Word, PowerPoint or OpenDocument (`.docx`, `.pptx`, `.odt`,
  `.odp`) — from both the editor and the document library — now routes through the
  reconstructed semantic model. The result is genuine flowing `<w:p>` paragraphs
  with styled runs, real `<w:tbl>` tables, list numbering, multi-column section
  layout, page margins estimated from the content and real headers/footers,
  instead of fixed-position VML text boxes whose text was clipped mid-sentence.
  Adjacent glyph fragments (one per embedded-font subset) are coalesced into clean
  contiguous styled runs, and a paragraph that overflows from the bottom of one
  page to the top of the next is stitched back into a single block.
- **Office import is cleaner.** Word and OpenDocument documents (`.docx`/`.odt`)
  now import with adjacent visually-identical runs merged into single runs, so a
  converted file no longer has every word as a separate fragment — much easier to
  edit and free of spurious font inconsistencies.
- **Document metadata carried over on export.** The source PDF's title, author,
  subject and creation/modification dates now flow into the exported Office file's
  document properties (`docProps/core.xml`, `docProps/app.xml`).

## [1.14.1] - 2026-06-27

### Fixed
- **Document library — Download & Preview no longer fail with "file not found".**
  The Download button and the document Preview used a direct URL that couldn't
  carry the auth token (404 under an owned session); both now fetch the document
  through an authenticated request, like Export.
- **Document library — import dropzone now shows progress and dismisses itself.**
  The full-screen drag-and-drop import overlay now displays an upload progress
  bar and disappears automatically when the upload finishes (it previously stayed
  on screen until a page reload).

## [1.14.0] - 2026-06-27

### Fixed
- **Editor — faithful overlay fonts.** Text inside form fields and page
  headers/footers (drawn via form XObjects) no longer mixes fonts within a single
  phrase nor overlaps: each run is now styled against its own font scope and
  rendered with the document's embedded font with correct metrics (engine
  0.106.0), plus a bounded width guard for runs whose font hasn't loaded yet.

### Changed
- **Editor — smoother editing in continuous view.** Editing, moving or reordering
  an element now re-renders only the affected page instead of re-rasterising every
  visible page.

### Added
- **Editor — header/footer parity in single-page view.** The Word-style header &
  footer zones (and the page controls) now work in single-page view too, matching
  the continuous view.

## [1.13.0] - 2026-06-27

### Fixed
- **Editor — text no longer hidden behind background images.** Page layers now
  load in the correct stacking order, so text on slides/decks is visible and
  editable instead of being covered by a full-page background.
- **Editor — bring forward / send backward no longer reloads the document.** The
  z-order change is applied live without re-rasterising the whole document, so
  the current selection and in-progress edits are preserved (no flash, no lost
  work).
- **Editor — Word-style margin rulers no longer blank the page.** Dragging a
  margin guide updates the content area only; margins are saved with the document
  (editor metadata) and never crop the page.
- **Faithful text extraction (engine 0.105.0).** Subset fonts that repack glyphs
  onto punctuation codes via `/Encoding`+`/Differences` (common in administrative
  forms, e.g. CERFA) no longer garble accented words and numbers — e.g. "parents"
  and "2016" instead of "&are%ts" and "2!!".

### Added
- **Editor — Word-style editable header & footer zones.** Place text *and images*
  directly in visible header/footer bands on the page, with a contextual toolbar
  (insert image, page-number/date/title tokens, alignment, font and colour). A
  different first page and different odd/even pages are supported, and the
  definition travels with the PDF.
- **Editor — insert blank pages in multiple formats.** Add a page in A4, A3,
  Letter, Legal or a custom size, in portrait or landscape, from a Word-style
  "Add page" menu.

### Changed
- **Editor — real loading progress.** Opening a document now shows a progress bar
  synced to the actual load milestones with a page-flip animation, replacing the
  indeterminate spinner.

## [1.12.0] - 2026-06-23

### Added
- **Long-term signature validation (PAdES-B-LT)** — extend a digital signature
  with embedded revocation data (OCSP/CRL) so it stays verifiable for years,
  even after the signing certificate expires (builds on the B-T timestamping
  added in 1.11.0).
- **Editor — native layers (OCG)**: show and toggle a PDF's optional-content
  layers, with a dedicated annotations panel and a document-language badge.
- **Document library — organize pages**: reorder, rotate and delete the pages of
  a stored document from a visual grid, without opening the editor.
- **Document library — export to 12 formats and PDF→PDF transforms**: convert or
  transform a stored document in place (Office, OpenDocument, image, Markdown,
  CSV, EPUB, HTML, RTF and text).

## [1.11.0] - 2026-06-23

### Added
- **Export to Markdown, CSV and EPUB** — available from the editor and the
  document library, alongside the existing Office (DOCX/XLSX/PPTX/ODT/ODP) and
  image (PNG/JPEG/WebP) outputs.
- **Ten new conversion tools** — PDF → ODS, ODP, HTML, RTF, text, Markdown, CSV
  and EPUB, plus CSV → PDF and Markdown → PDF, each with its own guide page.
- **Editor — table-of-contents editing**: read, add, rename, reorder and remove
  outline entries (bookmarks), written back into the PDF.
- **Editor — automatic PII redaction**: detect and truly remove personal data
  (emails, phone numbers, etc.) from the page, not just mask it.
- **Editor — page resizing** and **new annotation types**.
- **Document library — automatic conversion on import**: images and RTF files
  are converted to PDF as they are added, and a one-click **OCR** action makes
  scanned documents searchable.
- **Image watermarks** — stamp a logo or picture across the pages (not just
  text), from both the watermark tool and the editor.
- **Timestamped digital signatures (PAdES-B-T)** — add an eIDAS advanced
  electronic signature sealed with a trusted RFC 3161 timestamp (FreeTSA),
  proving when a document was signed.
- **List-box form fields** — create multi-choice list boxes when building
  interactive PDF forms, alongside text fields, checkboxes, radios and dropdowns.
- **Editor — rulers and draggable margin guides** (Word-style) in single-page
  view.

### Changed
- **Faithful document conversion, powered by gigapdf-lib 0.71.1.** Office imports
  (DOCX/XLSX/PPTX/ODT/ODS/ODP) preserve images, hyperlinks, styles, spreadsheet
  formulas and tables; the HTML→PDF renderer covers full CSS; image handling
  adds WebP, AVIF, SVG and GIF; and text is laid out with OpenType shaping for
  correct glyphs and spacing.

## [1.10.0] - 2026-06-21

### Added
- **Element transparency** — set the opacity of any shape or image; it is baked
  into the PDF (no quality loss).
- **Stacking order is saved** — bring to front / send to back is now written into
  the PDF itself, so the order is kept when the file is reopened anywhere.

### Changed
- **Live shape styling** — editing a vector shape's fill, stroke, width or dash
  now updates instantly on the page (WYSIWYG); shapes are rendered as real
  editable objects instead of a flat picture, so there is no stale preview.
- Powered by gigapdf-lib 0.58.1 (in-place opacity via ExtGState, native z-order
  that preserves each element's appearance, and per-element raster exclusion).

## [1.9.0] - 2026-06-21

### Added
- **Edit every element of a PDF — not just text.** Images and vector shapes
  imported from the original PDF can now be selected, moved, resized, deleted
  and duplicated directly on the page. Edits are applied **in place** (lossless)
  — no re-compression of images, no re-drawing of shapes.
- **Change vector shape styles** — fill colour, stroke colour, stroke width and
  dash pattern of a shape can be edited from the properties panel and are baked
  back into the PDF.
- **Layers** — organise page elements into named layers: create, rename,
  reorder, assign elements, and lock or hide a whole layer. Layers and their
  membership now **persist across sessions** (saved per document).
- **Stacking order** — bring an element to front / send to back (toolbar +
  Ctrl/Cmd+] and Ctrl/Cmd+[).

### Changed
- Powered by gigapdf-lib 0.57.0 (in-place affine transform + vector restyle,
  unified element index).

## [1.8.0] - 2026-06-21

### Changed
- **Direct text editing — the editor now renders real, editable text instead of
  a flat image.** Each page is rasterised *without* its text (engine
  `renderPageNoText`); the real text is drawn on top as live, editable text in
  its embedded font and true colour. Editing a text run is now direct and works
  over any background — including gradients and patterns — with no colour mask.
  Non-text content (vector art, gradients/shadings, images) stays pixel-perfect.
- **1:1 text fidelity even with broken embedded fonts.** Embedded subset fonts
  whose character map is missing/corrupt are now repaired server-side (a valid
  `cmap` and the required tables are synthesised from the PDF's encoding /
  `ToUnicode` / CID maps), so the browser always renders the original glyphs.
- **Full editing on every page of the continuous (Word-like) view.** The focused
  page is now a complete editor (create text/shapes, move/resize, retype, delete,
  undo/redo, toolbar) — identical to single-page mode; other pages stay fast,
  read-only previews.

### Fixed
- Text and form fields no longer appear duplicated when opening a document in the
  continuous editor.
- Embedded-font loading no longer floods the server (requests are now throttled
  and have a dedicated rate-limit budget), fixing failed font loads on
  font-heavy documents.

## [1.7.0] - 2026-06-21

### Added
- **Universal merge** — combine any files (PDF, Word, Excel, PowerPoint,
  OpenDocument, images JPG/PNG/GIF/WebP/AVIF, HTML, text, RTF) into a single
  PDF; every file is converted automatically before merging
  (`POST /api/pdf/merge-universal`)
- **Global command palette** (Ctrl/Cmd+K) — jump to any tool or page, or run a
  semantic search across your documents from anywhere in the app
- **Semantic document search** — new `/search` page backed by
  `GET /api/v1/search/semantic`
- **Nine new tools, now 29 in total** — universal merge, image to PDF, PDF to
  image, PDF to PowerPoint, PDF to Excel, RTF to PDF, text to PDF, redact PDF
  and unlock PDF
- **"Features" mega-menu** — lists every tool by category, available on every
  page of the marketing site
- New processing routes `POST /api/pdf/image-to-pdf` and
  `POST /api/pdf/to-image` (returns a ZIP of PNG pages)

### Changed
- Unified header and footer across the whole marketing site

### Fixed
- The semantic search page (`/search`) no longer returns a 404

## [1.6.0] - 2026-06-18

### Added
- New **`/engine`** page (fr + en, statically generated) presenting the in-house
  PDF engine in detail: real content editing, rendering & rasterization, AcroForm
  forms, annotations, RC4/AES encryption + PKCS#7 digital signatures, Type0/CID
  fonts with automatic Google Fonts embedding, a native HTML/CSS→PDF renderer with
  a built-in JavaScript engine, Office conversions (DOCX/XLSX/PPTX/ODT/ODS) and OCR.
- SDK cookbook: the `@qrcommunication/gigapdf-lib` documentation gains task-oriented
  recipes (merge, split, encrypt, sign, annotate, HTML→PDF with fonts, searchable
  OCR, metadata & bookmarks).

### Changed
- **Core PDF processing now runs on the in-house Rust→WebAssembly engine.** Page
  rendering, thumbnails, true redaction, compression, structured-text extraction,
  search, metadata and the PDF↔Office/HTML conversions all go through
  `@qrcommunication/gigapdf-lib` — no third-party PDF/Office/image runtime library.
  The browser canvas renderer loads the engine WASM directly (`load(url)`).
- Product and marketing copy updated to describe the home-made engine; internal
  render/preview identifiers renamed for clarity (`engineRenderPage`,
  `EngineRenderPageOptions`).

### Fixed
- Client bundle build: the engine's Node-only `loadDefault()` (`fs/promises` /
  `url`) is now stubbed out of the **browser** bundle (the browser path uses
  `GigaPdfEngine.load(url)` and never reaches it), unblocking `next build` for the
  embed/editor canvas. The server keeps the real modules (engine stays
  `serverExternalPackages`).

## [1.5.0] - 2026-06-14

### Added
- Export: every output format is now selectable directly from the editor and
  the dashboard — rasterized images (PNG / JPEG / WebP) and Office documents
  (DOCX / XLSX / PPTX / ODT / ODP).
- Mobile app upgraded to **Expo SDK 56** (React Native 0.85).
- Continuous deployment: every push to `main` now auto-deploys to production
  once CI is green (pushes that touch only the mobile app are skipped, since it
  ships via EAS). The README shows live **CI** and **Security Audit** status
  badges.

### Changed
- Runtime modernized to **Node.js 24**, **Redis 8** and **pnpm 10.28**
  (PostgreSQL stays at 17), with a full sweep of dependency major upgrades
  across the toolchain (Vitest 3.2, Fabric 7.4, and the rest).
- Authenticated areas (dashboard, editor, embed) are now explicitly `noindex`
  — defense in depth on top of `robots.txt`.
- OpenAPI version aligned to the product version (1.5.0).

### Fixed
- PDF → image export pipeline unblocked: pages are rasterized with MuPDF
  (fixes HTTP 500 on documents containing images), the pdf.js worker is
  configured for in-thread rendering on the server, export directory
  permissions and the queue / internal-auth / job-status wiring are corrected,
  and "Document not found" on rapid export bursts is resolved.
- Page thumbnails are now generated with MuPDF.

### Security
- All open Dependabot alerts cleared (**76 → 0**): CRITICAL/HIGH transitive
  bumps via `pnpm.overrides`, removal of a stale npm lockfile in `apps/mobile`,
  and Python dependency CVE fixes.

## [1.4.0] - 2026-06-13

### Added
- Public site is now statically generated (SSG): the landing, auth, legal
  and SEO pages prerender per locale (fr + en) with the correct
  `<html lang>` — faster TTFB and fully crawlable HTML. Implemented via
  Next.js multiple root layouts (route groups `(site)` for the localized
  public perimeter, `(app)` for the authenticated app which stays dynamic).
- `/docs`: detailed self-hosting guide (Docker and native — Python venv +
  `pip install -r requirements.txt`, pnpm, system dependencies, Alembic
  migrations, nginx routing) and an API & developers section linking
  Swagger (`/api/docs`), Redoc (`/api/redoc`) and the OpenAPI schema.
- OpenAPI metadata: title, version 1.4.0, AGPL license, contact, grouped
  tags.

### Fixed
- Security: PDF hyperlinks in the editor now open only `http(s)` URLs with
  `noopener,noreferrer` (blocks `javascript:`/`data:` URI XSS).
- Security: the embed page validates the postMessage origin against the
  embedding parent and targets replies (including the file Blob) to that
  origin instead of `*`.
- SEO 404s for unknown/cross-locale tool & solution slugs are now native
  HTTP 404 (static `dynamicParams = false`), replacing the proxy rewrite.
- GitHub URLs corrected to `QrCommunication/gigapdf` across the public site.

## [1.3.0] - 2026-06-13

### Added

**Public site**
- English version of the public pages with locale-prefix routing —
  French URLs are unchanged (default locale, no prefix), English lives
  under `/en/*`, with per-page canonical URLs and valid
  `fr`/`en`/`x-default` hreflang alternates. Dashboard, editor and
  embed keep their cookie-based locale and stay unprefixed.
- 32 programmatic SEO pages, each written in both French and English
  with localized slugs (e.g. `/tools/editer-pdf` ↔
  `/en/tools/edit-pdf`): 20 tool guides, 10 profession pages and the
  2 hub pages, with JSON-LD structured data (SoftwareApplication,
  HowTo, FAQPage, BreadcrumbList). The sitemap now lists both locales
  (~73 URLs).
- Landing page redesign — "print-shop editorial" direction: crop
  marks, fixed scroll ruler, numbered sections, asymmetric hero with a
  pure-CSS editor mockup, and an animated bento grid
  (reduced-motion safe).

**Editor**
- Professional canvas navigation: native scrolling when zoomed (fixes
  the "cannot move around the page once zoomed in" lock-up),
  Ctrl+wheel zoom anchored at the cursor, presets from 50% to 400%,
  Fit page / Fit width, Ctrl+0 / Ctrl+1 shortcuts, and panning with
  Space-hold or middle-click.
- Professional form designer: multiline text, date fields, radio
  groups and dropdowns with editable options; rich field properties
  (unique-name validation, tooltip, required, read-only, defaults,
  max length, font size, alignment); Design / Fill modes with
  highlighting of the document's existing fields; flattening after
  filling; field list with tab-order reordering; 4 px edge snapping.
  The server-side bake honors required, defaults, maxLength, password,
  fontSize, alignment and tooltip.

### Changed
- Honest pricing: every feature ships on every plan, free included —
  plans differ by volumes (storage, documents, API calls, team
  members), branding and support. The fake "advanced editing"
  differentiator is gone.

### Fixed
- **Google OAuth: every sign-up failed** with `unable_to_create_user`.
  better-auth declared the additional field `is_admin` (snake_case)
  while the Prisma client field is `isAdmin`, so each
  `prisma.user.create()` triggered by a Google sign-up threw a
  validation error.
- Plan quotas: the three plan sources of truth (seed script, quota
  service, ORM defaults) are now aligned; enterprise "unlimited" is
  consistently encoded as `-1`; two `-1` quota comparisons that were
  always true / always false are fixed; the free plan's document-limit
  default is now 100 (was 1000).
- Removed hreflang alternates that pointed to 404 URLs.

### Notes for self-hosters
- **Database migration required** after updating:
  ```bash
  source venv/bin/activate
  alembic upgrade head
  ```
  v1.3.0 ships migration `018_free_doc_limit`, a data migration that
  resets free-plan quota rows created with the stale 1000
  document-limit default back to 100 (custom limits set by an admin
  are left untouched). Verify with `alembic current` that
  `018_free_doc_limit` is applied.
- The public site now serves English pages under `/en/*`. The
  reference nginx config routes everything outside `/api/*` to
  Next.js, so no change is needed there — but if you maintain a custom
  path allow-list in front of the web app, make sure `/en/*` reaches
  Next.js.

## [1.2.0] - 2026-06-13

### Added

**Document management**
- Trash: deleting a document now soft-deletes it. New `/trash` page to
  restore or permanently delete documents; trashed documents are purged
  automatically after 30 days (Celery task).
- Tags on documents (max 20, normalized lowercase): chips in the list
  views, tag filter, autocomplete from your existing tags, and a
  manage-tags dialog.
- Full-text search across document names **and** document content
  (PostgreSQL generated `tsvector` + GIN index).
- Real document thumbnails: page 1 is rendered at upload and refreshed
  after editing (`POST /api/v1/storage/documents/{id}/thumbnail`).
- Document duplication ("name (copie)", "(copie 2)", …).
- Folder renaming (`PATCH /api/v1/storage/folders/{id}`).
- Parallel uploads (pool of 3 concurrent uploads).
- Wider import formats: PDF plus Word (`.doc`/`.docx`), Excel
  (`.xls`/`.xlsx`), PowerPoint (`.ppt`/`.pptx`) and OpenDocument
  (`.odt`/`.ods`/`.odp`) — converted to PDF on import.
- Activity history on the document detail page.

**Editor**
- Real-time collaboration is now effective: element changes made by other
  participants appear live on the canvas (server-side WebSocket relay of
  `element:create` / `element:update` / `element:delete`, applied to the
  Fabric canvas).
- Layers panel wired to the scene graph: per-element visibility and
  locking.
- Multi-selection editing: opacity, colors and alignment applied to every
  selected element at once.
- PDF compression with the achieved ratio displayed before applying it to
  the document.
- OCR "searchable PDF": adds an invisible text layer to image-only pages
  so scanned documents become selectable and searchable.
- Digital signature (PKCS#7) with a P12/PFX certificate — the certificate
  and its passphrase are processed in memory only, never stored.
- Export to ODT and ODP, in addition to DOCX, XLSX and PPTX.

**Backend**
- `POST /api/v1/logs`: rate-limited ingestion endpoint for frontend logs.

### Fixed
- **Alembic `migrations/env.py`: migrations were silently rolled back**
  on every database where the `alembic_version` table already existed.
  An implicit transaction opened by the version-table check was never
  committed, so `alembic upgrade head` exited 0 and logged
  "Running upgrade …" while applying **no** schema change. Self-hosters
  should run `alembic upgrade head` again after updating and verify with
  `alembic current` that the latest revision (`017_ged_features`) is
  applied.

### Changed
- The seven legacy FastAPI PDF-manipulation routers (bookmarks, forms,
  history, layers, modify, pages, security — 29 endpoints) are now
  flagged as deprecated in OpenAPI. They are superseded by the TypeScript
  pdf-engine routes (`/api/pdf/*`) and scheduled for removal.
- Removed the unimplemented annotation and text endpoints that only
  returned HTTP 501.

### Notes for self-hosters
- **Database migration required** after updating:
  ```bash
  source venv/bin/activate
  alembic upgrade head
  ```
  v1.2.0 ships migration `017_ged_features` (full-text search columns and
  trash index on `stored_documents`). Because of the `env.py` bug fixed in
  this release, double-check with `alembic current` that the revision is
  really applied.

## [1.1.1] - 2026-06-12

### Fixed
- nginx reference config: `/api/` now defaults to Next.js, with FastAPI
  scoped to its real prefix `/api/v1/` (+ `/api/docs`, `/api/redoc`).
  The previous allow-list routing sent every non-enumerated Next.js API
  route to FastAPI, returning 404 in production for `/api/office/*`
  (Office conversion), `/api/health`, `/api/fonts/google` and
  `/api/v1/embed/validate-key` (embed widget). New Next.js API routes now
  work without touching nginx.

## [1.1.0] - 2026-06-12

### Added
- Automatic identification of the PDF's fonts with on-demand Google Fonts
  download through a server-side proxy (`GET /api/fonts/google`). Lookups
  are cached in the database (`font_cache`) and in the browser (IndexedDB);
  no client request ever reaches Google — GDPR-friendly.
- Server-side bake integration: a font downloaded from Google Fonts is
  embedded in the final PDF, so the saved document renders identically
  everywhere.
- Real text formatting in the editor: bold, italic, underline and text
  alignment.
- Watermark "Apply to document" option (whole document, not just the
  current page).
- Share button in the editor toolbar.
- Document detail page: preview, metadata, and version history with
  one-click restore.
- New text elements adopt the document's dominant font.
- Global toast notification system.

### Fixed
- `Dockerfile.web` / `Dockerfile.admin`: Debian (bookworm) base image with
  the complete PDF system dependencies (LibreOffice, fontforge,
  tesseract-ocr fra+eng, Playwright Chromium), correct `public/` path for
  the standalone monorepo output, and workspace-aware install.
- Folder deletion now wired in the documents list view.
- Missing i18n keys.

### Changed
- `docker-compose.yml`: `env_file` is now set on every application service
  (api, celery-worker, celery-beat, web, admin), so the root `.env` is
  passed in full.

## [1.0.0-oss] — 2026-04-26

### Added
- `LICENSE` (GNU AGPL-3.0-or-later) — the project is now officially
  open source. The previous README announced "MIT" but no LICENSE
  was published, leaving the code in a "all rights reserved" state.
- `TRADEMARK.md` — strict trademark policy: forks with code modifications
  must rebrand entirely. Hosting an unmodified copy is allowed with
  disclaimer. Logo CC-BY-ND 4.0.
- `SECURITY.md` — vulnerability reporting via GitHub Security Advisories
  or contact@qrcommunication.com, with response SLAs per severity.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `.github/workflows/dco.yml` — DCO check on every PR. All commits must
  be signed off (`git commit -s`).
- `.github/ISSUE_TEMPLATE/` — bug, feature, and security templates.
  Blank issues disabled.
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist with DCO reminder.
- `branding/` folder — 4 SVG logo variants under CC-BY-ND 4.0.
- 4 separate legal pages: `/legal-notice`, `/privacy`, `/terms`,
  `/cookies`. Personal email replaced by `contact@qrcommunication.com`.
- `apps/web/src/lib/env.ts` — Zod-validated public legal env vars.
  Production refuses to start without them.

### Changed
- `README.md` — full rewrite: AGPLv3 + trademark badges, new pitch,
  3 differentiators, Cloud vs Self-hosted comparison, License &
  Trademark section, About QR Communication.
- `CONTRIBUTING.md` — repo URL updated (ronylicha → QrCommunication),
  DCO sign-off section added, license clause added.
- All 17 `package.json` files declare `"license": "AGPL-3.0-or-later"`
  per SPDX.
- Hardcoded VPS IP (`51.159.105.179`) removed from deploy scripts and
  docs. `deploy/redeploy.sh` and `deploy/push-deploy.sh` now require
  `GIGAPDF_VPS_HOST` / `DEPLOY_HOST` and fail-fast if missing.
- Hardcoded personal email (`rony@ronylicha.net`) removed from privacy
  and terms pages. Now sourced from `env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`.

### Notes for self-hosters
- You **must** configure `NEXT_PUBLIC_LEGAL_*` env vars in
  `apps/web/.env.local` to comply with French LCEN. The app refuses
  to start in production without them. See `apps/web/.env.example`.
- For deploy scripts: `export GIGAPDF_VPS_HOST=your.host.example.com`
  before running `deploy/redeploy.sh`.

### Links
- AGPLv3 text: https://www.gnu.org/licenses/agpl-3.0.txt
- Trademark policy: [TRADEMARK.md](TRADEMARK.md)
- Logo assets: [branding/](branding/)
