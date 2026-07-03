/**
 * Tests du dialog d'import universel :
 *  - progression par octets (pourcentage + nom du fichier en cours)
 *  - bouton Annuler actif pendant l'upload (jamais bloqué)
 *  - fermeture bloquée pendant l'upload, possible ensuite
 *  - échecs affichés inline SANS fermer le dialog (réessayer possible)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// next-intl mock: chaque clé résout vers son propre chemin (labels requêtables),
// avec interpolation basique pour vérifier le nom de fichier en cours.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));

import { ImportDialog } from "../import-dialog";
import {
  createBatchProgress,
  progressWithCurrentFile,
  progressWithFileFraction,
  type BatchUploadProgress,
} from "@/lib/document-import";

afterEach(cleanup);

function buildProgress(): BatchUploadProgress {
  // small.pdf (100 B) envoyé, big.pdf (300 B) à moitié → 250/400 = 63 %.
  let progress = createBatchProgress([
    { name: "small.pdf", size: 100 },
    { name: "big.pdf", size: 300 },
  ]);
  progress = progressWithFileFraction(progress, 0, 1);
  progress = progressWithFileFraction(progress, 1, 0.5);
  progress = progressWithCurrentFile(progress, 1);
  return progress;
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ImportDialog>> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onFilesSelected: vi.fn(),
    uploading: false,
    progress: null,
    failures: null,
    onCancel: vi.fn(),
    destinationPath: "/",
    ...overrides,
  } satisfies React.ComponentProps<typeof ImportDialog>;
  const utils = render(<ImportDialog {...props} />);
  return { props, ...utils };
}

describe("ImportDialog — progression par octets", () => {
  it("shows the byte-weighted percent and the current file name while uploading", () => {
    renderDialog({ uploading: true, progress: buildProgress() });

    // 63 % = octets cumulés (250/400), pas i/N (qui donnerait 0 %).
    expect(screen.getByText("63%")).toBeInTheDocument();
    // Nom du fichier en cours (interpolation {name} → "currentFile big.pdf").
    expect(screen.getByText(/currentFile.*big\.pdf/)).toBeInTheDocument();
    // Compteur fichiers réglés i/N conservé (0/2 réglés → "0 2").
    expect(screen.getByText(/uploadingProgress/)).toBeInTheDocument();
  });

  it("falls back to an indeterminate bar when no byte total is known", () => {
    const progress = createBatchProgress([
      { name: "a", size: 0 },
      { name: "b", size: 0 },
    ]);
    renderDialog({ uploading: true, progress });

    // Pas de pourcentage trompeur affiché en mode indéterminé.
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

describe("ImportDialog — annulation et fermeture", () => {
  it("shows an ENABLED cancel button while uploading (never a locked dialog)", () => {
    const { props } = renderDialog({
      uploading: true,
      progress: buildProgress(),
    });

    const cancelButton = screen.getByRole("button", { name: /cancel/ });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    // Le bouton Fermer classique est remplacé pendant l'upload.
    expect(screen.queryByRole("button", { name: /close/ })).toBeNull();
  });

  it("blocks closing (Escape) while uploading but allows it once idle", () => {
    const { props, unmount } = renderDialog({
      uploading: true,
      progress: buildProgress(),
    });

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    unmount();

    const idle = renderDialog({ uploading: false });
    fireEvent.click(screen.getByRole("button", { name: /close/ }));
    expect(idle.props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ImportDialog — échecs inline", () => {
  it("renders the failure list with per-file reasons and a retry hint", () => {
    renderDialog({
      failures: [
        { name: "bad.pdf", reason: "boom" },
        { name: "big.zip", reason: "too large" },
      ],
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("failuresTitle");
    expect(alert).toHaveTextContent("bad.pdf : boom");
    expect(alert).toHaveTextContent("big.zip : too large");
    expect(alert).toHaveTextContent("retryHint");
    // La zone de drop reste active pour réessayer.
    expect(screen.getByRole("button", { name: /dropPrompt/ })).toBeEnabled();
  });

  it("hides the failure block while a new batch is uploading", () => {
    renderDialog({
      uploading: true,
      progress: buildProgress(),
      failures: [{ name: "bad.pdf", reason: "boom" }],
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
