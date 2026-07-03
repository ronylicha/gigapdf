/**
 * Tests d'intégration du flux d'import de la page documents :
 *  - l'overlay plein écran disparaît sur SUCCÈS et sur ERREUR (finally)
 *  - la modal d'import se ferme sur succès complet
 *  - elle reste ouverte avec les échecs inline en cas d'erreur
 *  - la barre reflète la progression par octets remontée par saveDocument
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/editor/lib/extract-text", () => ({
  extractDocumentBlocks: vi.fn(async () => []),
}));

vi.mock("@/components/dashboard/document-explorer", () => ({
  DocumentExplorer: () => null,
}));

vi.mock("@/components/dashboard/blank-document-dialog", () => ({
  BlankDocumentDialog: () => null,
}));

const saveDocumentMock = vi.fn();

vi.mock("@/lib/api", () => ({
  getAuthToken: vi.fn(async () => "test-token"),
  api: {
    listDocuments: vi.fn(async () => ({
      items: [],
      pagination: { total: 0, page: 1, per_page: 50, total_pages: 1 },
    })),
    listFolders: vi.fn(async () => ({ folders: [] })),
    getUserTags: vi.fn(async () => []),
    saveDocument: (...args: unknown[]) => saveDocumentMock(...args),
    uploadDocumentThumbnail: vi.fn(async () => ({ thumbnail_url: null })),
    indexOcrBlocks: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  },
}));

import DocumentsPage from "../page";

type SaveDocumentParams = {
  onProgress?: (event: { loaded: number; total: number | null }) => void;
};

beforeEach(() => {
  saveDocumentMock.mockReset();
  // Les enrichissements best-effort (parse texte + thumbnail) échouent
  // proprement (→ null) : le flux d'import ne doit PAS en dépendre.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openImportDialogAndDrop(file: File) {
  render(<DocumentsPage />);

  // Attendre la fin du chargement initial (skeletons → contenu).
  const importButtons = await screen.findAllByText("import.button");
  const firstButton = importButtons[0];
  if (!firstButton) throw new Error("import button not found");
  fireEvent.click(firstButton);

  await screen.findByText("dialogTitle");

  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"][multiple]',
  );
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files: [file] } });
}

const pdfFile = () =>
  new File(["%PDF-1.4 test-bytes"], "doc.pdf", { type: "application/pdf" });

describe("DocumentsPage — flux d'import", () => {
  it("ferme l'overlay ET la modal sur succès complet", async () => {
    // Holder objet : TS ne narrow pas une variable assignée dans une closure.
    const saveGate: { resolve: (() => void) | null } = { resolve: null };
    saveDocumentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          saveGate.resolve = () =>
            resolve({
              stored_document_id: "doc-1",
              name: "doc",
              page_count: 1,
              version_number: 1,
              created_at: "2026-07-03T00:00:00Z",
            });
        }),
    );

    await openImportDialogAndDrop(pdfFile());

    // L'overlay d'upload est visible tant que le transfert est en vol.
    await screen.findAllByText("import.uploading");
    expect(saveGate.resolve).not.toBeNull();

    saveGate.resolve?.();

    await waitFor(() => {
      // Overlay disparu (finally) ET modal fermée (succès complet).
      expect(screen.queryByText("import.uploading")).toBeNull();
      expect(screen.queryByText("dialogTitle")).toBeNull();
    });
  });

  it("ferme l'overlay mais garde la modal ouverte avec l'échec inline sur erreur", async () => {
    saveDocumentMock.mockRejectedValue(new Error("boom serveur"));

    await openImportDialogAndDrop(pdfFile());

    await waitFor(() => {
      // Overlay TOUJOURS retiré (finally), même en échec total.
      expect(screen.queryByText("import.uploading")).toBeNull();
    });

    // La modal reste ouverte pour réessayer, avec la raison par fichier.
    expect(screen.getByText("dialogTitle")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("doc.pdf : boom serveur");
    expect(alert).toHaveTextContent("retryHint");
  });

  it("affiche la progression réelle par octets remontée par saveDocument", async () => {
    const saveGate: { resolve: (() => void) | null } = { resolve: null };
    saveDocumentMock.mockImplementation((params: SaveDocumentParams) => {
      // Simule le transport XHR : 50 % des octets envoyés.
      params.onProgress?.({ loaded: 9, total: 18 });
      return new Promise((resolve) => {
        saveGate.resolve = () =>
          resolve({
            stored_document_id: "doc-1",
            name: "doc",
            page_count: 1,
            version_number: 1,
            created_at: "2026-07-03T00:00:00Z",
          });
      });
    });

    await openImportDialogAndDrop(pdfFile());

    // 50 % visibles (overlay + dialog) AVANT la fin du transfert — la barre
    // bouge avec les octets, elle ne saute plus de 0 à 100.
    const percents = await screen.findAllByText("50%");
    expect(percents.length).toBeGreaterThan(0);

    saveGate.resolve?.();
    await waitFor(() => {
      expect(screen.queryByText("import.uploading")).toBeNull();
    });
  });
});
