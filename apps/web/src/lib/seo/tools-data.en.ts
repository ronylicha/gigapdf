/**
 * Programmatic SEO data — English tool pages (/en/tools/[slug]).
 *
 * Static content written natively in English (not translated literally).
 * Every entry describes ONLY capabilities that actually exist in GigaPDF
 * GigaPDF — in-house PDF engine (TypeScript/WebAssembly).
 * No variable templates: intros and FAQs are written individually.
 *
 * Slugs are English-specific; the FR ↔ EN mapping lives in ./slug-map.ts.
 * relatedTools / relatedSolutions reference EN slugs only.
 */

import type { ToolData } from "./tools-data";

export const TOOLS: ToolData[] = [
  {
    slug: "edit-pdf",
    appHref: "/documents",
    name: "Edit PDF",
    category: "edit",
    metaTitle: "Edit PDF Online: Change Text & Images Free | GigaPDF",
    metaDescription:
      "Edit text, images, and shapes inside your PDF with the original fonts. Free WYSIWYG editor — open source, self-hostable, no watermark.",
    h1: "Online PDF editor: change the text, images and shapes inside the file itself",
    intro: [
      "Fixing a typo in a contract that only exists as a PDF, updating a price on a brochure, swapping out an old logo: most online tools handle this by painting a white box over the old content and hoping nobody notices. GigaPDF works differently. Its WYSIWYG editor opens the page exactly as it will print and lets you click any text block, image, or shape to change it, move it, or genuinely remove it.",
      "Font fidelity is what makes the result look right. GigaPDF identifies the fonts used in the document, fetches them automatically from Google Fonts when they are available there, and embeds them in the file when you save. Your correction picks up the same typeface as the surrounding paragraph instead of an ugly Arial substitute. Deletions go through GigaPDF's in-house engine, which strips the text operators out of the content stream rather than hiding them — nothing resurfaces when someone copies and pastes.",
      "The editor runs in the browser with nothing to install. The free plan includes every editing feature, along with 5 GB of storage and 1000 documents. The code is open source, source-available under the PolyForm Noncommercial license, so teams handling sensitive files can run the whole application on their own server.",
    ],
    howTo: {
      title: "How to edit a PDF online",
      steps: [
        "Create a free account and drag your PDF into your workspace.",
        "Open the document in the editor: every text block, image, and shape becomes selectable.",
        "Double-click any text to correct it; the original font loads automatically.",
        "Add new elements where you need them: text boxes, images, rectangles, arrows, or lines.",
        "Delete what no longer belongs: the content is removed from the file, not covered up.",
        "Save: edited fonts are embedded and a new version of the document is kept.",
      ],
    },
    capabilities: [
      "WYSIWYG editing of existing text, images, and shapes",
      "Move, resize, delete, and duplicate any element in place — losslessly",
      "Original fonts detected, fetched from Google Fonts, and embedded on save",
      "Restyle vector shapes: fill, stroke color, stroke width, and dash pattern",
      "Table editing: insert or delete rows and columns, merge cells, adjust borders and shading",
      "Bulleted and numbered lists, with indent levels and markers",
      "Element opacity and transparency, baked into the PDF",
      "Stacking order — bring to front or send to back, saved in the PDF itself",
      "Persistent layers: create, rename, lock, and hide, kept across sessions",
      "True content removal through the in-house engine — no white-box masking",
      "Native annotations, watermarks, and form filling from the same editor",
      "Version history and page thumbnails in the built-in document manager",
      "Real-time collaboration on the same document",
    ],
    faq: [
      {
        question: "Can I change the existing text of a PDF, not just add new text on top?",
        answer:
          "Yes. GigaPDF extracts the text blocks from the file and makes them editable in place. When you correct a paragraph, the old content is removed from the PDF stream by the in-house engine and the new text is written with the original font, which gets embedded in the file when you save.",
      },
      {
        question: "What happens when the PDF uses a font I don't have installed?",
        answer:
          "You don't need to install anything. GigaPDF reads the font declared in the document and downloads it automatically from Google Fonts whenever it is published there. If a proprietary font is not available, a close equivalent is offered and clearly flagged before you save.",
      },
      {
        question: "Is the GigaPDF editor actually free?",
        answer:
          "Yes. The free plan covers every feature, editing included, with 5 GB of storage, 1000 documents, and 1,000 API calls per month. There is no stripped-down edition of the editor: the limits apply to volume, never to functionality.",
      },
      {
        question: "Are my confidential documents safe?",
        answer:
          "Your files stay in your personal workspace, can be encrypted with AES-256, and remain recoverable from the trash for 30 days. For full control, GigaPDF is open source and self-hostable: you can run the entire application on your own infrastructure.",
      },
      {
        question: "Can several people edit a PDF at the same time?",
        answer:
          "Yes, the editor supports real-time collaboration. Several people can open the same document, watch each other's changes appear live, and work without overwriting one another — no more version ping-pong by email.",
      },
    ],
    useCases: [
      "Fix a typo or update a date in a contract without going back to the original Word file",
      "Replace a logo, a price, or a legal notice on a sales brochure that only exists as a PDF",
      "Clean up a document received from a third party: strip outdated elements and add what's missing",
    ],
    relatedTools: ["annotate-pdf", "organize-pdf-pages", "watermark-pdf", "pdf-forms"],
    relatedSolutions: ["freelancers", "human-resources", "lawyers"],
    icon: "pen-line",
  },
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    category: "organize",
    appHref: "/merge",
    metaTitle: "Merge PDF Files Online Free | GigaPDF",
    metaDescription:
      "Combine several PDFs into one file, in the order you choose. Free, no added watermark, pages copied without recompression. Open source.",
    h1: "Merge several PDFs into a single document",
    intro: [
      "Application files, supporting documents for a loan, a report assembled from three departments: these things always end up scattered across five or six separate PDFs. Sending them as-is forces the recipient to juggle attachments; printing and rescanning them murders the quality. Merging produces one continuously paginated file, ready to send or archive.",
      "GigaPDF assembles your PDFs server-side with its dedicated engine: pages are copied without recompression, bookmarks and form fields from the source files survive as far as the format allows, and no advertising watermark lands on the result. You set the file order before merging, then fine-tune the page order in the editor if something needs adjusting.",
      "The merged file drops straight into your GigaPDF document manager, where it can be tagged, found through full-text search, and shared by link or email. All of it ships with the free plan, and since the code is source-available under the PolyForm Noncommercial license, the whole application can run on your own server.",
    ],
    howTo: {
      title: "How to merge PDF files",
      steps: [
        "Upload the PDFs you want to combine, in one batch or several.",
        "Select the documents and start the merge from the actions menu.",
        "Drag the files into the final assembly order.",
        "Confirm: the engine copies the pages without recompression and builds the combined document.",
        "Adjust the page order in the editor if needed, then share or file the merged PDF.",
      ],
    },
    capabilities: [
      "Merge any number of files into a single PDF",
      "Reorder documents before assembly",
      "Pages copied without recompression or quality loss",
      "No watermark added to the output file",
      "Fine-grained page reordering after the merge, in the editor",
      "Result filed in the document manager: folders, tags, full-text search",
    ],
    faq: [
      {
        question: "How many PDF files can I merge at once?",
        answer:
          "GigaPDF puts no ceiling on the number of files in a merge. The only boundary is your storage: the free plan gives you 5 GB and 1000 documents, which comfortably covers bundles running to several hundred pages.",
      },
      {
        question: "Does merging degrade document quality?",
        answer:
          "No. Pages are copied into the final file exactly as they are, with no image re-encoding and no reinterpretation of the content. A vector PDF stays vector, a scan keeps its original resolution. If you want a lighter result, run the compression tool afterwards — it's optional.",
      },
      {
        question: "Can I change the page order after merging?",
        answer:
          "Yes. The merged document opens in the GigaPDF editor, where the thumbnail view lets you move, rotate, delete, or extract any page. You never have to redo the merge because one page landed in the wrong spot.",
      },
      {
        question: "Do forms and links from the source files survive?",
        answer:
          "Form fields and internal links are carried into the merged file as far as the PDF structure allows. When two forms use identical field names, GigaPDF tells them apart so one entry doesn't overwrite the other.",
      },
    ],
    useCases: [
      "Assemble a rental or loan application: ID, payslips, and tax statements in a single file",
      "Bundle a month of invoices into one package before sending it to your accountant",
      "Build a final report from PDF chapters written by several contributors",
    ],
    relatedTools: ["split-pdf", "organize-pdf-pages", "compress-pdf"],
    relatedSolutions: ["accountants", "real-estate", "nonprofits"],
    icon: "merge",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    category: "organize",
    appHref: "/split",
    metaTitle: "Split PDF: Extract Pages Online Free | GigaPDF",
    metaDescription:
      "Cut a PDF into separate files or pull out just the pages you need. Visual thumbnail selection, free and open source.",
    h1: "Split a PDF and extract just the pages you need",
    intro: [
      "Sending the three relevant pages of a forty-page report, isolating each payslip from a payroll run, separating the technical annex from the main contract: cutting a PDF apart is often more useful than sending the whole thing. It keeps information away from people it doesn't concern and makes every exchange lighter.",
      "In GigaPDF, splitting is visual. Thumbnails of every page appear on screen; you tick the pages to extract or set the cut points, and the engine produces independent files by copying pages without recompressing them. The reverse move works from the same screen: delete pages from a document to keep only what matters.",
      "Every output file is a complete, standalone PDF that can be filed in your folders, tagged, and found again through the document manager's full-text search. Splitting comes with the free plan, with no cap on how often you use it, and works the same on a self-hosted instance.",
    ],
    howTo: {
      title: "How to split a PDF file",
      steps: [
        "Upload the PDF you want to cut into your workspace.",
        "Open the thumbnail view to see every page at a glance.",
        "Select the pages to extract, or define the split ranges (for example 1-4, 5-12, 13-20).",
        "Run the operation: each segment becomes its own PDF file.",
        "Rename and file the new documents, then share the ones that need to go out.",
      ],
    },
    capabilities: [
      "Extract a single page, a range, or any free selection of pages",
      "Cut one document into several files in a single operation",
      "Visual selection on thumbnails — no typing page numbers blind",
      "Pages copied without recompression: quality strictly identical to the source",
      "Page deletion and rotation from the same screen",
      "New files filed immediately in the document manager",
    ],
    faq: [
      {
        question: "Can I extract non-consecutive pages, say pages 2, 7, and 15?",
        answer:
          "Yes. Selection happens page by page on the thumbnails: tick pages 2, 7, and 15 and GigaPDF assembles them into a new file in the order you chose. You are never restricted to continuous ranges.",
      },
      {
        question: "Is the original document modified when I split it?",
        answer:
          "No. Splitting creates new files and leaves the source untouched in your workspace. If you genuinely want to trim the original, use page deletion in the editor instead — version history lets you walk it back either way.",
      },
      {
        question: "How do I cut a large PDF into equal parts?",
        answer:
          "Set your intervals in the split dialog — every 10 pages, for instance — and GigaPDF generates one file per segment in a single pass. It's the fastest way to break a long scan or a bulky export into manageable chunks.",
      },
      {
        question: "Do extracted files keep searchable text and links?",
        answer:
          "Yes. Pages travel with everything they contain: selectable text, images, links, annotations. A PDF that went through GigaPDF's OCR keeps its invisible text layer in every file produced by the split.",
      },
    ],
    useCases: [
      "Pull the one certificate you need out of an administrative bundle before filing it",
      "Separate each fiscal year or each client from a global accounting export",
      "Isolate a single chapter of a thesis or course pack to hand out on its own",
    ],
    relatedTools: ["merge-pdf", "organize-pdf-pages", "compress-pdf"],
    relatedSolutions: ["accountants", "human-resources", "students"],
    icon: "scissors",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    category: "edit",
    appHref: "/compress",
    metaTitle: "Compress PDF Online Free — Reduce File Size | GigaPDF",
    metaDescription:
      "Shrink heavy PDFs without wrecking them: the in-house engine strips unused objects and linearizes for fast web viewing. Free and open source.",
    h1: "Compress a PDF: cut the weight without gutting the document",
    intro: [
      "An oversized PDF runs into walls all day long: mailboxes that cap attachments at 10 or 25 MB, government portals that reject large uploads, transfer links that time out halfway. Multi-page scans and image-stuffed exports are the usual offenders.",
      "GigaPDF leans on its in-house engine to compress intelligently: a structure-cleanup pass removes unused objects, duplicated fonts, and orphaned streams that silently bloat files reworked by several tools, while linearization reorders the structure for progressive display in the browser — the first page shows up before the download finishes. The visible content is never degraded: the structural junk goes, your pages stay sharp.",
      "This approach pays off most on documents that have been through several editors, because they accumulate dead weight. Compression is part of the free plan and chains naturally with merging and splitting: assemble first, compress next, share the result by link.",
    ],
    howTo: {
      title: "How to compress a PDF file",
      steps: [
        "Upload the heavy PDF to your workspace.",
        "Start compression from the document's actions menu.",
        "The in-house engine cleans the structure: unused objects, duplicates, and orphaned streams are dropped.",
        "The file is linearized for progressive online viewing.",
        "Compare the new size with the original, then download or share the lighter version.",
      ],
    },
    capabilities: [
      "In-house structure cleanup: unused objects, fonts, and streams removed",
      "Linearization for instant page-by-page display in the browser",
      "No degradation of vector text or page layouts",
      "Most effective on PDFs that were edited or assembled multiple times",
      "Chains with merge and split in the same session",
      "Original preserved: compression creates a version, history keeps the rest",
    ],
    faq: [
      {
        question: "How much smaller will my file get?",
        answer:
          "It depends on what's inside. PDFs that passed through several tools pile up dead objects and duplicate fonts: on those, the structural cleanup often claws back a substantial share of the weight. An already optimized scan, where nearly all the size is image data, will shrink less.",
      },
      {
        question: "Will compression make my text blurry?",
        answer:
          "No. GigaPDF works on the file's structure — unused objects, duplicates, stream organization — not by rasterizing your content. Vector text stays crisp at every zoom level and layouts are untouched.",
      },
      {
        question: "What does linearizing a PDF actually do?",
        answer:
          "A linearized PDF is reorganized so the first page renders as soon as the download starts, without waiting for the whole file. That matters for documents read online or shared by link: the recipient starts reading immediately, even on a slow connection.",
      },
      {
        question: "Can I compress several documents in a row?",
        answer:
          "Yes. Compression is available on every document in your workspace with no usage quota. The free plan's limits are storage (5 GB) and document count (1000), not the number of operations you run.",
      },
    ],
    useCases: [
      "Get a scanned file under the attachment limit of a mailbox or government portal",
      "Slim down archived reports to save your team's storage space",
      "Prepare documents that load fast when viewed online through a share link",
    ],
    relatedTools: ["merge-pdf", "split-pdf", "ocr-pdf"],
    relatedSolutions: ["architects-construction", "nonprofits", "accountants"],
    icon: "file-archive",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    category: "secure",
    appHref: "/sign",
    metaTitle: "Sign PDF with Digital Certificate (PKCS#7) | GigaPDF",
    metaDescription:
      "Sign PDFs with a real P12/PFX digital certificate: PKCS#7 signatures verifiable in Adobe Reader. Free, open source, self-hostable.",
    h1: "Sign a PDF with a digital certificate",
    intro: [
      "Two things get mixed up constantly: pasting an image of a signature onto a page, and digitally signing a document. The first guarantees nothing — anyone can copy the image. The second seals the file cryptographically: any later modification breaks the signature, and the recipient can verify exactly who signed.",
      "GigaPDF implements genuine digital signing to the PKCS#7 standard (the adbe.pkcs7.detached subfilter, the format Adobe Reader and conforming viewers recognize). You load your certificate as a P12/PFX file — issued by your certificate authority, your professional body, or your internal PKI — and GigaPDF computes the document's digest, encrypts it with your private key, and embeds the signature in the file. The recipient opens the PDF and sees at once whether the document is intact and who signed it.",
      "Certificate-based signing keeps you in charge of your own digital identity: the private key never leaves you, whereas proprietary platforms sign on their servers in your name. And because GigaPDF is open source and self-hostable, an organization can run its entire signing chain on its own infrastructure.",
    ],
    howTo: {
      title: "How to digitally sign a PDF",
      steps: [
        "Upload the document to sign to your workspace.",
        "Open the signing tool and load your P12/PFX certificate with its password.",
        "Place the signature field where you want it on the page.",
        "Confirm: GigaPDF computes the document digest and embeds the detached PKCS#7 signature.",
        "Download the signed PDF: its integrity can now be verified in any conforming viewer.",
      ],
    },
    capabilities: [
      "PKCS#7 digital signatures in the adbe.pkcs7.detached format",
      "P12/PFX certificate support (public CAs, professional bodies, internal PKI)",
      "Integrity check: any change after signing is detected",
      "Visible signature placed on the page of your choice",
      "Private key never handed to a third party: you sign with your own certificate",
      "Fully self-hostable chain for organizations under strict requirements",
    ],
    faq: [
      {
        question: "How is this different from a scanned signature image?",
        answer:
          "An image can be copied and protects nothing. A PKCS#7 digital signature cryptographically binds your identity to the exact content of the file: change a single comma after signing and verification fails, visibly, in the viewer. That is the foundation of a signature with evidentiary weight.",
      },
      {
        question: "Where do I get a P12/PFX certificate?",
        answer:
          "From a certificate authority (qualified providers issue certificates on tokens or as files), from your professional body — many bar associations and professional orders provide them — or from your company's internal PKI. The P12/PFX file holds your certificate and private key, protected by a password.",
      },
      {
        question: "Will Adobe Acrobat Reader recognize the signature?",
        answer:
          "Yes. GigaPDF uses the adbe.pkcs7.detached subfilter, the long-standing standard for PDF signatures. Adobe Reader shows its signature panel, checks the document's integrity, and displays the certification chain. Whether it shows 'valid' then depends on how much the reader trusts your certificate authority.",
      },
      {
        question: "Can several people sign the same document?",
        answer:
          "Yes, signatures stack: each signer adds theirs with their own certificate, and each signature covers the state of the document at the moment it was applied. Conforming viewers display the full signature history.",
      },
      {
        question: "What is this signature worth legally?",
        answer:
          "The level of recognition comes from the certificate, not from GigaPDF. In the EU, a qualified certificate from a trust service provider puts you in eIDAS territory for advanced or qualified signatures; other jurisdictions have comparable frameworks for certificate-based signing. GigaPDF supplies the standard mechanism; your certificate supplies the legal weight.",
      },
    ],
    useCases: [
      "Sign contracts and agreements with integrity proof the other party can verify",
      "Seal reports, certificates, or official deliverables before they go out",
      "Run an internal signing chain on a self-hosted instance",
    ],
    relatedTools: ["protect-pdf", "pdf-a", "pdf-forms", "edit-pdf"],
    relatedSolutions: ["lawyers", "human-resources", "real-estate"],
    icon: "file-signature",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    category: "ocr",
    appHref: "/ocr",
    metaTitle: "OCR Online: Scans and Images to Text | GigaPDF",
    metaDescription:
      "Online OCR for scanned PDFs and images: make text searchable and copyable. Multilingual, free, and open-source recognition that keeps your layout.",
    h1: "OCR: pull the text out of your scans and images",
    intro: [
      "A document made only of images — a scanned PDF, but also a photo of a document or a JPG or PNG file — is just a stack of page photographs: you can't search for a word, copy a paragraph, or pull out the figures. Until the text is recognized, the file stays mute for every tool you own — including your own document manager's search. Optical character recognition (OCR) turns those images into text you can actually use.",
      "GigaPDF ships with its own optical character recognition engine, which loads its full set of models by default: it reads not only French, English, German, Spanish, Italian, Portuguese… but also Cyrillic, Arabic, Hebrew, Tamil, Devanagari, Telugu, Kannada, Chinese (Simplified and Traditional), Japanese, and Korean — accents, cedillas, and ligatures included. Built on the state-of-the-art PaddleOCR models running on our own infrastructure, it is designed first for printed text and also reads, on demand, Latin (including French), Cyrillic, and Greek handwriting. It works equally on a scanned PDF, a standalone image (JPG, PNG), or a photo of a document: you launch OCR, the engine reads every page or image, and the recognized text comes back ready to copy, export, or index.",
      "OCR feeds the rest of the platform directly: once a document is recognized, full-text search finds it by its content, and the searchable-PDF tool can lay the text as an invisible layer under the original image. Everything works on the free plan — and on your own server if you self-host, which matters when the scans and images are confidential.",
    ],
    howTo: {
      title: "How to run OCR on a scan or an image",
      steps: [
        "Upload your scanned PDF, or directly an image (JPG, PNG, photo of a document), to GigaPDF.",
        "Launch OCR from the document's actions menu.",
        "The OCR engine reads each page or image and recognizes the text across many languages and scripts.",
        "Grab the result: copy it directly, export it as TXT, or generate a searchable PDF.",
        "The document becomes findable by its content in your workspace's full-text search.",
      ],
    },
    capabilities: [
      "Multilingual in-house OCR engine (Latin, Cyrillic, Arabic, Hebrew, Indic scripts, and CJK)",
      "Works on scanned PDFs as well as standalone images (JPG, PNG, photos of documents)",
      "Accurate handling of accented and special characters",
      "Page-by-page processing of multi-page documents and images",
      "Recognized text exported as TXT or embedded as an invisible searchable layer",
      "Recognized content indexed in the document manager's full-text search",
      "Runs on your own server when self-hosted: scans never leave your infrastructure",
    ],
    faq: [
      {
        question: "Which languages does GigaPDF's OCR recognize?",
        answer:
          "The OCR engine loads its full set of models by default: beyond French and English, it recognizes many scripts — Latin (German, Spanish, Italian, Portuguese…), Cyrillic, Arabic, Hebrew, Indic (Tamil, Devanagari, Telugu, Kannada), and CJK (Simplified and Traditional Chinese, Japanese, Korean). A bilingual contract or an invoice mixing several languages is handled in a single pass, and accented characters come through correctly. Built on the state-of-the-art PaddleOCR models, the engine is designed first for printed text and also reads, on demand, Latin (French included), Cyrillic, and Greek handwriting.",
      },
      {
        question: "What scan or image quality do I need for good results?",
        answer:
          "The OCR performs best on clean 300 dpi scans, or well-lit, well-framed photos, of printed text. Skewed pages, photocopies of photocopies, blurry shots, and tiny font sizes drag recognition down — when it matters, scan or photograph flat and at a decent resolution.",
      },
      {
        question: "Does OCR read handwriting?",
        answer:
          "Yes, on demand. The engine is built first for printed text, but an opt-in setting also recognizes Latin (French included), Cyrillic, and Greek handwriting, through models we trained ourselves; this mode is never triggered automatically, and other scripts stay limited to printed text. For best results, use documents scanned cleanly or photographed flat at a decent resolution.",
      },
      {
        question: "What happens to the original document or image after OCR?",
        answer:
          "Nothing — it is not altered. OCR produces text you use however you like: copy it, export it, or build a searchable PDF where the recognized words sit in an invisible layer under the scan or photo, keeping the exact original appearance.",
      },
    ],
    useCases: [
      "Make scanned or photographed invoices usable: amounts and reference numbers become copyable and searchable",
      "Digitize paper archives and find them later by content, not just by file name",
      "Extract the text of a contract received as a scan, or a document photographed on your phone, so you can quote or revise it",
    ],
    relatedTools: ["searchable-pdf", "compress-pdf", "pdf-to-word"],
    relatedSolutions: ["accountants", "lawyers", "healthcare"],
    icon: "scan-text",
  },
  {
    slug: "searchable-pdf",
    appHref: "/documents",
    name: "Searchable PDF",
    category: "ocr",
    metaTitle: "Make a Scanned PDF Searchable (OCR Layer) | GigaPDF",
    metaDescription:
      "Add an invisible OCR text layer to your scans: the PDF looks identical but becomes selectable and searchable. Free, open source.",
    h1: "Make a scanned PDF searchable without changing how it looks",
    intro: [
      "The technique is known as the 'sandwich PDF': the scanned image — a scan, but also a photo of a document or an image (JPG, PNG) saved as PDF — stays exactly as displayed, and the OCR-recognized text is inserted underneath in an invisible layer aligned word for word with the image. Visually nothing changes — the stamp, the handwritten signature, the original layout all stay put. But the document now answers Ctrl+F, the text selects with the mouse, and screen readers can speak it.",
      "GigaPDF builds that layer from its multilingual in-house OCR engine (Latin, Cyrillic, Arabic, Hebrew, Indic scripts, and CJK): every recognized word is placed at the exact coordinates where it appears in the image, so a search highlights the right spot on the page and copy-paste follows the reading order. That is what separates it from a plain text export, which loses all connection to the page.",
      "For a document archive, this is the step that changes everything: a scanned collection becomes queryable in full text. Combined with GigaPDF's built-in search, it turns years of digitized paper into a base you can actually interrogate — in the cloud or on your own self-hosted server.",
    ],
    howTo: {
      title: "How to add a searchable layer to a scan",
      steps: [
        "Upload the scanned PDF — or an image (JPG, PNG, photo of a document) — to your workspace.",
        "Start the searchable-PDF conversion from the actions menu.",
        "The OCR engine recognizes the text on every page (multilingual engine).",
        "The text is embedded as an invisible layer, word by word, at the image's coordinates.",
        "Download the result: identical appearance, but selectable and searchable text everywhere.",
      ],
    },
    capabilities: [
      "Invisible text layer aligned with the original image (sandwich PDF)",
      "Document appearance strictly unchanged: visible stamps and signatures preserved",
      "Ctrl+F search working in every PDF viewer",
      "Text selection and copy-paste directly on the scan",
      "Multilingual in-house OCR recognition (Latin, Cyrillic, Arabic, Hebrew, Indic scripts, and CJK)",
      "Automatic indexing in GigaPDF's full-text search",
    ],
    faq: [
      {
        question: "What's the difference between plain OCR and a searchable PDF?",
        answer:
          "Plain OCR pulls the text out of the document (clipboard, TXT file). A searchable PDF injects that text back into the document itself, as an invisible layer under the image: the file keeps its scanned look but behaves like a native PDF for search, selection, and accessibility.",
      },
      {
        question: "Does the invisible layer change how the document looks?",
        answer:
          "No, by construction: the text is inserted in invisible rendering mode, beneath the scanned image. On screen and in print, the document is identical to the original scan. Only the behavior changes: search finds, the mouse selects.",
      },
      {
        question: "Does search highlight the right place on the page?",
        answer:
          "Yes. Each word in the layer is positioned at the coordinates where the OCR engine detected it in the image. When your viewer highlights a search hit, the highlight lands on the matching visible word — which makes long scanned documents genuinely navigable.",
      },
      {
        question: "Does this help with accessibility?",
        answer:
          "Yes. A raw scan is opaque to screen readers, which see only an image. With the text layer, the content can be read aloud and navigated. Quality tracks the recognition quality: a clean scan yields a faithful layer.",
      },
    ],
    useCases: [
      "Turn a digitized archive into a keyword-searchable document base",
      "Make scanned contracts searchable while keeping visible stamps and signatures intact",
      "Improve the accessibility of documents that were only ever distributed as scans",
    ],
    relatedTools: ["ocr-pdf", "compress-pdf", "pdf-a"],
    relatedSolutions: ["lawyers", "accountants", "architects-construction"],
    icon: "file-search",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    category: "secure",
    appHref: "/protect",
    metaTitle: "Password Protect PDF Online (AES-256) | GigaPDF",
    metaDescription:
      "Encrypt PDFs with AES-256 or AES-128 and control printing, copying, and editing. Free password protection, open source.",
    h1: "Protect a PDF with a password and encryption",
    intro: [
      "Emailing a payslip, a medical report, or a commercial offer means accepting that the file will travel beyond its intended reader: forwards, shared inboxes, attachments archived by third-party servers. Encrypting the PDF itself is the simplest counter — the document becomes unreadable without its password, wherever it ends up.",
      "GigaPDF encrypts files to the PDF standard with a choice of two algorithms: AES-256, today's recommended level, and AES-128, broadly compatible; legacy PDFs protected with RC4 can still be read through decryption, but active encryption is always AES. You set an open password and, separately, an owner password tied to granular permissions: allow or block printing, text copying, content changes, annotations, form filling, content extraction, document assembly, and high-quality printing.",
      "Keeping the two passwords distinct is genuinely useful: you can circulate a document anyone can read but nobody can modify, or one that is fully confidential. Protection applies in one click from your workspace, at no extra cost — like every GigaPDF feature, it's in the free plan and available when self-hosting.",
    ],
    howTo: {
      title: "How to password-protect a PDF",
      steps: [
        "Upload the document you want to protect.",
        "Open the protection tool and pick the algorithm — AES-256 recommended.",
        "Set the open password, to be sent to the recipient through a separate channel.",
        "Configure permissions: printing, copying, editing, annotations, form filling, content extraction, assembly, and high-quality printing.",
        "Confirm and download the encrypted PDF: without the password, its content is unreadable.",
      ],
    },
    capabilities: [
      "AES-256 or AES-128 encryption depending on your compatibility constraints",
      "Decryption of legacy PDFs protected with RC4 supported (reading)",
      "Open password (reading) separate from the owner password (permissions)",
      "8 granular permissions: printing, text copying, modification, annotations, form filling, content extraction, document assembly, high-quality printing",
      "Remove protection from a file whose password you know",
      "One-click application from the document manager, nothing to install",
      "Complete chain operable on your own server when self-hosted",
    ],
    faq: [
      {
        question: "Which encryption algorithm should I pick?",
        answer:
          "AES-256 in nearly every case: it's the strongest standard the PDF format supports and every modern viewer handles it. AES-128 remains a safe pick if you target very old readers. GigaPDF only encrypts with AES; RC4, which is cryptographically obsolete, is supported for decryption only, to open legacy PDFs already protected with it.",
      },
      {
        question: "What's the difference between the open password and the owner password?",
        answer:
          "The open password is required to read the document at all. The owner password governs rights: a file can open freely yet refuse printing or copying until that second password is supplied. Combine the two to match your confidentiality needs.",
      },
      {
        question: "Are the copy and print restrictions bulletproof?",
        answer:
          "No, and you should know it: PDF permissions are honored by conforming viewers, but a malicious tool can ignore them once the document opens. For real confidentiality, use the open password with AES-256: without it, the content is cryptographically unreadable.",
      },
      {
        question: "What if I forget the password of an AES-256 encrypted PDF?",
        answer:
          "There is no backdoor — that's exactly what makes the encryption worth using. Keep your passwords in a dedicated manager. If the original unencrypted file is still in your GigaPDF workspace, version history lets you retrieve it and encrypt again.",
      },
    ],
    useCases: [
      "Send payslips and HR documents encrypted, with the password traveling through another channel",
      "Distribute a study or quote that anyone can read but nobody can alter or copy",
      "Archive medical or legal documents AES-256 encrypted in the document manager",
    ],
    relatedTools: ["sign-pdf", "watermark-pdf", "pdf-a", "edit-pdf"],
    relatedSolutions: ["healthcare", "human-resources", "lawyers"],
    icon: "lock",
  },
  {
    slug: "watermark-pdf",
    name: "Watermark PDF",
    category: "edit",
    appHref: "/watermark",
    metaTitle: "Add a Watermark to PDF Online Free | GigaPDF",
    metaDescription:
      "Stamp a text or image watermark (CONFIDENTIAL, DRAFT, your logo) on every page of a PDF. Free, open source, no ads on your files.",
    h1: "Add a text or image watermark to a PDF",
    intro: [
      "An unmarked document travels without context: a working draft gets treated as final, a confidential study gets forwarded around, a quote gets reused by a competitor with your name stripped off. A watermark answers all three at once — it prints the document's status (DRAFT, CONFIDENTIAL, SPECIMEN) or your visual identity on every page, inseparably from the content.",
      "GigaPDF applies two kinds of watermark: text, with full control over wording, size, color, opacity, and angle (the classic translucent diagonal), or an image — typically your logo — positioned and dialed in to stay discreet without disappearing. The watermark is written into the page content during processing, not dropped on top as an annotation anyone can delete in two clicks from any viewer.",
      "One detail worth spelling out: GigaPDF never stamps its own advertising on your files, unlike plenty of so-called free tools. The watermarks are yours, applied when you decide — on the free plan and on a self-hosted instance alike.",
    ],
    howTo: {
      title: "How to watermark a PDF",
      steps: [
        "Upload the document you want to mark.",
        "Choose the watermark type: free text or an image such as your logo.",
        "Tune the appearance: position, size, opacity, rotation for the classic diagonal.",
        "Apply: the watermark is written onto every page of the document.",
        "Download or share the marked PDF; the original stays available in version history.",
      ],
    },
    capabilities: [
      "Text watermark: adjustable wording, font, size, color, opacity, and rotation",
      "Image watermark: logo or graphic stamp with measured opacity",
      "Applied to every page in a single operation",
      "Written into the page content — not a removable annotation",
      "No GigaPDF advertising ever added to your files",
      "Original kept safe through version history",
    ],
    faq: [
      {
        question: "Can the recipient remove the watermark?",
        answer:
          "GigaPDF writes the watermark into the page content, which makes it far tougher than an annotation that vanishes in two clicks. A determined, well-equipped user can always rework a PDF; for stronger guarantees, combine the watermark with AES encryption blocking modification and a digital signature that exposes any tampering.",
      },
      {
        question: "Can I use my logo without drowning the document's text?",
        answer:
          "Yes — opacity is finely adjustable. A logo at 10-15% opacity, centered or placed in the footer, brands the document without hurting readability on screen or in print. You preview the result before applying.",
      },
      {
        question: "Can I watermark several documents with the same settings?",
        answer:
          "Yes. Your settings (text, opacity, position) carry over from one document to the next, and the GigaPDF API — 1,000 calls per month included in the free plan — lets you automate systematic marking across a document pipeline.",
      },
      {
        question: "What's the difference between a watermark and a stamp?",
        answer:
          "A watermark applies uniformly to every page, as a translucent background or overlay: it qualifies the whole document. A stamp is a one-off annotation placed at a precise spot on one page — 'Approved', 'Received on…'. GigaPDF offers both: the watermark here, stamps through the annotation tool.",
      },
    ],
    useCases: [
      "Mark working versions DRAFT or CONFIDENTIAL before external review",
      "Put your firm's or agency's logo on every deliverable sent to clients",
      "Label sample documents SPECIMEN before circulating them for demos",
    ],
    relatedTools: ["protect-pdf", "annotate-pdf", "edit-pdf"],
    relatedSolutions: ["freelancers", "teachers-trainers", "real-estate"],
    icon: "stamp",
  },
  {
    slug: "organize-pdf-pages",
    name: "Organize Pages",
    category: "organize",
    appHref: "/organize-pages",
    metaTitle: "Organize PDF Pages: Reorder & Rotate Free | GigaPDF",
    metaDescription:
      "Reorder, rotate, delete, or extract PDF pages by dragging thumbnails. Free, open source, and self-hostable.",
    h1: "Organize PDF pages: reorder, rotate, delete",
    intro: [
      "Duplex scans that interleave pages out of order, sheets fed upside down through the document feeder, page 12 sitting where page 3 should be: putting a PDF back in order is one of the most ordinary jobs there is — and one of the most painful when the tool makes you type page numbers blind.",
      "GigaPDF lays the document out as a board of thumbnails: every page is visible, grabbable, and movable by drag and drop. Rotation is fixed per page or in batch (90°, 180°, 270°), blank or useless pages disappear with a click, and any selection can be extracted into a new file without leaving the screen. The engine applies all changes in one pass, without recompressing page content.",
      "Each reorganization creates a new version in the document's history, so a wrong move is undone by restoring the previous state. This visual workflow, alongside merge and split, covers the whole cycle of preparing a file — assemble, order, prune — from the browser, at no cost.",
    ],
    howTo: {
      title: "How to reorder the pages of a PDF",
      steps: [
        "Open your document in GigaPDF and switch to the thumbnail view.",
        "Drag and drop pages to fix the document's order.",
        "Select the pages to rotate and apply 90°, 180°, or 270°.",
        "Remove blank or off-topic pages with one click.",
        "Save: the changes apply in a single pass and the previous version stays restorable.",
      ],
    },
    capabilities: [
      "Drag-and-drop reordering on the thumbnail board",
      "Rotation per page or in batch: 90°, 180°, 270°",
      "Page deletion and extraction of a selection into a new file",
      "All changes applied in one pass, no content recompression",
      "Version history: every reorganization is reversible",
      "Direct hand-off to merge, split, and compression",
    ],
    faq: [
      {
        question: "How do I fix a duplex scan with interleaved pages?",
        answer:
          "This is the textbook case for the thumbnail view: you spot the actual sequence at a glance (1, 3, 5… then 2, 4, 6…) and drag the pages back into place. On a long document, extracting the even pages and re-merging in order can be even faster — both tools chain together in GigaPDF.",
      },
      {
        question: "Is the rotation saved permanently in the file?",
        answer:
          "Yes. Rotation applied in GigaPDF is written into the PDF itself: the document opens the right way up in every viewer, on screen and in print — unlike the temporary display rotation some readers offer.",
      },
      {
        question: "Can I undo a reorganization after saving it?",
        answer:
          "Yes. Every save creates a version in the document's history. You can browse earlier states and restore the one before the mishap, which makes the operation risk-free even on an important file.",
      },
      {
        question: "What happens to deleted pages?",
        answer:
          "They leave the current version of the document but remain inside earlier versions in the history. And if you delete an entire document by mistake, the trash keeps it for 30 days before permanent removal.",
      },
    ],
    useCases: [
      "Put a scan back in order when its pages came out shuffled or upside down",
      "Tidy a file before sending: drop blank pages, duplicates, and drafts",
      "Rebuild a document from several sources, then order it visually",
    ],
    relatedTools: ["merge-pdf", "split-pdf", "edit-pdf"],
    relatedSolutions: ["real-estate", "accountants", "human-resources"],
    icon: "layout-grid",
  },
  {
    slug: "annotate-pdf",
    appHref: "/documents",
    name: "Annotate PDF",
    category: "edit",
    metaTitle: "Annotate PDF Online: Highlight & Comment | GigaPDF",
    metaDescription:
      "Highlight, comment, and draw on PDFs with native annotations readable in any viewer. Free, open source, with real-time collaboration.",
    h1: "Annotate a PDF: highlight, comment, draw",
    intro: [
      "Reviewing a contract, marking up a thesis, commenting on a mockup: working on a document is mostly working in the margins. Printing to annotate by hand, then rescanning, throws away searchable text and image quality; commenting in a separate email cuts the remarks off from their context. Annotating directly in the PDF keeps every comment exactly where it belongs.",
      "GigaPDF writes native annotations to the PDF standard: highlights, notes, free text, shapes, and freehand strokes are saved as conforming annotation objects, never flattened into an image. In practice, your marks remain visible and listed in Adobe Reader, in macOS Preview, in a browser — and the recipient can answer with their own tool, whether or not they use GigaPDF.",
      "Real-time collaboration adds the team dimension: several reviewers annotate the same document at once and watch each other's marks appear live. With link sharing and version history from the document manager, the whole review cycle happens in one place, with zero attachments.",
    ],
    howTo: {
      title: "How to annotate a PDF document",
      steps: [
        "Open the PDF in the GigaPDF editor.",
        "Highlight the key passages by selecting the text.",
        "Add notes and comments wherever something needs saying.",
        "Draw when words aren't enough: arrows, boxes, and freehand strokes to point at a visual detail.",
        "Share the document by link: your annotations show in every viewer, and the team can annotate live together.",
      ],
    },
    capabilities: [
      "Text highlighting with a choice of colors",
      "Notes and comments pinned to the exact spot they concern",
      "Free text, shapes, and freehand drawing on the page",
      "Native standard-PDF annotations, readable in every viewer",
      "Live multi-user annotation on the same file",
      "Link or email sharing and built-in version history",
    ],
    faq: [
      {
        question: "Will my annotations show up in Adobe Reader?",
        answer:
          "Yes. GigaPDF saves native annotations that conform to the PDF standard: Adobe Reader, macOS Preview, browsers, and other viewers display them and list them in their comments panel. Nothing is proprietary or locked into the platform.",
      },
      {
        question: "Can several people annotate at the same time?",
        answer:
          "Yes, it's one of GigaPDF's strong points: real-time collaboration lets several reviewers open the same document and watch each other's annotations appear live, with no version conflicts and no manual merging of comments.",
      },
      {
        question: "What's the difference between annotating and editing a PDF?",
        answer:
          "Annotation sits on top of the content without altering it: it's the review layer, listable and attributable. Editing changes the content itself — fixing the text, swapping an image. GigaPDF does both in the same editor, but the distinction matters: you annotate a proposal, you edit your own document.",
      },
      {
        question: "Can I lock annotations so they can no longer be changed?",
        answer:
          "Yes, that's what flattening is for, available in GigaPDF's forms tool: it fuses annotations into the page content. They stay visible but stop being separate editable objects — useful before archiving or final distribution.",
      },
    ],
    useCases: [
      "Review a contract as a team, highlighting the clauses to renegotiate",
      "Grade papers or theses with margin notes, without printing a single page",
      "Comment on an inspection report or a floor plan directly on the reference document",
    ],
    relatedTools: ["edit-pdf", "watermark-pdf", "pdf-forms"],
    relatedSolutions: ["students", "teachers-trainers", "architects-construction"],
    icon: "highlighter",
  },
  {
    slug: "pdf-forms",
    appHref: "/documents",
    name: "PDF Forms",
    category: "edit",
    metaTitle: "Fill Out PDF Forms Online Free | GigaPDF",
    metaDescription:
      "Fill out PDF form fields in your browser and flatten the result to lock in your answers. Free and open source.",
    h1: "Fill out and flatten PDF forms",
    intro: [
      "Interactive PDF forms — AcroForm fields with text boxes, checkboxes, and dropdowns — are everywhere in administrative life: official applications, registration forms, onboarding paperwork. You still need a tool that fills them properly: plenty of free viewers display the fields but lose your entries on save, or push you back to print-and-rescan.",
      "GigaPDF reads the form's structure, presents every field for input in the browser, and writes the values into the file according to the standard. Then comes the third operation, often the decisive one: flattening. It fuses the filled fields into the page content — your answers become permanent material that can't be changed with a casual click in the field. That step is what separates a form draft from a document ready to submit.",
      "For organizations, reading fields through the API opens up automation: extract the values from incoming forms without retyping anything. The free plan covers filling, flattening, and 1,000 API calls a month; self-hosting keeps sensitive forms on your own infrastructure.",
    ],
    howTo: {
      title: "How to fill out a PDF form",
      steps: [
        "Upload the PDF form to your workspace.",
        "Open it: interactive fields (text, checkboxes, lists) are detected automatically.",
        "Type your answers directly in the browser.",
        "Save the values into the file, or flatten the form to lock the answers in for good.",
        "Download, share by link, or add a digital signature to the completed document.",
      ],
    },
    capabilities: [
      "Detection and reading of form fields (AcroForm)",
      "In-browser filling: text, checkboxes, dropdowns",
      "Values saved in conformance with the PDF standard",
      "Flattening: answers fused into the page, no longer editable",
      "Field values extracted through the API for automated processing",
      "Natural hand-off to PKCS#7 digital signing",
    ],
    faq: [
      {
        question: "Why flatten a form after filling it?",
        answer:
          "As long as the fields stay interactive, any recipient can change your answers with one click. Flattening turns the entered values into permanent page content: the document freezes exactly as you completed it. It's the right move before official submission or archiving.",
      },
      {
        question: "What about a non-interactive form — a scanned page with blank lines?",
        answer:
          "Without AcroForm fields there is nothing for form filling to grab — but the GigaPDF editor takes over: drop text boxes over the document's lines, position them precisely, and save. The result is equivalent to a completed form.",
      },
      {
        question: "Are dropdowns and checkboxes handled?",
        answer:
          "Yes. GigaPDF reads the field types defined by the standard: text boxes, checkboxes, radio buttons, and lists. Each one behaves in the browser like a web form control, and the value is written into the file on save.",
      },
      {
        question: "Can I collect the answers from forms people send me, automatically?",
        answer:
          "Yes, through the API: field reading returns the entered values in structured form, which kills the retyping when you receive dozens of identical forms. The free plan includes 1,000 API calls a month — enough to automate a steady flow.",
      },
    ],
    useCases: [
      "Complete administrative or onboarding paperwork without a printer or scanner",
      "Flatten a form's answers before an official submission",
      "Collect filled forms and extract their values automatically over the API",
    ],
    relatedTools: ["sign-pdf", "edit-pdf", "annotate-pdf"],
    relatedSolutions: ["human-resources", "nonprofits", "real-estate"],
    icon: "clipboard-list",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    category: "convert",
    appHref: "/pdf-to-word",
    metaTitle: "Convert PDF to Word (DOCX) Online Free | GigaPDF",
    metaDescription:
      "Turn PDFs into editable Word documents (.docx) with layout preserved. Free conversion, open source, no watermark.",
    h1: "Convert a PDF into an editable Word document",
    intro: [
      "PDF freezes, Word frees: when a document needs a full rework — restructuring a report, reusing the clauses of a template contract, starting from an existing outline — spot edits stop being enough and you need a word-processor file again. PDF-to-DOCX conversion rebuilds the document in a format where every element becomes workable.",
      "GigaPDF analyzes the PDF's structure — text blocks, paragraphs, images, tables — and produces a .docx that opens in Word, your office suite, or Google Docs. Faithful conversion takes real reconstruction work: keeping paragraphs flowing instead of spitting out one text box per line, leaving images where they belong, returning tables as tables. That is what the conversion engine aims for, running server-side.",
      "One case deserves a callout: scanned PDFs. With no digital text, there is nothing to convert — run the document through GigaPDF's multilingual OCR first, then convert. The scan → OCR → DOCX chain turns digitized paper into a workable Word file, all inside the same platform, free of charge.",
    ],
    howTo: {
      title: "How to convert a PDF to Word",
      steps: [
        "Upload the PDF you want to convert.",
        "If it's a scan, run OCR first to recognize the text.",
        "Pick the DOCX export in the conversion menu.",
        "The engine rebuilds paragraphs, images, and tables into the Word file.",
        "Download the .docx and open it in Word, your office suite, or Google Docs.",
      ],
    },
    capabilities: [
      "DOCX export compatible with Word, office suites, and Google Docs",
      "Reconstruction of paragraphs, images, and tables",
      "Server-side conversion, no local install",
      "Scan → OCR → DOCX chain for digitized documents",
      "No watermark on the converted file",
      "More exports from the same menu: ODT, TXT, HTML, PNG, JPEG",
    ],
    faq: [
      {
        question: "Will the layout match the original exactly?",
        answer:
          "The goal is maximum fidelity, but let's be honest: PDF and DOCX describe documents differently, and heavily designed layouts (nested columns, text over images, design brochures) may need touch-ups after conversion. Standard text documents — reports, contracts, letters — convert very cleanly.",
      },
      {
        question: "Can I convert a scanned PDF to Word?",
        answer:
          "Yes, in two steps: OCR first, conversion second. A scan contains nothing but images; GigaPDF's multilingual in-house OCR extracts the text, which then feeds the DOCX conversion. Skip that step and the Word file would hold only page images.",
      },
      {
        question: "Do the PDF's tables stay tables in Word?",
        answer:
          "Detected tabular structures come back as Word tables, editable cell by cell. Very intricate tables — cascading merged cells, tables drawn without real structure — may be partially simplified; a quick visual check after conversion is wise on those.",
      },
      {
        question: "Is there a size limit or a watermark on the free conversion?",
        answer:
          "No watermark, ever. Conversion is a full feature of the free plan, whose limits are storage (5 GB) and document count (1000) — never a degraded output. The file you get is yours, clean.",
      },
    ],
    useCases: [
      "Recover a contract or report whose source file is long gone",
      "Reuse the content of a PDF manual in a new Word deliverable",
      "Turn scanned letters into editable documents via OCR plus conversion",
    ],
    relatedTools: ["word-to-pdf", "ocr-pdf", "pdf-to-odt"],
    relatedSolutions: ["freelancers", "students", "lawyers"],
    icon: "file-text",
  },
  {
    slug: "word-to-pdf",
    name: "Word to PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convert Word to PDF Online (.doc, .docx) | GigaPDF",
    metaDescription:
      "Convert Word documents to faithful PDFs with the in-house engine: modern .docx and legacy .doc. Free, open source, no watermark.",
    h1: "Convert a Word document to PDF",
    intro: [
      "Sending a .docx means sending a living document: it will render differently depending on the recipient's Word version, installed fonts, and machine — when it isn't simply modified along the way. Converting to PDF locks the layout: what you composed is exactly what gets read and printed, everywhere.",
      "GigaPDF converts with its in-house office conversion engine running server-side, battle-tested and faithful. It handles modern .docx, the old binary .doc — the Word 97-2003 format that haunts every file server and that many online converters turn away — and OpenDocument .odt for the free-software crowd. Styles, tables, images, headers, and footers come out in a clean PDF with no advertising stamped on it.",
      "You need neither Microsoft Office nor any installation: the browser is enough. The resulting PDF lands straight in your GigaPDF document manager, where it can be merged with other files, digitally signed, encrypted, or archived as PDF/A — conversion is just the first link in a complete document chain.",
    ],
    howTo: {
      title: "How to convert a Word file to PDF",
      steps: [
        "Upload your .docx, .doc, or .odt file to your workspace.",
        "Run the conversion: the in-house engine renders the document server-side.",
        "Check the resulting PDF in the built-in viewer.",
        "Chain the next step if needed: merging, signing, encryption, or watermarking.",
        "Download the PDF or share it by link straight from the document manager.",
      ],
    },
    capabilities: [
      "Conversion of .docx, legacy .doc (Word 97-2003), and OpenDocument .odt",
      "In-house conversion engine server-side: no install, no Microsoft Office required",
      "Faithful rendering of styles, tables, images, headers, and footers",
      "No watermark on the output PDF",
      "Immediate chaining: merge, digital signature, encryption, PDF/A",
      "Other office formats accepted by the same flow: Excel, PowerPoint, OpenDocument",
    ],
    faq: [
      {
        question: "Which Word formats are supported — .doc, .docx, .odt?",
        answer:
          "All three. The in-house engine reads the binary Word 97-2003 format (.doc) alongside modern .docx, and it also takes OpenDocument text (.odt). Old office archives convert without a manual round-trip through Word, and free-software users skip the detour entirely — valuable when cleaning up a mixed document backlog.",
      },
      {
        question: "Will my document's layout be respected?",
        answer:
          "The in-house engine renders the vast majority of documents faithfully: styles, tables, anchored images, headers, footers, and numbering. Documents relying on proprietary fonts that aren't embedded, or on display macros, can drift slightly; a glance at the PDF in the built-in viewer settles it.",
      },
      {
        question: "Can I convert several Word documents in a row?",
        answer:
          "Yes. Upload your files in batches and convert them one after the other; through the API, the operation automates for recurring flows (1,000 calls a month included free). Every PDF produced is filed in your document manager, taggable and searchable.",
      },
      {
        question: "Can the resulting PDF still be edited?",
        answer:
          "Yes, twice over: you keep the original Word file in your workspace, and the PDF itself stays editable in GigaPDF's WYSIWYG editor for spot fixes — correcting a date, removing a mention — without regenerating the whole document.",
      },
    ],
    useCases: [
      "Freeze a CV, quote, or contract before sending, identical on every screen",
      "Batch-convert old .doc archives into readable PDFs",
      "Prepare Word documents for digital signing: convert, then PKCS#7 in one flow",
    ],
    relatedTools: ["pdf-to-word", "excel-to-pdf", "powerpoint-to-pdf", "sign-pdf"],
    relatedSolutions: ["freelancers", "human-resources", "nonprofits"],
    icon: "file-input",
  },
  {
    slug: "excel-to-pdf",
    name: "Excel to PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convert Excel to PDF Online (.xls, .xlsx) | GigaPDF",
    metaDescription:
      "Turn Excel workbooks into clean, printable PDFs with the in-house engine: .xlsx and legacy .xls. Free, open source conversion.",
    h1: "Convert an Excel workbook to PDF",
    intro: [
      "A spreadsheet sent as .xlsx is a liability: formulas on display, forgotten working tabs, hidden columns one click away from being revealed, and a layout that explodes when the recipient hits print. To communicate numbers — a quote, a dashboard, a budget — a PDF shows the result, only the result, framed exactly as intended.",
      "GigaPDF converts your workbooks with its in-house engine on the server: both .xlsx and the legacy .xls (Excel 97-2003) are accepted, computed values stand in for the formulas, and the print area defined in the workbook drives the PDF's pagination. Borders, cell colors, charts, and number formats come out the way the spreadsheet displays them.",
      "A tip inherited from print: the PDF's quality is decided inside the workbook, before converting. A defined print area, landscape orientation for wide tables, and a fit-to-one-page-wide setting produce a sharp final document. Once converted, the PDF merges with your other files, takes a password, or gets watermarked — all without leaving GigaPDF, for free.",
    ],
    howTo: {
      title: "How to convert an Excel file to PDF",
      steps: [
        "Prepare the workbook: print area and orientation set in your spreadsheet app.",
        "Upload the .xlsx or .xls file to your workspace.",
        "Run the conversion: the in-house engine computes the rendering and paginates the document.",
        "Inspect the PDF in the viewer: column breaks, legibility of the figures.",
        "Download, merge with other files, or share the PDF by link.",
      ],
    },
    capabilities: [
      "Conversion of .xlsx and legacy .xls (Excel 97-2003)",
      "Computed values in the PDF: formulas are never exposed",
      "Print areas and orientation from the workbook are honored",
      "Borders, colors, charts, and number formats rendered as displayed",
      "OpenDocument spreadsheets (.ods) handled by the same engine",
      "Merge, protect, and watermark the resulting PDF on the same platform",
    ],
    faq: [
      {
        question: "How do I keep a wide table from being chopped across pages?",
        answer:
          "Fix it in the workbook before converting: landscape orientation and a fit-to-one-page-wide setting in your spreadsheet's page layout options. The in-house engine applies those settings during conversion; a table with no layout defined gets default pagination, breaks included.",
      },
      {
        question: "Do my workbook's formulas appear in the PDF?",
        answer:
          "No, and that's one of the main reasons to convert: the PDF carries the computed values, not the formulas. Your calculation methods, working assumptions, and cell references stay in the source file, which stays with you.",
      },
      {
        question: "Are all the workbook's sheets converted?",
        answer:
          "Conversion follows the workbook's print configuration. To publish a single summary tab, set it as the print area before uploading — or delete the surplus pages from the PDF afterwards with GigaPDF's page-organization tool.",
      },
      {
        question: "Are Excel charts preserved?",
        answer:
          "Yes, charts render in the PDF exactly as they appear in the workbook. They become fixed graphics, which is the point — the recipient sees the curve, not the underlying data or the hidden series.",
      },
    ],
    useCases: [
      "Send a quote or budget without exposing formulas and pricing assumptions",
      "Freeze a monthly dashboard as a PDF for distribution and archiving",
      "Attach cleanly paginated financial annexes to a merged report",
    ],
    relatedTools: ["word-to-pdf", "powerpoint-to-pdf", "merge-pdf"],
    relatedSolutions: ["accountants", "freelancers", "nonprofits"],
    icon: "file-spreadsheet",
  },
  {
    slug: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convert PowerPoint to PDF (.ppt, .pptx) | GigaPDF",
    metaDescription:
      "Convert PowerPoint decks to faithful PDFs with the in-house engine: .pptx and legacy .ppt. Free, open source, no watermark.",
    h1: "Convert a PowerPoint presentation to PDF",
    intro: [
      "A deck sent as .pptx rarely arrives intact: substituted fonts, animations that make no sense at a standstill, slides shifting between PowerPoint versions — and a file anyone can edit. The deck that circulates after the meeting deserves better: a PDF where every slide is fixed exactly as you designed it.",
      "GigaPDF relies on its in-house engine server-side to convert .pptx as well as the older .ppt (PowerPoint 97-2003). Each slide becomes one PDF page: backgrounds, images, diagrams, and text blocks land at their exact positions. Animations and transitions, which belong to slideshow mode, are naturally absent from the fixed output — each slide is rendered in its final state.",
      "The resulting PDF is lighter to distribute than an image-heavy .pptx, opens on any device without PowerPoint, and prints properly. Need the reverse trip? GigaPDF also exports PDF to PPTX, handy for reviving an old deck whose source file vanished — both directions ship with the free plan.",
    ],
    howTo: {
      title: "How to convert a PowerPoint to PDF",
      steps: [
        "Upload your .pptx or .ppt presentation to your workspace.",
        "Run the conversion: the in-house engine renders each slide as a PDF page.",
        "Review the output in the viewer: fonts, images, and diagrams in place.",
        "Add a watermark or protection if the deck needs it before going out.",
        "Download the PDF or share it by link, readable without PowerPoint.",
      ],
    },
    capabilities: [
      "Conversion of .pptx and legacy .ppt (PowerPoint 97-2003)",
      "One slide = one PDF page, at the exact layout",
      "Backgrounds, images, diagrams, and text boxes rendered in place",
      "Reverse conversion available: export a PDF to PPTX",
      "OpenDocument presentations (.odp) handled by the same engine",
      "Watermark, protection, and link sharing on the same platform",
    ],
    faq: [
      {
        question: "What happens to my presentation's animations and transitions?",
        answer:
          "They go away, by nature: a PDF is a fixed medium with no slideshow mode. Each slide is rendered in its final state, all elements visible. If a slide reveals blocks progressively, check that their final stacking stays readable once frozen.",
      },
      {
        question: "Will my deck's special fonts be respected?",
        answer:
          "Embedded and standard fonts render faithfully. An exotic font missing on the conversion engine gets swapped for the closest match — just as PowerPoint would on a machine lacking it. A few seconds in the preview viewer is enough to confirm.",
      },
      {
        question: "Can I convert a PDF into PowerPoint, the other way around?",
        answer:
          "Yes. GigaPDF offers PDF-to-PPTX export: each page becomes a slide again, texts and images included, editable in PowerPoint or your presentation app. It's the way out when a deck's source file is lost and the content has to evolve.",
      },
      {
        question: "Is the PDF lighter than the original presentation?",
        answer:
          "Often, yes: the PDF carries no animations, no unused media, no stacks of slide masters. And if the output is still heavy — photo-rich decks — GigaPDF's in-house compression takes another pass at it.",
      },
    ],
    useCases: [
      "Hand out the deck after a training session or talk, fixed and readable anywhere",
      "Archive client presentations as searchable, versioned PDFs in the document manager",
      "Print a slide set cleanly for a meeting without a projector",
    ],
    relatedTools: ["word-to-pdf", "excel-to-pdf", "compress-pdf", "watermark-pdf"],
    relatedSolutions: ["teachers-trainers", "freelancers", "nonprofits"],
    icon: "presentation",
  },
  {
    slug: "opendocument-pdf",
    name: "OpenDocument & PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convert OpenDocument to PDF (ODT, ODS, ODP) | GigaPDF",
    metaDescription:
      "Convert ODT, ODS, and ODP to PDF — and go back from PDF to ODT or ODP. The OpenDocument-to-PDF bridge, free and open source.",
    h1: "OpenDocument to PDF and back: ODT, ODS, ODP",
    intro: [
      "Public administrations and organizations committed to free software work in OpenDocument: .odt texts, .ods spreadsheets, .odp presentations. An open, ISO-standardized format — but a minority one next to the Microsoft ecosystem, which complicates exchanges: recipients don't always have an OpenDocument-compatible suite, and most online converters flatly ignore these formats.",
      "GigaPDF treats them as first-class citizens, for a structural reason: its in-house conversion engine handles OpenDocument natively, running server-side. All three formats convert to PDF with native fidelity — styles, tables, charts, and layouts rendered without the approximations of a third-party converter. The return trip exists too: a PDF exports to ODT to rework the text, or to ODP to pick a presentation back up, closing the loop with your free-software office suite.",
      "That open-source consistency runs the full length of the chain: GigaPDF is published as source-available under PolyForm Noncommercial and self-hosts. An organization that favors open, auditable software for its office suite can make the same choice for its document platform — conversion, editing, signing, and document management included, with no proprietary service in the loop.",
    ],
    howTo: {
      title: "How to convert between OpenDocument and PDF",
      steps: [
        "Upload your .odt, .ods, or .odp file to your workspace.",
        "Run the PDF conversion: the server-side in-house engine renders the document as-is.",
        "Check the output in the built-in viewer.",
        "For the reverse direction, open a PDF and export it as ODT (text) or ODP (slides).",
        "File, share, or sign the result directly in the document manager.",
      ],
    },
    capabilities: [
      "PDF conversion of .odt texts, .ods spreadsheets, and .odp presentations",
      "Native in-house engine server-side: maximum OpenDocument fidelity",
      "Reverse export from PDF to ODT and ODP to rework content",
      "Spreadsheets: PDF data exported to XLSX, usable in your spreadsheet app",
      "No watermark; conversion included in the free plan",
      "Source-available platform you can self-host: an open document chain end to end",
    ],
    faq: [
      {
        question: "Why is OpenDocument conversion more reliable here than elsewhere?",
        answer:
          "Because GigaPDF converts with its in-house engine — built for the OpenDocument format — running on the server. Where other services go through approximate reinterpretation libraries (when they accept these formats at all), GigaPDF uses native rendering: what the office suite displays is what the PDF contains.",
      },
      {
        question: "Can I convert a PDF back into an editable OpenDocument file?",
        answer:
          "Yes for texts and presentations: the ODT export rebuilds an editable text document and the ODP export produces slides you can pick up in Impress. For tabular data inside a PDF, the export goes to XLSX, which your spreadsheet app opens and re-saves as .ods natively.",
      },
      {
        question: "Do .ods files with charts and formulas come out right?",
        answer:
          "Yes: spreadsheets convert with their computed values, cell formats, and charts, following the defined print area. As with Excel, the formulas stay in the source file — the PDF shows results, not the machinery.",
      },
      {
        question: "Is GigaPDF a fit for an administration under sovereignty constraints?",
        answer:
          "It's one of its natural habitats: auditable source code, full self-hosting on your servers, open formats in and out. No document ever needs to pass through a third-party cloud, and no proprietary license enters the chain.",
      },
    ],
    useCases: [
      "Publish OpenDocument files as PDFs for recipients without the suite",
      "Recover as ODT a PDF whose source file is gone, without detouring through Word",
      "Equip a fully free-software organization: an OpenDocument suite plus self-hosted GigaPDF",
    ],
    relatedTools: ["pdf-to-odt", "word-to-pdf", "pdf-a"],
    relatedSolutions: ["nonprofits", "students", "healthcare"],
    icon: "file-stack",
  },
  {
    slug: "pdf-to-odt",
    name: "PDF to ODT",
    category: "convert",
    appHref: "/pdf-to-odt",
    metaTitle: "Convert PDF to ODT (OpenDocument) | GigaPDF",
    metaDescription:
      "Turn a PDF into an editable ODT for your word processor, text and images carried over. Free, open source conversion.",
    h1: "Convert a PDF to ODT, editable in your OpenDocument suite",
    intro: [
      "If you work in an OpenDocument suite, converting a PDF to .docx is an absurd detour: you then have to import the Word file into your word processor, adding another conversion layer and its inevitable drift. GigaPDF gives you the straight path: PDF to ODT, the native format of OpenDocument word processors, in one transformation.",
      "The engine analyzes the PDF — paragraphs, images, page structure — and rebuilds an OpenDocument text file: the text becomes editable paragraphs with their attributes, images return to their place, and the file opens in Writer like any other .odt, ready to be restyled with your templates. For scanned PDFs, the built-in in-house OCR (multilingual engine) supplies the text first; the conversion does the rest.",
      "The choice of format is not cosmetic: ODT is an open ISO standard (ISO 26300), readable today and in twenty years, with no vendor dependency. GigaPDF — open source, self-hostable, watermark-free — is the logical companion: your documents move from the frozen format back to the free one, with free tools.",
    ],
    howTo: {
      title: "How to convert a PDF to ODT",
      steps: [
        "Upload the PDF to your workspace.",
        "If it's a scanned document, apply OCR first to recognize the text.",
        "Pick the ODT export in the conversion menu.",
        "The engine rebuilds paragraphs and images into an OpenDocument file.",
        "Open the .odt in your word processor and pick up the writing.",
      ],
    },
    capabilities: [
      "Native ODT export, no detour through the Word format",
      "Rebuilt editable paragraphs and carried-over images",
      "Scan → in-house OCR → ODT chain for digitized documents",
      "OpenDocument-conformant file, opened by Writer and any compatible editor",
      "No watermark on the converted document",
      "Other exports in the same spot: DOCX, ODP, TXT, HTML",
    ],
    faq: [
      {
        question: "Why convert straight to ODT instead of DOCX then opening in Writer?",
        answer:
          "Every format conversion brings its own approximations. Going through DOCX stacks a second one on top: PDF to DOCX, then DOCX into Writer's internal model. GigaPDF's direct ODT export performs just one, into the format Writer speaks natively — less drift, less rework.",
      },
      {
        question: "Does the converted document keep its formatting?",
        answer:
          "The text returns with its essential attributes — size, weight, alignment — and the images at their positions. As with any conversion out of PDF, a very graphic document may need touch-ups in Writer; a report, a letter, or a contract usually picks up straight away.",
      },
      {
        question: "Can I convert a scan to ODT?",
        answer:
          "Yes, by chaining two GigaPDF tools: OCR first, which recognizes the scan's text across many languages and scripts, then the ODT export, which structures it into a Writer document. Without the OCR step, a scan has no text to convert.",
      },
      {
        question: "Is the resulting ODT file standard?",
        answer:
          "Yes: it's a conformant OpenDocument file, readable by any OpenDocument suite and any software honoring the ISO 26300 standard — including Word, which opens .odt files. You're locked into neither GigaPDF nor any vendor.",
      },
    ],
    useCases: [
      "Pick up in Writer an official document that was only published as a PDF",
      "Bring old PDF deliverables back into an OpenDocument editorial pipeline",
      "Convert scanned letters into reworkable ODT files through the built-in OCR",
    ],
    relatedTools: ["opendocument-pdf", "pdf-to-word", "ocr-pdf"],
    relatedSolutions: ["nonprofits", "students", "lawyers"],
    icon: "file-output",
  },
  {
    slug: "html-to-pdf",
    name: "HTML to PDF",
    category: "convert",
    appHref: "/html-to-pdf",
    metaTitle: "Convert HTML or a Web Page to PDF | GigaPDF",
    metaDescription:
      "Convert HTML or a URL to PDF rendered by the in-house engine: modern CSS, web fonts, long pages. Free, open source, with an API.",
    h1: "Convert HTML or a web page to PDF",
    intro: [
      "The web has become the source of most documents: invoices generated by applications, order confirmations, articles, reports produced by internal tools. Freezing them as PDFs — to archive, to prove, to send — demands an exact rendering. Modern HTML (flexbox, grid, web fonts, JavaScript-injected content) is far beyond what lightweight conversion libraries can reproduce.",
      "GigaPDF attacks the problem from the right end: rendering is handled by its in-house HTML/CSS engine, driven server-side. You supply HTML code or simply a URL; the page is loaded, styles applied, web fonts fetched, and the document is printed to PDF exactly as the browser would do it. What you see online is what the file contains.",
      "It's also a first-rate automation tool: through the GigaPDF API (1,000 calls a month in the free plan), your applications generate their invoices, certificates, and reports by sending HTML — the most universal templating language there is — and get back PDFs ready to archive in the document manager. Self-hosted, the whole chain runs on your servers.",
    ],
    howTo: {
      title: "How to convert a web page to PDF",
      steps: [
        "Provide the source: a public URL or your complete HTML code.",
        "The in-house engine loads the page server-side: CSS, web fonts, and layout applied.",
        "The rendering is printed to PDF, faithful to the browser display.",
        "Collect the document in your workspace, ready to file or share.",
        "To automate, call the same conversion from your applications over the API.",
      ],
    },
    capabilities: [
      "In-house HTML/CSS rendering: faithful to the web, not an approximation",
      "Conversion from a URL or from supplied HTML code",
      "Modern CSS support (flexbox, grid) and web fonts",
      "Automated generation over the API: invoices, certificates, reports",
      "PDF filed straight into the document manager: folders, tags, search, sharing",
      "Runs entirely on your servers when self-hosted",
    ],
    faq: [
      {
        question: "Why does the in-house HTML/CSS rendering make the difference?",
        answer:
          "Because lightweight HTML converters implement a dated subset of CSS: flexbox and grid layouts collapse, web fonts go missing, JavaScript never runs. GigaPDF's in-house engine handles modern CSS, web fonts, and JavaScript execution — the PDF faithfully matches what a browser shows.",
      },
      {
        question: "Can I generate my invoices as PDFs automatically?",
        answer:
          "Yes, it's the textbook use case: your application builds the invoice in HTML (a template with your styles), posts it to the GigaPDF API, and receives the PDF. The free plan includes 1,000 API calls a month; the document can be archived, protected, or digitally signed in the same flow.",
      },
      {
        question: "Can pages behind a login be converted?",
        answer:
          "URL conversion loads the page as it is publicly reachable: content behind authentication won't appear. The robust route is to supply the HTML directly — your application has the data and can build the complete document before conversion.",
      },
      {
        question: "How do I control the pagination of the resulting PDF?",
        answer:
          "With standard print CSS, which the in-house engine honors: page-break and break-inside properties to govern the cuts, @media print rules to adapt styles, @page for margins. A well-prepared HTML template yields precisely paginated PDFs, reproducible on every run.",
      },
    ],
    useCases: [
      "Auto-generate invoices and certificates as PDFs from your applications via the API",
      "Archive a web page — an article, a listing, terms in force — exactly as displayed on a given date",
      "Produce PDF reports from styled HTML templates, identical on every run",
    ],
    relatedTools: ["pdf-a", "compress-pdf", "protect-pdf"],
    relatedSolutions: ["freelancers", "real-estate", "accountants"],
    icon: "globe",
  },
  {
    slug: "pdf-a",
    name: "PDF/A",
    category: "organize",
    appHref: "/pdf-a",
    metaTitle: "Convert PDF to PDF/A for Archiving | GigaPDF",
    metaDescription:
      "Convert PDFs to the PDF/A-1b or PDF/A-2b archival format, ISO 19005 compliant. Free, open source, and self-hostable.",
    h1: "Convert a PDF to PDF/A for long-term archiving",
    intro: [
      "An ordinary PDF promises nothing over time: fonts that aren't embedded and will render differently in ten years, content depending on external resources, dynamic elements. For documents that carry obligations — contracts, invoices, regulatory filings — the ISO 19005 standard defined PDF/A: a restricted PDF profile where everything needed for display lives inside the file, permanently.",
      "GigaPDF converts your documents to two conformance levels: PDF/A-1b, the historic profile most often demanded by public bodies, and PDF/A-2b, more recent, which allows JPEG2000 compression and transparency — frequently the better pick for contemporary documents. The conversion embeds the fonts, normalizes color spaces, and writes the XMP conformance metadata that validators check.",
      "Compliant archiving is often a hard requirement: public procurement, invoice retention rules, e-filing procedures, and electronic archiving systems demand PDF/A at the door. With GigaPDF, conformance is a one-click operation — or an API call to handle whole flows — included in the free plan and runnable on your own infrastructure.",
    ],
    howTo: {
      title: "How to convert a document to PDF/A",
      steps: [
        "Upload the PDF that needs to be made compliant.",
        "Choose the target level: PDF/A-1b (the classic requirement) or PDF/A-2b (the newer profile).",
        "Run the conversion: fonts embedded, colors normalized, conformance metadata written.",
        "Retrieve the compliant file, ready for submission or your archiving system.",
        "Keep the original in the document manager: versions, tags, and full-text search stay on.",
      ],
    },
    capabilities: [
      "Conversion to PDF/A-1b and PDF/A-2b (ISO 19005)",
      "Fonts embedded in the file: identical display over time",
      "Color spaces normalized and XMP conformance metadata written",
      "One-click single documents or whole flows via the API",
      "Pairs with OCR: a scan becomes a compliant, searchable archive",
      "Self-hosting available for strict internal archiving policies",
    ],
    faq: [
      {
        question: "PDF/A-1b or PDF/A-2b: which one should I choose?",
        answer:
          "Follow the recipient's requirement first: if an authority or archiving system mandates a level, the question is settled. Otherwise, PDF/A-2b is generally preferable for current documents — it accepts transparency and more efficient compression — while PDF/A-1b remains the safe bet against older systems.",
      },
      {
        question: "What actually changes inside my file?",
        answer:
          "Everything that would make display depend on the outside world gets resolved: fonts are embedded, colors bound to an explicit profile, conformance metadata written in XMP. Content the standard forbids — dynamic elements, external dependencies — is neutralized. Visually, the document stays the same.",
      },
      {
        question: "Is a PDF/A still editable or signable?",
        answer:
          "PDF/A is still a PDF: technically readable and editable everywhere. The spirit of archiving is to freeze the document — and best practice is to sign it digitally (PKCS#7, available in GigaPDF): any later modification becomes detectable, adding an integrity guarantee to the durability one.",
      },
      {
        question: "Can a scan be made PDF/A compliant and searchable at once?",
        answer:
          "Yes, that's the ideal archiving chain in GigaPDF: in-house OCR to recognize the text, the invisible searchable layer to make it usable, then PDF/A conversion. The final document is durable, compliant, and queryable in full text all at once.",
      },
    ],
    useCases: [
      "Bring invoices and accounting records to the format required for legal retention",
      "Submit compliant documents to e-filing systems and public procurement portals",
      "Build durable firm archives: OCR plus PDF/A plus digital signature",
    ],
    relatedTools: ["sign-pdf", "ocr-pdf", "searchable-pdf", "protect-pdf"],
    relatedSolutions: ["lawyers", "accountants", "healthcare"],
    icon: "archive",
  },
  {
    slug: "universal-merge",
    name: "Universal Merge",
    category: "organize",
    metaTitle: "Universal Merge: Combine Any Files into One PDF",
    metaDescription:
      "Merge PDFs, Word, Excel, PowerPoint, OpenDocument, images, HTML, and text into a single PDF. Each file is converted then combined. Free, open source.",
    h1: "Universal Merge: turn a pile of mixed files into one PDF",
    intro: [
      "Real-world bundles are never made of PDFs alone. A grant application mixes a Word cover letter, an Excel budget, two scanned attestations as JPGs, and a PDF activity report. A handover folder stacks a PowerPoint, an ODT note, and a screenshot. Ordinary merge tools refuse everything that isn't already a PDF, so you end up converting each file by hand, one site at a time, before you can even start combining.",
      "Universal Merge collapses that whole chore into a single step. Drop in anything — PDF, Word (.doc, .docx, .odt), Excel (.xls, .xlsx, .ods), PowerPoint (.ppt, .pptx, .odp), images (JPG, PNG, GIF, WebP, AVIF), HTML, plain text — and GigaPDF converts each non-PDF to PDF with its in-house engine, then assembles all of them into one continuously paginated document, in the order you set. It is the flagship of the platform: the conversion tools and the merge engine working as one.",
      "The result lands in your document manager like any other PDF — taggable, searchable in full text, shareable by link — and every step runs on GigaPDF's own engine with no third-party service in the loop. Universal Merge ships with the free plan, and since the code is source-available under PolyForm Noncommercial, the entire pipeline can run on your own server.",
    ],
    howTo: {
      title: "How to merge mixed files into one PDF",
      steps: [
        "Upload your files of any kind: PDFs, Office documents, OpenDocument files, images, HTML, or text.",
        "Each non-PDF file is converted to PDF automatically by the in-house engine.",
        "Drag the files into the final assembly order.",
        "Run Universal Merge: every piece is combined into one continuously paginated PDF.",
        "Refine the page order in the editor if needed, then file or share the result.",
      ],
    },
    capabilities: [
      "Combine any mix of formats into a single PDF in one operation",
      "Auto-conversion of Word, Excel, PowerPoint, and OpenDocument files",
      "Images (JPG, PNG, WebP), HTML, and text folded into the same merge",
      "Drag-and-drop ordering before assembly, page-level reordering after",
      "Everything rendered by the in-house engine, no third-party service",
      "Result filed in the document manager: folders, tags, full-text search",
    ],
    faq: [
      {
        question: "Which file types can I throw into a Universal Merge?",
        answer:
          "PDFs, of course, plus Word (.doc, .docx, .odt), Excel (.xls, .xlsx, .ods), PowerPoint (.ppt, .pptx, .odp), images (JPG, PNG, WebP), HTML, and plain text. Anything that isn't already a PDF is converted to PDF first by GigaPDF's in-house engine, then merged with the rest.",
      },
      {
        question: "Do I have to convert my Office files to PDF beforehand?",
        answer:
          "No — that's the whole point. Universal Merge converts each Office, OpenDocument, image, HTML, or text file to PDF on the fly, so you skip the file-by-file detour through separate converters. You drop everything in once and get a single PDF back.",
      },
      {
        question: "Can I control the order the files appear in?",
        answer:
          "Yes. You arrange the files by drag and drop before merging, and once the combined PDF is built you can still move, rotate, delete, or extract individual pages in the editor — so a document that landed in the wrong place is fixed without redoing the merge.",
      },
      {
        question: "Is anything sent to an external service during conversion?",
        answer:
          "No. Every conversion and the merge itself run on GigaPDF's own engine. Combined with self-hosting — the project is open source — the whole pipeline can execute on your infrastructure, which matters when the bundle holds confidential material.",
      },
    ],
    useCases: [
      "Assemble a grant or tender application from Word, Excel, scans, and PDFs in one shot",
      "Build a handover folder mixing slides, notes, screenshots, and reports",
      "Combine a phone-photographed receipt, an invoice DOCX, and a PDF statement into one file",
    ],
    relatedTools: ["merge-pdf", "image-to-pdf", "word-to-pdf", "organize-pdf-pages"],
    relatedSolutions: ["nonprofits", "accountants", "freelancers"],
    icon: "combine",
    appHref: "/merge",
  },
  {
    slug: "image-to-pdf",
    name: "Image to PDF",
    category: "convert",
    appHref: "/image-to-pdf",
    metaTitle: "Image to PDF: JPG, PNG, WebP to PDF Free | GigaPDF",
    metaDescription:
      "Convert JPG, PNG, WebP, GIF, and AVIF images to PDF — one picture or many into a single multipage file. Free, open source, no watermark.",
    h1: "Convert images to PDF: one or many pictures into one file",
    intro: [
      "Photos of documents, scanned receipts, screenshots, a series of pictures from a phone: images are easy to produce and miserable to send as a coherent set. A handful of loose JPGs forces the recipient to open them one by one, in no particular order, with no pagination. Wrapping them in a single PDF turns a scatter of files into one document you can page through, print, and archive.",
      "GigaPDF converts JPG, PNG, WebP, GIF, and AVIF to PDF, alone or in batches: each image becomes a page, and several images assemble into one multipage PDF in the order you choose. The picture is placed cleanly on the page without re-encoding it to mush, so a photographed document stays legible and a graphic keeps its sharpness.",
      "Once converted, the PDF behaves like any GigaPDF document — it can be merged with other files, compressed, password-protected, or filed and searched in the document manager. Conversion is part of the free plan, with no watermark dropped on the result, and works the same on a self-hosted instance.",
    ],
    howTo: {
      title: "How to convert images to a PDF",
      steps: [
        "Upload one or several images (JPG, PNG, WebP, GIF, AVIF).",
        "Arrange them in the order you want them to appear.",
        "Run the conversion: each image becomes a page of the PDF.",
        "Several images assemble into a single multipage document.",
        "Download the PDF, or merge and compress it further on the same platform.",
      ],
    },
    capabilities: [
      "Conversion of JPG, PNG, WebP, GIF, and AVIF to PDF",
      "Single image or batch into one multipage PDF",
      "Pages ordered the way you arrange the images",
      "Images placed without quality-wrecking re-encoding",
      "No watermark added to the converted file",
      "Chains with merge, compression, and protection on the same platform",
    ],
    faq: [
      {
        question: "Can I turn several images into a single PDF?",
        answer:
          "Yes. Upload all the pictures at once, set their order, and GigaPDF assembles them into one multipage PDF — one image per page. It's the clean way to send a set of photographed documents or a series of screenshots as a single file instead of a dozen attachments.",
      },
      {
        question: "Which image formats are supported?",
        answer:
          "The common ones and the modern ones: JPG and PNG, plus WebP, GIF, and AVIF. You can mix formats in the same conversion — a batch of JPGs and PNGs ends up in one homogeneous PDF without any pre-conversion on your side.",
      },
      {
        question: "Does converting degrade my image quality?",
        answer:
          "No. The image is embedded in the PDF without being re-encoded into a blurry copy, so a photographed document stays readable and a graphic keeps its edges crisp. If you want a lighter file afterwards, the compression tool is there — but it's optional.",
      },
      {
        question: "Can I go the other way, from PDF back to images?",
        answer:
          "Yes, with the PDF to Image tool: it exports each PDF page as a PNG or JPG. Image to PDF and PDF to Image are the two directions of the same bridge, both included in the free plan.",
      },
    ],
    useCases: [
      "Bundle phone photos of a document into one paginated PDF to send or file",
      "Turn a set of receipts or screenshots into a single archivable file",
      "Wrap a series of images into a PDF before merging it with other documents",
    ],
    relatedTools: ["pdf-to-image", "universal-merge", "compress-pdf"],
    relatedSolutions: ["students", "freelancers", "accountants"],
    icon: "image",
  },
  {
    slug: "pdf-to-image",
    name: "PDF to Image",
    category: "convert",
    appHref: "/pdf-to-image",
    metaTitle: "PDF to Image: Export Pages as PNG or JPG | GigaPDF",
    metaDescription:
      "Export each page of a PDF as a PNG or JPG image. Free, open source, no watermark — turn a document into ready-to-use pictures.",
    h1: "Convert a PDF to images: each page as a PNG or JPG",
    intro: [
      "Sometimes a PDF is the wrong container: you need a thumbnail for a website, an image to drop into a slide, a preview to post where PDFs don't display, or a picture of a single page to share on a messaging app. For all of those, a page has to leave the PDF and become a plain image.",
      "GigaPDF renders each page of your PDF as a crisp PNG or JPG with its in-house engine: text stays sharp, vector graphics are rasterized cleanly, and the page's exact appearance is preserved. You get one image per page, ready to use anywhere an image is expected — no PDF viewer required on the other end.",
      "Because the output images are ordinary files, they slot straight into your everyday tools, and the source PDF stays untouched in your workspace. PDF to Image is part of the free plan, adds no watermark, and pairs naturally with Image to PDF for the round trip — both runnable on a self-hosted instance.",
    ],
    howTo: {
      title: "How to convert a PDF to images",
      steps: [
        "Upload the PDF you want to turn into pictures.",
        "Pick the image format for the export: PNG or JPG.",
        "Run the conversion: the in-house engine renders each page.",
        "Collect one image per page, faithful to the original appearance.",
        "Use the images wherever you need them; the source PDF stays intact.",
      ],
    },
    capabilities: [
      "Each PDF page exported as a PNG or JPG image",
      "In-house rendering: sharp text and cleanly rasterized vectors",
      "Page appearance preserved exactly in the image",
      "One image per page for multi-page documents",
      "No watermark on the exported images",
      "Round trip with Image to PDF on the same platform",
    ],
    faq: [
      {
        question: "Should I export to PNG or JPG?",
        answer:
          "PNG for crisp text, line art, and screenshots where you want lossless edges; JPG for photo-heavy pages where a smaller file matters more than pixel-perfect lines. Both render the page faithfully — the choice is about the kind of content and the file size you're after.",
      },
      {
        question: "Does a multi-page PDF give me one image per page?",
        answer:
          "Yes. Each page is rendered separately, so a ten-page PDF produces ten images. That makes it easy to grab just the page you need, or to feed a whole document into a tool that only accepts pictures.",
      },
      {
        question: "Is the image faithful to the original page?",
        answer:
          "It is: GigaPDF's in-house engine rasterizes the page as it would print — text, images, and vector graphics all in place. The image looks exactly like the PDF page, so it's safe to use as a preview or a thumbnail.",
      },
      {
        question: "Can I rebuild a PDF from the images later?",
        answer:
          "Yes, with the Image to PDF tool, which assembles pictures back into a PDF. The two tools are the inverse of each other, so you can take a document apart into images and put it back together when needed.",
      },
    ],
    useCases: [
      "Produce a page preview or thumbnail for a website or a listing",
      "Drop a PDF page into a slide or a document as a plain image",
      "Share a single page on a channel that doesn't display PDFs",
    ],
    relatedTools: ["image-to-pdf", "compress-pdf", "pdf-to-word"],
    relatedSolutions: ["freelancers", "students", "teachers-trainers"],
    icon: "images",
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    category: "convert",
    appHref: "/pdf-to-powerpoint",
    metaTitle: "Convert PDF to PowerPoint (PPTX) | GigaPDF",
    metaDescription:
      "Turn a PDF into an editable PowerPoint deck (.pptx), one slide per page. Free, open source conversion, no watermark.",
    h1: "Convert a PDF into an editable PowerPoint deck",
    intro: [
      "A deck circulates as a PDF, the source .pptx is long gone, and now the presentation has to evolve: a slide to update, a figure to refresh, the whole thing to re-skin for a new audience. Re-typing it from scratch is wasted effort when the content already exists — it just needs to become editable slides again.",
      "GigaPDF exports your PDF to PPTX: each page becomes a slide, with text blocks and images placed back where they belong, editable in PowerPoint, your presentation app, or an OpenDocument suite. It is the reverse of PowerPoint to PDF, built for exactly the moment when a deck's source file has vanished and the content has to keep moving.",
      "The resulting .pptx opens like any other presentation, ready to restyle with your template, and the original PDF stays safe in your workspace. Conversion is included in the free plan, adds no watermark, and runs the same on a self-hosted instance.",
    ],
    howTo: {
      title: "How to convert a PDF to PowerPoint",
      steps: [
        "Upload the PDF you want to turn back into slides.",
        "Pick the PPTX export in the conversion menu.",
        "The engine rebuilds one slide per page, texts and images included.",
        "Download the .pptx and open it in PowerPoint or your presentation app.",
        "Restyle, update, or extend the deck — the source PDF stays intact.",
      ],
    },
    capabilities: [
      "PPTX export editable in PowerPoint and presentation apps",
      "One PDF page rebuilt as one slide",
      "Text blocks and images placed back on each slide",
      "Reverse of the PowerPoint-to-PDF conversion",
      "No watermark on the converted deck",
      "More exports from the same menu: DOCX, ODT, ODP, XLSX",
    ],
    faq: [
      {
        question: "Will the slides be editable in PowerPoint?",
        answer:
          "Yes: the export produces a genuine .pptx where text comes back as editable text and images return as objects, page by page. You open it in PowerPoint, your presentation app, or an OpenDocument suite and pick the deck up where the lost source left off.",
      },
      {
        question: "Does each PDF page become one slide?",
        answer:
          "Yes, the mapping is one page to one slide. A 15-page PDF gives a 15-slide deck, each slide reproducing the layout of its source page as faithfully as the formats allow.",
      },
      {
        question: "How faithful is the layout after conversion?",
        answer:
          "The goal is maximum fidelity, but PDF and PPTX describe documents differently: a heavily designed slide may need touch-ups after conversion. Straightforward decks — title, bullets, an image or two per slide — come back very cleanly and are quick to refine.",
      },
      {
        question: "Can I convert a PowerPoint to PDF too?",
        answer:
          "Yes, with the PowerPoint to PDF tool, which freezes a deck into a fixed PDF. The two tools are the two directions of the same bridge: freeze a deck for distribution, or revive a PDF back into editable slides.",
      },
    ],
    useCases: [
      "Revive a deck whose source .pptx was lost, to update and reuse it",
      "Extract slides from a PDF report to drop into a new presentation",
      "Re-skin an old presentation that only survives as a PDF",
    ],
    relatedTools: ["powerpoint-to-pdf", "pdf-to-word", "pdf-to-excel"],
    relatedSolutions: ["teachers-trainers", "freelancers", "nonprofits"],
    icon: "presentation",
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    category: "convert",
    appHref: "/pdf-to-excel",
    metaTitle: "Convert PDF to Excel (XLSX) Online | GigaPDF",
    metaDescription:
      "Turn the tables in a PDF into an editable Excel workbook (.xlsx) with table reconstruction. Free, open source, no watermark.",
    h1: "Convert a PDF into an editable Excel workbook",
    intro: [
      "The numbers you need are trapped in a PDF: a financial statement, a price list, an export from a tool that only produces PDFs. Re-keying a table cell by cell is slow and error-prone, and copy-pasting from a PDF usually collapses the columns into one mangled blob. What you want is the table back as a real spreadsheet.",
      "GigaPDF exports your PDF to XLSX by reconstructing its tables: detected rows and columns are rebuilt into spreadsheet cells you can edit, sort, and recompute in Excel, your office suite, or an OpenDocument app saving to .ods. The structure is recovered, not flattened, so the figures land where they belong.",
      "The workbook opens like any other spreadsheet and the source PDF stays in your workspace. PDF to Excel is part of the free plan, adds no watermark, and runs the same on a self-hosted instance — the counterpart to Excel to PDF for the return trip.",
    ],
    howTo: {
      title: "How to convert a PDF to Excel",
      steps: [
        "Upload the PDF that contains the tables to recover.",
        "Pick the XLSX export in the conversion menu.",
        "The engine detects the tabular structure and rebuilds rows and columns.",
        "Download the .xlsx and open it in Excel or your spreadsheet app.",
        "Edit, sort, or recompute the figures; the source PDF stays intact.",
      ],
    },
    capabilities: [
      "XLSX export compatible with Excel and spreadsheet apps",
      "Table reconstruction into editable rows and columns",
      "Detected figures placed in real cells, not a flattened blob",
      "Reverse of the Excel-to-PDF conversion",
      "No watermark on the converted workbook",
      "Re-saveable as OpenDocument .ods from your spreadsheet app",
    ],
    faq: [
      {
        question: "Do the PDF's tables come back as real spreadsheet cells?",
        answer:
          "Yes: GigaPDF reconstructs the detected tabular structure into rows and columns, so the figures land in proper Excel cells you can edit and recompute — not a single cell with everything jammed together. That's the difference from a raw copy-paste out of a PDF.",
      },
      {
        question: "What about very complex or borderless tables?",
        answer:
          "Cleanly ruled tables reconstruct best. Tables drawn without real borders, or with cascading merged cells, may be partially simplified and deserve a quick visual check after conversion. For straightforward grids, the result is directly usable.",
      },
      {
        question: "Can I convert a scanned PDF to Excel?",
        answer:
          "A scan holds only images, so run GigaPDF's in-house OCR first to recognize the text, then export to XLSX. Without that step there is no machine-readable text for the table reconstruction to work from.",
      },
      {
        question: "Can I save the result as an OpenDocument spreadsheet?",
        answer:
          "Yes. The export is an .xlsx, which every modern spreadsheet app opens — including OpenDocument suites, where you can re-save it natively as .ods. You're not locked into a single format.",
      },
    ],
    useCases: [
      "Recover a financial statement or price list trapped in a PDF",
      "Pull a data table out of a report to analyze it in a spreadsheet",
      "Turn a scanned table into an editable workbook through OCR plus conversion",
    ],
    relatedTools: ["excel-to-pdf", "pdf-to-word", "pdf-to-powerpoint"],
    relatedSolutions: ["accountants", "freelancers", "nonprofits"],
    icon: "table",
  },
  {
    slug: "rtf-pdf",
    name: "RTF & PDF",
    category: "convert",
    appHref: "/rtf-pdf",
    metaTitle: "Convert RTF to PDF and PDF to RTF | GigaPDF",
    metaDescription:
      "Convert RTF to PDF to freeze the layout, and PDF back to editable RTF. The bidirectional RTF bridge, free and open source.",
    h1: "RTF to PDF and back: the rich-text bridge",
    intro: [
      "RTF is the lingua franca of word processors: a rich-text format that almost every text editor reads and writes, used for documents that have to travel between incompatible tools. But RTF is still an editable, drifting format — to send a final version you want a PDF, and to rework an old PDF in any word processor, RTF is the universal way back in.",
      "GigaPDF handles both directions. RTF to PDF freezes your rich-text document into a fixed PDF — identical on every screen and printer, formulas of layout settled. PDF to RTF rebuilds an editable rich-text file from a PDF, with text and basic formatting recovered, openable in Word, an OpenDocument suite, or any editor that speaks RTF.",
      "Either way, the converted file lands in your document manager and the source stays intact. The RTF bridge is part of the free plan, adds no watermark, and runs the same on a self-hosted instance — handy when you need a format that opens absolutely everywhere.",
    ],
    howTo: {
      title: "How to convert between RTF and PDF",
      steps: [
        "Upload your .rtf file, or the PDF you want to turn back into rich text.",
        "Pick the direction: RTF to PDF, or PDF to RTF.",
        "Run the conversion: the engine renders the PDF or rebuilds the RTF.",
        "Check the result in the built-in viewer.",
        "Download the file, or chain merge, signing, or archiving on the same platform.",
      ],
    },
    capabilities: [
      "RTF to PDF: rich-text document frozen into a fixed layout",
      "PDF to RTF: editable rich text rebuilt from a PDF",
      "Text and basic formatting carried across both directions",
      "RTF readable in Word, OpenDocument suites, and any rich-text editor",
      "No watermark on the converted document",
      "Chains with merge, signing, and archiving on the same platform",
    ],
    faq: [
      {
        question: "Why convert RTF to PDF rather than send the RTF?",
        answer:
          "Because RTF still renders differently depending on the editor and its fonts, and anyone can change it. A PDF locks the layout: what you composed is exactly what the recipient reads and prints. RTF stays your working format; PDF is the one you hand over.",
      },
      {
        question: "What does PDF to RTF give me?",
        answer:
          "An editable rich-text file with the text and its essential formatting recovered, openable in virtually any word processor — Word, an OpenDocument suite, or a lighter editor. It's the most universal way to bring a PDF's content back into an editable document.",
      },
      {
        question: "Will complex formatting survive the round trip?",
        answer:
          "Plain text and basic formatting carry across reliably. RTF is a deliberately simple, portable format, so very elaborate layouts get simplified — which is exactly why it opens everywhere. For straightforward documents the round trip is clean.",
      },
      {
        question: "Is RTF really opened by every word processor?",
        answer:
          "Practically, yes: RTF is one of the oldest interchange formats, supported by Word, OpenDocument suites, and most text editors across platforms. That universality is the reason to keep it in your toolkit alongside DOCX and ODT.",
      },
    ],
    useCases: [
      "Freeze a rich-text document as a PDF before sending it out",
      "Bring an old PDF back into an editable form any word processor can open",
      "Exchange documents between incompatible editors through a universal format",
    ],
    relatedTools: ["text-to-pdf", "word-to-pdf", "pdf-to-word"],
    relatedSolutions: ["freelancers", "students", "nonprofits"],
    icon: "file-text",
  },
  {
    slug: "text-to-pdf",
    name: "Text to PDF",
    category: "convert",
    appHref: "/text-to-pdf",
    metaTitle: "Convert a Text File (TXT) to PDF | GigaPDF",
    metaDescription:
      "Convert a plain .txt file into a clean, readable PDF with sensible pagination. Free, open source, no watermark.",
    h1: "Convert a text file into a clean PDF",
    intro: [
      "Plain text is everywhere — logs, exports, notes, code listings, README files — and perfectly readable, until you need to hand it to someone who expects a proper document. A raw .txt has no pagination, no margins, and no presentation; pasted into an email it loses its line breaks. Wrapping it in a PDF gives it a clean, paginated, printable form.",
      "GigaPDF converts a .txt file into a tidy PDF: the text is laid out with readable margins, a legible monospaced or standard font, and sensible page breaks so long files don't run off the edge. What was a wall of characters becomes a document you can page through, print, and archive without surprises.",
      "The PDF lands in your document manager and the source text stays untouched. Text to PDF is part of the free plan, adds no watermark, and runs the same on a self-hosted instance — the simplest way to give plain text a presentable shell.",
    ],
    howTo: {
      title: "How to convert a text file to PDF",
      steps: [
        "Upload your .txt file to your workspace.",
        "Run the conversion: the text is laid out with margins and pagination.",
        "Long files are split across pages so nothing runs off the edge.",
        "Check the result in the built-in viewer.",
        "Download the PDF, or merge and archive it on the same platform.",
      ],
    },
    capabilities: [
      "Conversion of plain .txt files into clean PDFs",
      "Readable margins and a legible font applied automatically",
      "Sensible page breaks for long text files",
      "Source encoding handled for accented and special characters",
      "No watermark on the converted document",
      "Chains with merge and archiving on the same platform",
    ],
    faq: [
      {
        question: "What does converting a text file to PDF give me?",
        answer:
          "A clean, paginated document: GigaPDF applies readable margins, a legible font, and page breaks, so a raw .txt becomes something you can print and hand over without it running off the page or losing its line breaks in an email body.",
      },
      {
        question: "Are long text files paginated automatically?",
        answer:
          "Yes. The text is flowed across as many pages as needed, with breaks placed so no line gets cut off at the edge. A long log or export turns into a properly paginated PDF rather than a single oversized page.",
      },
      {
        question: "Are accents and special characters preserved?",
        answer:
          "Yes, the source encoding is handled so accented letters and special characters render correctly in the PDF. Your text comes through faithfully rather than peppered with replacement symbols.",
      },
      {
        question: "What if I need richer formatting than plain text?",
        answer:
          "For rich text, use the RTF bridge; for full control over layout, fonts, and styling, build the document as HTML and use HTML to PDF. Text to PDF is the quickest path when the content is plain text and you just need a clean shell.",
      },
    ],
    useCases: [
      "Turn a log, export, or notes file into a paginated, printable PDF",
      "Hand over plain text as a presentable document instead of a raw .txt",
      "Wrap a code or data listing into a PDF before merging it with other files",
    ],
    relatedTools: ["rtf-pdf", "html-to-pdf", "word-to-pdf"],
    relatedSolutions: ["students", "freelancers", "nonprofits"],
    icon: "file-type",
  },
  {
    slug: "redact-pdf",
    appHref: "/documents",
    name: "Redact PDF",
    category: "edit",
    metaTitle: "Redact PDF: Permanently Remove Content | GigaPDF",
    metaDescription:
      "True redaction: the content under the blackout is physically removed from the file, not hidden behind a rectangle. Free, open source.",
    h1: "Redact a PDF: remove the content for good, not just hide it",
    intro: [
      "The redaction scandal repeats endlessly: documents 'blacked out' with a rectangle whose text reappears the instant someone copies and pastes it, because the tool drew a mask over the content instead of deleting it. A black box on top is not redaction — it is a cover that anyone can lift. For privileged, personal, or classified material, that distinction is the whole game.",
      "GigaPDF performs real redaction with its in-house engine: the text and graphics inside the zone you mark are physically stripped from the file's content stream. After processing, the content no longer exists — not in copy-paste, not in text extraction, not in the document's metadata. You draw the zones over the passages to remove, apply, and the words are gone from the file itself, not merely obscured.",
      "Verification is built into the workflow: try to copy-paste over a redacted zone and nothing comes back. The original stays intact in your workspace with its version history, so you keep an unredacted reference. Redaction is part of the free plan, adds no watermark, and — because GigaPDF is open source and self-hostable — can run entirely on your own server, which is exactly what sensitive documents demand.",
    ],
    howTo: {
      title: "How to redact a PDF",
      steps: [
        "Upload the document to redact to your workspace.",
        "Open it in the editor and draw the zones over the content to remove.",
        "Apply the redaction: the in-house engine deletes the content from the file.",
        "Verify by trying to copy-paste over a redacted zone — nothing comes out.",
        "Download the redacted PDF; the original stays intact in version history.",
      ],
    },
    capabilities: [
      "True redaction: content physically removed from the content stream",
      "No reappearance under copy-paste, extraction, or metadata inspection",
      "Visual zone selection over the passages to remove",
      "Built-in verification: copy-paste over a redacted zone returns nothing",
      "Original preserved intact through version history",
      "Self-hostable: sensitive redaction runs on your own server",
    ],
    faq: [
      {
        question: "How is this different from drawing a black rectangle over the text?",
        answer:
          "A black rectangle is just a shape painted on top — the text underneath is still in the file and resurfaces with a copy-paste or extraction. GigaPDF's redaction strips the text and graphics out of the content stream, so the content genuinely no longer exists in the file. That's the line between hiding and removing.",
      },
      {
        question: "How can I be sure the content is really gone?",
        answer:
          "Run the test that exposes bad tools: select a redacted zone and try to copy-paste, or search for one of the removed words. With GigaPDF's redaction nothing comes out, because the underlying operators were deleted — not covered. You can verify before the document leaves your hands.",
      },
      {
        question: "Do I keep a copy of the original, unredacted document?",
        answer:
          "Yes. Redaction produces a new version while the original stays in your workspace with its version history. You retain a full reference internally and disclose only the redacted file — the two never get confused.",
      },
      {
        question: "Can redaction run without sending documents to a third party?",
        answer:
          "Yes. GigaPDF is open source and self-hostable, so the whole redaction workflow can execute on your own infrastructure. For privileged or classified material, that means sensitive documents never leave your perimeter.",
      },
    ],
    useCases: [
      "Black out privileged passages in an exhibit before disclosure, for real",
      "Remove personal data from a document before sharing it more widely",
      "Strip confidential figures or names from a report sent outside the organization",
    ],
    relatedTools: ["annotate-pdf", "protect-pdf", "watermark-pdf"],
    relatedSolutions: ["lawyers", "healthcare", "human-resources"],
    icon: "square-pen",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    category: "secure",
    appHref: "/unlock",
    metaTitle: "Unlock PDF: Remove a Known Password | GigaPDF",
    metaDescription:
      "Remove the password from a PDF you can already open, to get an unencrypted copy. Free, open source — the known-password is required.",
    h1: "Unlock a PDF: remove a password you already know",
    intro: [
      "Encryption is a blessing right up until it becomes a daily tax: a document you legitimately own that demands its password at every single open, an encrypted file you can't merge or annotate, a protected PDF that breaks your automated pipeline. When you already hold the password, re-entering it forever serves no purpose — you want a clean, unencrypted copy.",
      "GigaPDF removes the password from a PDF you can open: you supply the password the file expects, GigaPDF decrypts the content, and you get back an unprotected copy — openable without a prompt, ready to merge, edit, or process. It works on the standard PDF encryption schemes, including AES, and lifts both the open password and the permission restrictions in one pass.",
      "To be unambiguous: this is decryption with the known password, not password cracking. If you don't have the password, GigaPDF cannot — and will not — break the encryption open; that's precisely what makes PDF encryption worth using. Unlocking is part of the free plan, adds no watermark, and runs the same on a self-hosted instance, the natural counterpart to the Protect PDF tool.",
    ],
    howTo: {
      title: "How to remove a password from a PDF",
      steps: [
        "Upload the encrypted PDF you can already open.",
        "Enter the password the file requires.",
        "Run the unlock: GigaPDF decrypts the content with that password.",
        "Download the unprotected copy, openable without any prompt.",
        "Merge, edit, or process the decrypted PDF on the same platform.",
      ],
    },
    capabilities: [
      "Password removed from a PDF you can already open",
      "Standard PDF encryption schemes supported, AES included",
      "Open password and permission restrictions lifted in one pass",
      "Unprotected copy ready to merge, edit, or process",
      "No watermark on the unlocked file",
      "Self-hostable: decryption runs on your own server",
    ],
    faq: [
      {
        question: "Can GigaPDF unlock a PDF without the password?",
        answer:
          "No, and that's by design. Unlocking is decryption with the password you already have, not cracking. If the password is unknown, GigaPDF will not break the encryption — that resistance is exactly what makes AES protection worth applying in the first place.",
      },
      {
        question: "What gets removed when I unlock a file?",
        answer:
          "Both the open password (the one that gates reading) and the permission restrictions (printing, copying, editing) are lifted, producing a clean unencrypted copy. The result opens without a prompt and behaves like an ordinary, unrestricted PDF.",
      },
      {
        question: "Why would I remove a password I know?",
        answer:
          "Convenience and workflow: a document you constantly re-open, a file you need to merge or annotate (tools that an encrypted PDF blocks), or an automated pipeline that chokes on the prompt. Once you have a clean copy, you can re-protect it later with Protect PDF if needed.",
      },
      {
        question: "Does unlocking change the document's content?",
        answer:
          "No. Only the encryption layer is removed; the pages, text, images, and structure are untouched. You get the same document, just without the password and permission restrictions wrapped around it.",
      },
    ],
    useCases: [
      "Get a prompt-free copy of a document you legitimately own and constantly open",
      "Lift restrictions on a known-password PDF so you can merge or annotate it",
      "Unblock an automated pipeline that an encrypted PDF was breaking",
    ],
    relatedTools: ["protect-pdf", "sign-pdf", "redact-pdf"],
    relatedSolutions: ["accountants", "human-resources", "freelancers"],
    icon: "unlock",
  },
  {
    slug: "markdown-to-pdf",
    name: "Markdown to PDF",
    category: "convert",
    appHref: "/markdown-to-pdf",
    metaTitle: "Convert a Markdown file (.md) to PDF | GigaPDF",
    metaDescription:
      "Turn your Markdown (.md) files into a laid-out PDF: headings, lists, tables, code and links rendered cleanly. Free, open source, no watermark.",
    h1: "Convert a Markdown file (.md) into a laid-out PDF",
    intro: [
      "Markdown is the format of notes, READMEs, documentation and plain-written content. Great to write, it stays unreadable to share as-is: a raw .md file shows its hashes, asterisks and table pipes. To share, print or archive, you need a PDF that renders the formatting — heading hierarchy, lists, tables, code blocks and links.",
      "GigaPDF converts Markdown to PDF server-side with its in-house layout engine: CommonMark syntax and GFM tables are parsed and rendered into a clean, paginated document. The result is a faithful PDF, ready to file in your document manager or chain with merging, protection or PDF/A archiving — no watermark, on the free plan.",
      "Beyond sharing, freezing Markdown as PDF guarantees that your headings, lists and code blocks look the same on every machine, regardless of which Markdown viewer the reader happens to use. The produced document lands in your GigaPDF workspace, where it can be tagged, searched and combined with other files. Like the rest of the platform, the tool is open source and self-hostable: on your own server, your content reaches no outside service at all.",
    ],
    howTo: {
      title: "How to convert Markdown to PDF",
      steps: [
        "Upload your .md file to your GigaPDF workspace.",
        "Start the conversion to PDF from the actions menu.",
        "The engine parses the Markdown syntax (headings, lists, tables, code) and lays it out.",
        "Check the result in the built-in viewer.",
        "Download the PDF, share it via link or file it in your document manager.",
      ],
    },
    capabilities: [
      "CommonMark syntax: headings, paragraphs, bold, italic, lists, blockquotes",
      "Markdown (GFM) tables converted into real paginated tables",
      "Code blocks and inline code rendered in a monospace font",
      "Links preserved and stable layout, identical on every screen",
      "Server-side conversion, no install, no watermark",
    ],
    faq: [
      {
        question: "Which Markdown syntax is supported?",
        answer:
          "The engine follows CommonMark — headings, paragraphs, emphasis, bulleted and numbered lists, blockquotes, code blocks, links — and GitHub-style tables (GFM). These are the elements of everyday Markdown used for documentation and notes.",
      },
      {
        question: "Will my Markdown tables be real tables in the PDF?",
        answer:
          "Yes: a table written with pipes and dashes is parsed as a grid and rendered as a paginated table in the PDF, with its rows and columns — not just a line of text with bars.",
      },
      {
        question: "Is there a watermark on the produced PDF?",
        answer:
          "None. Markdown to PDF conversion is a full feature of the free plan, with no watermark. The produced file is yours.",
      },
      {
        question: "Can I convert several Markdown files at once?",
        answer:
          "Yes: upload your .md files to your workspace and convert them one after another. Each produced PDF joins your document manager like any other file, ready to be merged, protected or archived as PDF/A.",
      },
    ],
    useCases: [
      "Ship technical documentation written in Markdown as a readable PDF",
      "Freeze a README or meeting notes into a clean, paginated document",
      "Archive Markdown content in a stable, editor-independent format",
    ],
    relatedTools: ["text-to-pdf", "html-to-pdf", "rtf-pdf"],
    relatedSolutions: ["freelancers", "students", "nonprofits"],
    icon: "file-input",
  },
  {
    slug: "csv-to-pdf",
    name: "CSV to PDF",
    category: "convert",
    appHref: "/csv-to-pdf",
    metaTitle: "Convert a CSV file to PDF (table) | GigaPDF",
    metaDescription:
      "Turn a CSV file into a PDF: the data is rendered as a clean, paginated table, ready to print or share. Free, open source, no watermark.",
    h1: "Convert a CSV file to PDF as a table",
    intro: [
      "A CSV is perfect to exchange data between programs but dreadful to read: opened in a text editor it is just comma-separated values; opened in a spreadsheet the rendering depends on everyone's settings. To share a data extract, print it or archive it, a PDF that lays everything out as a clean table is far more telling.",
      "GigaPDF converts a CSV to PDF server-side: rows and columns are rebuilt into a real table, laid out and paginated. The produced document is stable, readable and ready to file in your document manager or chain with the other tools — no watermark, on the free plan.",
      "Beyond readability, turning a CSV into a PDF guarantees that your figures display the same way everywhere, with no risk of a spreadsheet reinterpreting a date or a large number along the way. The produced document joins your GigaPDF workspace, where it is filed, tagged and found again through full-text search. As with everything on the platform, the tool is open source and self-hostable: on your own server, your data sets travel through no external service whatsoever, which matters when the numbers are confidential.",
    ],
    howTo: {
      title: "How to convert a CSV to PDF",
      steps: [
        "Upload your .csv file to your GigaPDF workspace.",
        "Start the conversion to PDF from the actions menu.",
        "The engine rebuilds the rows and columns into a paginated table.",
        "Check the result in the built-in viewer.",
        "Download the PDF, share it via link or file it in your document manager.",
      ],
    },
    capabilities: [
      "Rebuilds the CSV's rows and columns into a paginated table",
      "Stable layout, identical on every screen",
      "Automatic pagination of large data sets",
      "Server-side conversion, no local install",
      "No watermark added to the produced document",
    ],
    faq: [
      {
        question: "Are large CSV files paginated?",
        answer:
          "Yes: a long CSV is spread over as many pages as needed, with clean pagination, rather than a table that overflows. The document stays readable whatever the number of rows.",
      },
      {
        question: "Is the separator (comma, semicolon) handled?",
        answer:
          "The engine interprets the usual CSV conventions to rebuild the grid. The result is a structured table, independent of the original separator.",
      },
      {
        question: "Is there a watermark on the produced PDF?",
        answer:
          "None. CSV to PDF conversion is part of the free plan, with no watermark. The produced file is yours.",
      },
      {
        question: "Does the produced PDF join my document manager?",
        answer:
          "Yes: like any document produced by GigaPDF, the PDF from your CSV is filed in your workspace, where it can be renamed, tagged, merged with other files or archived as PDF/A.",
      },
    ],
    useCases: [
      "Present a data export as a clean, printable PDF table",
      "Send a database or spreadsheet extract to recipients without a spreadsheet app",
      "Archive a data set in a stable, readable format",
    ],
    relatedTools: ["excel-to-pdf", "text-to-pdf", "merge-pdf"],
    relatedSolutions: ["accountants", "freelancers", "nonprofits"],
    icon: "file-spreadsheet",
  },
  {
    slug: "pdf-to-markdown",
    name: "PDF to Markdown",
    category: "convert",
    appHref: "/pdf-to-markdown",
    metaTitle: "Convert a PDF to Markdown (.md) | GigaPDF",
    metaDescription:
      "Turn a PDF into clean Markdown: headings, lists, tables and links rebuilt as structured text, reusable in docs or a site. Free, open source.",
    h1: "Convert a PDF into reusable Markdown",
    intro: [
      "Reusing a PDF's content in documentation, a wiki or a Git repository calls for structured text, not a copy-paste that loses the formatting. Markdown is that pivot format: lightweight, readable, versionable, accepted by every site and docs generator.",
      "From the PDF, GigaPDF rebuilds structured Markdown: headings become hierarchy levels, lists and tables recover their syntax, links are preserved. The in-house engine analyses the document's structure rather than flattening the page, producing a clean .md ready to edit and commit — no watermark, on the free plan.",
      "This structured reconstruction saves real time for anyone maintaining a knowledge base: there is no longer any need to retype a PDF's content into a wiki by hand. The resulting Markdown can be reread, corrected and versioned before publication, in the editor of your choice. And because the whole platform is open source and self-hostable, sensitive documents can be converted on your own infrastructure, where they never reach a third-party service — decisive for confidential material.",
    ],
    howTo: {
      title: "How to convert a PDF to Markdown",
      steps: [
        "Upload the PDF to your GigaPDF workspace.",
        "If it is a scan, run OCR first to recognize the text.",
        "Choose the Markdown export in the conversion menu.",
        "The engine rebuilds headings, lists, tables and links as Markdown.",
        "Download the .md, ready to drop into your documentation or repository.",
      ],
    },
    capabilities: [
      "Headings rebuilt into Markdown hierarchy levels",
      "Lists, blockquotes and links preserved in Markdown syntax",
      "PDF tables converted into Markdown (GFM) tables",
      "Scan → in-house OCR → Markdown chain for scanned documents",
      "No watermark on the produced file",
    ],
    faq: [
      {
        question: "Why export to Markdown rather than plain text?",
        answer:
          "Plain text loses all structure: headings, lists and tables become indistinct paragraphs. Markdown keeps the hierarchy and formatting in a lightweight syntax, directly reusable in documentation, a static site or a Git repository.",
      },
      {
        question: "Are tables preserved?",
        answer:
          "Yes: a table detected in the PDF is exported as a Markdown (GitHub) table, with its rows and columns. A very graphic document may still need a few touch-ups, as with any conversion from PDF.",
      },
      {
        question: "Can I convert a scanned PDF to Markdown?",
        answer:
          "Yes, by chaining OCR then the Markdown export: OCR first recognizes the scan's text, the export then structures it into Markdown. Without the OCR step, a scan has no text to convert.",
      },
      {
        question: "Does the content stay private?",
        answer:
          "Yes: conversion runs on our own infrastructure, with no third-party service. When self-hosted, your documents never leave your server — decisive for sensitive content.",
      },
    ],
    useCases: [
      "Bring a PDF's content back into documentation or a wiki",
      "Version a PDF document's text in Git",
      "Feed a static site from old PDF deliverables",
    ],
    relatedTools: ["pdf-to-word", "pdf-to-odt", "ocr-pdf"],
    relatedSolutions: ["freelancers", "students", "nonprofits"],
    icon: "file-output",
  },
  {
    slug: "pdf-to-epub",
    name: "PDF to EPUB",
    category: "convert",
    appHref: "/pdf-to-epub",
    metaTitle: "Convert a PDF to EPUB (e-book) | GigaPDF",
    metaDescription:
      "Turn a PDF into an EPUB readable on e-readers and phones: reflowable text, chapters and images carried over. Free, open source, no watermark.",
    h1: "Convert a PDF to EPUB for e-readers and phones",
    intro: [
      "A PDF is fixed to its page size: on an e-reader or a phone it forces you to zoom and pan, line after line. EPUB is the e-book format: its text reflows to fit the screen, the chosen font size and reading comfort. Converting a PDF to EPUB makes a document genuinely readable on the move.",
      "From the PDF, GigaPDF rebuilds a structured EPUB: the text becomes reflowable content, chapters are reconstructed and images carried over. The produced file opens in every compatible e-reader and reading app — no watermark, on the free plan.",
      "Beyond comfort, an EPUB respects the reader's choices: font, size, line spacing and even night mode are theirs to set, where a PDF imposes its fixed page. That flexibility is exactly what makes long-form reading bearable on a phone during a commute. As with the rest of GigaPDF, the conversion is free and can run on your own server, so your library stays entirely under your control.",
    ],
    howTo: {
      title: "How to convert a PDF to EPUB",
      steps: [
        "Upload the PDF to your GigaPDF workspace.",
        "If it is a scan, run OCR first to recognize the text.",
        "Choose the EPUB export in the conversion menu.",
        "The engine rebuilds reflowable text, chapters and images.",
        "Download the EPUB and open it on your e-reader or reading app.",
      ],
    },
    capabilities: [
      "Reflowable text adapted to e-readers, tablets and phones",
      "Chapters reconstructed and images carried over from the PDF",
      "Standard EPUB file, read by compatible e-readers and apps",
      "Scan → in-house OCR → EPUB chain for scanned documents",
      "No watermark on the produced file",
    ],
    faq: [
      {
        question: "Why convert a PDF to EPUB?",
        answer:
          "A PDF's text is fixed to the page size: on a small screen you have to zoom and scroll horizontally. EPUB reflows the text to the screen and the chosen font size, for comfortable reading on e-readers and phones.",
      },
      {
        question: "Is the original layout preserved?",
        answer:
          "EPUB favours reading comfort over layout fidelity: the text reflows and is no longer fixed. A novel or a report converts very well; a very graphic document (magazine, brochure) is still better served by PDF.",
      },
      {
        question: "Can I convert a scanned PDF to EPUB?",
        answer:
          "Yes, by chaining OCR then the EPUB export: OCR first recognizes the scan's text, which then becomes reflowable content. Without OCR, a scan has no text to reflow.",
      },
      {
        question: "Does the EPUB work on all e-readers?",
        answer:
          "The export follows the standard EPUB format, read by compatible e-readers and reading apps. The reflowable text adapts to the screen and font size for comfortable reading on most devices.",
      },
    ],
    useCases: [
      "Comfortably read a long PDF report on an e-reader",
      "Distribute a book or guide in the format of digital libraries",
      "Convert old PDF documents into reflowable e-books",
    ],
    relatedTools: ["pdf-to-word", "pdf-to-markdown", "ocr-pdf"],
    relatedSolutions: ["students", "teachers-trainers", "nonprofits"],
    icon: "book-open",
  },
  {
    slug: "pdf-to-rtf",
    name: "PDF to RTF",
    category: "convert",
    appHref: "/pdf-to-rtf",
    metaTitle: "Convert a PDF to RTF (rich text) | GigaPDF",
    metaDescription:
      "Turn a PDF into editable RTF, opened by every word processor, formatting carried over. Free, open source, no watermark.",
    h1: "Convert a PDF to editable RTF",
    intro: [
      "RTF (Rich Text Format) is the universal interchange format of word processors: opened by Word, Writer, TextEdit and most editors, with no dependency on a particular suite. Converting a PDF to RTF means getting editable rich text that works everywhere, without imposing a proprietary format on your recipients.",
      "From the PDF, GigaPDF rebuilds an RTF document: the text becomes editable again with its essential formatting, ready to reuse in any word processor. For scanned PDFs, the in-house OCR provides the text first, the conversion does the rest — no watermark, on the free plan.",
      "A pivot format par excellence, RTF outlasts both eras and software: a file produced today will still open in ten years, on an editor nobody has imagined yet. That durability is what makes it a sound interchange choice when you don't know which word processor the recipient will use, or whether they run a full office suite at all. The tool stays, like the rest of GigaPDF, free and hostable on your own machine, with nothing sent to an outside service along the way.",
    ],
    howTo: {
      title: "How to convert a PDF to RTF",
      steps: [
        "Upload the PDF to your GigaPDF workspace.",
        "If it is a scan, run OCR first to recognize the text.",
        "Choose the RTF export in the conversion menu.",
        "The engine rebuilds the editable rich text.",
        "Open the .rtf in your word processor and pick up the writing.",
      ],
    },
    capabilities: [
      "RTF export opened by every word processor, no proprietary format",
      "Text editable again with its essential formatting",
      "Scan → in-house OCR → RTF chain for scanned documents",
      "Maximum compatibility: Word, Writer, TextEdit and simple editors",
      "No watermark on the converted document",
    ],
    faq: [
      {
        question: "What's the difference between RTF and DOCX as output?",
        answer:
          "DOCX is richer but tied to the Word ecosystem; RTF is simpler and readable by virtually every editor, including very light ones. Pick RTF for maximum compatibility, DOCX for fuller formatting.",
      },
      {
        question: "Is the formatting preserved?",
        answer:
          "The text comes back with its essential attributes — size, weight, basic styles. A very graphic document may need touch-ups; a letter, a report or a contract usually picks up directly.",
      },
      {
        question: "Can I convert a scan to RTF?",
        answer:
          "Yes, by chaining OCR then the RTF export: OCR recognizes the scan's text, the export structures it as rich text. Without OCR, a scan has no text to convert.",
      },
      {
        question: "Does the content stay private?",
        answer:
          "Yes: conversion runs on our own infrastructure, with no third-party service. When self-hosted, your documents never leave your server.",
      },
    ],
    useCases: [
      "Pick up in a lightweight editor a text distributed as a PDF",
      "Exchange editable content without imposing Word on your recipients",
      "Convert scanned letters into rich text via the built-in OCR",
    ],
    relatedTools: ["pdf-to-word", "pdf-to-odt", "rtf-pdf"],
    relatedSolutions: ["human-resources", "freelancers", "nonprofits"],
    icon: "file-output",
  },
  {
    slug: "pdf-to-html",
    name: "PDF to HTML",
    category: "convert",
    appHref: "/pdf-to-html",
    metaTitle: "Convert a PDF to HTML (web page) | GigaPDF",
    metaDescription:
      "Turn a PDF into HTML: positioned text and images carried over to reuse the content on the web. Free, open source, no watermark.",
    h1: "Convert a PDF to HTML for the web",
    intro: [
      "Republishing a PDF's content on a site, in an email or in a content management system calls for HTML, not a file to download. HTML makes text selectable, indexable by search engines and readable on any screen, where a PDF stays a document apart.",
      "From the PDF, GigaPDF rebuilds HTML in which the text is positioned and the images carried over, faithful to the page's arrangement. The in-house engine produces clean markup, ready to embed or rework — no watermark, on the free plan.",
      "Turning a PDF into a web page also makes it accessible: HTML content can be read by a screen reader, adapts to a phone and translates on the fly, where a PDF stays a frozen block. The produced markup is a starting point that you then style to your own brand. And since the whole platform is open source and self-hostable, the conversion can run entirely on your infrastructure, with your content never leaving your servers.",
    ],
    howTo: {
      title: "How to convert a PDF to HTML",
      steps: [
        "Upload the PDF to your GigaPDF workspace.",
        "If it is a scan, run OCR first to recognize the text.",
        "Choose the HTML export in the conversion menu.",
        "The engine rebuilds the page's positioned text and images.",
        "Download the HTML, ready to embed on your site or in your CMS.",
      ],
    },
    capabilities: [
      "Positioned text and images carried over, faithful to the page layout",
      "Selectable and indexable content, unlike a PDF",
      "Clean markup, ready to embed or rework",
      "Scan → in-house OCR → HTML chain for scanned documents",
      "No watermark on the produced file",
    ],
    faq: [
      {
        question: "Is the produced HTML directly usable on a site?",
        answer:
          "It provides structured content, text and images, that you embed as-is or rework to your style guide. As with any conversion from PDF, a very graphic page may need styling adjustments.",
      },
      {
        question: "What's the difference with the HTML to PDF tool?",
        answer:
          "They are the two directions of one chain: HTML to PDF freezes a web page into a document, PDF to HTML frees a PDF's content to republish it on the web. Both rely on GigaPDF's in-house HTML engine.",
      },
      {
        question: "Can I convert a scanned PDF to HTML?",
        answer:
          "Yes, by chaining OCR then the HTML export: OCR first recognizes the scan's text, the export renders it as web markup. Without OCR, a scan has no text to export.",
      },
      {
        question: "Is there a watermark on the result?",
        answer:
          "None. PDF to HTML conversion is part of the free plan, with no watermark. The produced content is yours, ready to publish.",
      },
    ],
    useCases: [
      "Republish a PDF's content on a site or in a CMS",
      "Make a PDF-distributed document indexable by search engines",
      "Reuse a PDF's text and images in a web page or an email",
    ],
    relatedTools: ["html-to-pdf", "pdf-to-markdown", "ocr-pdf"],
    relatedSolutions: ["freelancers", "nonprofits", "students"],
    icon: "file-output",
  },
  {
    slug: "pdf-to-text",
    name: "PDF to text",
    category: "convert",
    appHref: "/pdf-to-text",
    metaTitle: "Convert a PDF to text (.txt) | GigaPDF",
    metaDescription:
      "Extract a PDF's text into a clean .txt file, ready to reuse or index. Built-in OCR for scans. Free, open source, no watermark.",
    h1: "Convert a PDF to a text file (.txt)",
    intro: [
      "Reusing a PDF's content in a script, a database, a search engine or another program calls for plain text, stripped of any layout. The .txt export extracts that text faithfully, in reading order, ready to be processed automatically.",
      "GigaPDF extracts a PDF's text server-side, in reading order and respecting the encoding — accents and special characters included. For scanned PDFs, the in-house OCR recognizes the text first. The produced file is a clean .txt, no watermark, on the free plan.",
      "Reducing a PDF to its bare text is often the first step of an automated pipeline: analysis, classification, feeding a search engine or a language model. By focusing on the content and the reading order, the .txt export delivers clean material, free of the noise of layout, fonts and positioning. That makes it the natural companion of scripts and data jobs that only care about the words. The operation is free and runs on our own infrastructure; when self-hosted, nothing ever leaves your servers, which keeps even the most sensitive archives fully under your control.",
    ],
    howTo: {
      title: "How to convert a PDF to text",
      steps: [
        "Upload the PDF to your GigaPDF workspace.",
        "If it is a scan, run OCR first to recognize the text.",
        "Choose the text (.txt) export in the conversion menu.",
        "The engine extracts the text in reading order, encoding preserved.",
        "Download the .txt, ready to reuse, index or process automatically.",
      ],
    },
    capabilities: [
      "Text extraction in reading order, encoding preserved",
      "Accents and special characters restored faithfully",
      "Scan → in-house OCR → text chain for scanned documents",
      "Raw file ready for automated processing, indexing or reuse",
      "No watermark added",
    ],
    faq: [
      {
        question: "Does the text come out in the right order?",
        answer:
          "Yes: the engine returns the text in the document's reading order, not in the arbitrary order of the page's objects. The result is usable as-is for indexing or automated processing.",
      },
      {
        question: "What if my PDF is a scan with no text?",
        answer:
          "Run OCR first: it recognizes the image's text, which then becomes extractable as .txt. Without this step, a scan only contains pixels, with no text to export.",
      },
      {
        question: "Are accents correct?",
        answer:
          "Yes: extraction respects the encoding, so accents, cedillas and special characters are restored faithfully in the text file.",
      },
      {
        question: "Is there a size limit?",
        answer:
          "Conversion accepts documents up to your workspace's import limit. A long PDF is extracted into a single text file, in reading order, ready to process.",
      },
    ],
    useCases: [
      "Feed a script or a database with a PDF's content",
      "Index a document's text for full-text search",
      "Quickly grab a PDF's raw content to reuse elsewhere",
    ],
    relatedTools: ["text-to-pdf", "ocr-pdf", "pdf-to-markdown"],
    relatedSolutions: ["accountants", "freelancers", "students"],
    icon: "file-output",
  },
  {
    slug: "change-pdf-password",
    name: "Change PDF password",
    category: "secure",
    metaTitle: "Change a PDF Password Online | GigaPDF",
    metaDescription:
      "Change or set the password protecting a PDF: open with the old one, re-encrypt with the new in AES-256. Free, in-house PDF engine, self-hostable.",
    h1: "Change a PDF password online",
    intro: [
      "Rotating the password on a confidential contract, revoking the one a contractor used to know, or simply protecting a file that was never locked: changing a PDF's password shouldn't force you to decrypt it in one tool and re-encrypt it in another. GigaPDF does both in a single step.",
      "When the document is already protected, you enter its current password — that is what authorises the change — then the new one. GigaPDF opens the file, re-encrypts it with the password you choose, and keeps the original permissions instead of silently granting everything. The user password (asked when opening) and the owner password (which governs permissions) can be set independently.",
      "If the PDF had no password at all, the same tool sets one: the in-house engine's AES-256 encryption applies directly, with no third-party dependency. Everything happens inside your workspace, the password never leaves the current request, and the resulting file stays readable by any compliant PDF reader.",
    ],
    howTo: {
      title: "How to change a PDF's password",
      steps: [
        "Upload the PDF whose password you want to change or set.",
        "If the file is already protected, enter its current password.",
        "Type the new user password, and an optional separate owner password if needed.",
        "Pick the encryption algorithm: AES-256 is recommended.",
        "Run it and download the PDF re-encrypted with its new password.",
      ],
    },
    capabilities: [
      "Rotate the password of an already-encrypted PDF in a single step",
      "Set a password on a PDF that didn't have one",
      "Separate user (open) and owner (permissions) passwords",
      "AES-256 or AES-128 re-encryption by the in-house PDF engine",
      "Original permissions preserved on change, never silently widened",
      "Password handled in memory for the request only, never stored or logged",
    ],
    faq: [
      {
        question: "How is this different from the unlock tool?",
        answer:
          "Unlocking removes the protection entirely and produces a plaintext PDF. Here you replace the password with another one: the document stays encrypted, but with a new key only you know.",
      },
      {
        question: "Do I need the current password?",
        answer:
          "Yes, if the PDF is already protected: it is what authorises the change, and GigaPDF never bypasses a protection. A PDF with no password, however, can receive one with nothing more than the file itself.",
      },
      {
        question: "Can I set only an owner password?",
        answer:
          "Yes. The owner password controls permissions — printing, copying, editing — without necessarily requiring a password to open. You can supply one, the other, or both.",
      },
      {
        question: "Are my permissions preserved?",
        answer:
          "When you change the password of an already-protected file, GigaPDF reuses the document's existing permissions instead of re-granting everything. The access level stays the one you had set.",
      },
      {
        question: "Is the password sent anywhere?",
        answer:
          "No. It is only used to open and re-encrypt the file during the request, then it is gone. Nothing is kept on the server, and GigaPDF is open source and self-hostable for full control.",
      },
    ],
    useCases: [
      "Rotate the password of a sensitive shared document on a schedule",
      "Revoke a third party's access by replacing the password they knew",
      "Protect a PDF received in the clear before sharing it",
    ],
    relatedTools: ["protect-pdf", "unlock-pdf", "sign-pdf"],
    relatedSolutions: ["lawyers", "accountants"],
    icon: "key-round",
    appHref: "/change-password",
  },
  {
    slug: "flatten-pdf",
    name: "Flatten PDF",
    category: "edit",
    metaTitle: "Flatten a PDF: Freeze Forms & Annotations | GigaPDF",
    metaDescription:
      "Flatten a PDF's form fields and annotations into static content: the look stays identical, but the document becomes non-editable. Free, in-house engine.",
    h1: "Flatten a PDF: freeze forms and annotations into static content",
    intro: [
      "A filled form the recipient could still clear in one click, review comments that show in some readers but not others, a stamp that can be dragged around: as long as a PDF holds interactive elements, its appearance isn't truly fixed. Flattening solves this by merging those elements into the page content.",
      "GigaPDF turns form fields and annotations into static content: what you see on screen stays exactly the same, but becomes an integral part of the page, impossible to change or remove afterwards. Entered values, checked boxes, highlights and stamps are burned into the document once and for all.",
      "You choose what gets flattened: forms only, annotations only, or both at once. The operation runs entirely on the in-house PDF engine, with no third-party dependency, and produces a file ready for printing, archiving or distribution — wherever a stable render matters more than editability.",
    ],
    howTo: {
      title: "How to flatten a PDF",
      steps: [
        "Upload the PDF holding the forms or annotations you want to freeze.",
        "Choose the target: the form fields, the annotations, or both.",
        "Run the flatten: interactive elements become static content.",
        "Check that the render stays identical to the original.",
        "Download the flattened PDF, ready to print, archive or share.",
      ],
    },
    capabilities: [
      "Form-field flattening: entered values are frozen into the page",
      "Annotation flattening: comments, highlights and stamps burned into the content",
      "Target choice: forms, annotations, or both",
      "Visual render strictly preserved, but made non-interactive",
      "Document finalised for printing, archiving and distribution",
      "Processed by the in-house PDF engine, with no third-party dependency",
    ],
    faq: [
      {
        question: "What happens to form fields after flattening?",
        answer:
          "Their values are kept as displayed, but the field is gone as an interactive element: it can no longer be cleared or re-edited. The filled form becomes text baked into the page.",
      },
      {
        question: "Does the document's appearance change?",
        answer:
          "No. Flattening preserves the render pixel for pixel: the only difference is that the affected elements are no longer editable. That is exactly the point — to freeze what is shown.",
      },
      {
        question: "Can I flatten only the annotations?",
        answer:
          "Yes. The tool offers three targets: forms only, annotations only, or both. You keep the interactive fields if you flatten only the annotations, and vice versa.",
      },
      {
        question: "Why flatten a PDF before sending it?",
        answer:
          "To guarantee the recipient sees exactly what you approved, with no way to alter a form or make an annotation disappear. It also helps before printing, since some interactive elements print poorly depending on the reader.",
      },
      {
        question: "Does flattening delete content?",
        answer:
          "No, it freezes existing content instead of erasing it. The visible values and marks stay present; they simply stop being editable objects. To truly remove content, use editing instead.",
      },
    ],
    useCases: [
      "Lock a filled form before sending it back signed",
      "Freeze review annotations before archiving a case file",
      "Prepare a stable document for printing or public distribution",
    ],
    relatedTools: ["pdf-forms", "annotate-pdf", "protect-pdf"],
    relatedSolutions: ["accountants", "human-resources"],
    icon: "layers",
    appHref: "/flatten",
  },
];

/** Index by slug for the dynamic pages. */
const TOOLS_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function getToolBySlug(slug: string): ToolData | undefined {
  return TOOLS_BY_SLUG.get(slug);
}

export function getAllToolSlugs(): string[] {
  return TOOLS.map((tool) => tool.slug);
}
