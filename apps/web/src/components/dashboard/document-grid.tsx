"use client";

import { DocumentCard } from "./document-card";
import { DragItem, SelectionItem } from "./document-explorer";

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  thumbnailUrl?: string | null;
  mimeType?: string | null;
}

interface DocumentGridProps {
  documents: Document[];
  onDelete?: () => void;
  /** Refresh callback after duplicate / tags update on a card. */
  onChanged?: () => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  draggedItem?: DragItem | null;
  selectionMode?: boolean;
  selectedItems?: SelectionItem[];
  onSelect?: (item: SelectionItem) => void;
}

export function DocumentGrid({
  documents,
  onDelete,
  onChanged,
  onDragStart,
  onDragEnd,
  draggedItem,
  selectionMode = false,
  selectedItems = [],
  onSelect,
}: DocumentGridProps) {
  if (documents.length === 0) {
    return null;
  }

  const isSelected = (id: string) => {
    return selectedItems.some(item => item.type === "document" && item.id === id);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          id={doc.id}
          name={doc.name}
          size={doc.size}
          createdAt={doc.createdAt}
          updatedAt={doc.updatedAt}
          tags={doc.tags}
          thumbnailUrl={doc.thumbnailUrl}
          mimeType={doc.mimeType}
          onDelete={onDelete}
          onChanged={onChanged}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          isDragging={draggedItem?.type === "document" && draggedItem?.id === doc.id}
          selectionMode={selectionMode}
          isSelected={isSelected(doc.id)}
          onSelect={() => onSelect?.({ type: "document", id: doc.id, name: doc.name })}
        />
      ))}
    </div>
  );
}
