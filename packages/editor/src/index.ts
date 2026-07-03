/**
 * @giga-pdf/editor
 *
 * State management for the PDF editor using Zustand
 */

// Export stores
export * from "./stores";

// Export actions
export * from "./actions";

// Export selectors
export * from "./selectors";

// Export middleware
export * from "./middleware";

// Export pure editing helpers (find & replace, clipboard, format painter)
export * from "./lib/edit-tools";

// Export types
export type {
  DocumentState,
  CanvasState,
  RulerUnit,
  SelectionState,
  HistoryState,
  CollaborationState,
  UIState,
  PanelType,
  ModalType,
  ViewportDimensions,
  HistorySnapshot,
  OnlineUser,
  UserCursor,
  ElementLockInfo,
  Notification,
  ContextMenuItem,
  SyncConfig,
  PersistenceConfig,
  Margins,
  HeaderFooterContent,
  SectionLayout,
} from "./types";

// Re-export commonly used types from @giga-pdf/types
export type {
  UUID,
  Element,
  ElementType,
  PageObject,
  Tool,
  Bounds,
  Point,
  Transform,
} from "@giga-pdf/types";

// Insert-menu layout helpers (pure): table grid + list prefixing
export { buildTableElements, buildListContent } from "./lib/table-layout";
export type { BuildTableOptions, NewElement } from "./lib/table-layout";

// Embedded fonts: dynamic font loading from PDF via FontFace API + IndexedDB cache
export { useEmbeddedFonts } from "./hooks/use-embedded-fonts";
export type {
  UseEmbeddedFontsOptions,
  UseEmbeddedFontsResult,
  LoadedFont,
  FontLoadStatus,
  FontFaceMatch,
} from "./hooks/use-embedded-fonts";

// Document (embedded) fonts → editor font-picker options
export { buildDocumentFontOptions } from "./utils/document-font-options";
export type { DocumentFontOption } from "./utils/document-font-options";
