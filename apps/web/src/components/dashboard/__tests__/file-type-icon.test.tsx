import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  FileTypeIcon,
  resolveFileKind,
} from "@/components/dashboard/file-type-icon";

describe("resolveFileKind", () => {
  it("resolves discriminating mime types regardless of the name", () => {
    expect(resolveFileKind("application/pdf", "photo.png")).toBe("pdf");
    expect(
      resolveFileKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        null,
      ),
    ).toBe("word");
    expect(
      resolveFileKind(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        null,
      ),
    ).toBe("excel");
    expect(
      resolveFileKind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        null,
      ),
    ).toBe("powerpoint");
    expect(resolveFileKind("application/vnd.oasis.opendocument.text", null)).toBe(
      "word",
    );
    expect(resolveFileKind("text/csv", null)).toBe("excel");
    expect(resolveFileKind("application/epub+zip", null)).toBe("epub");
  });

  it("resolves mime prefix families (image/audio/video)", () => {
    expect(resolveFileKind("image/png", null)).toBe("image");
    expect(resolveFileKind("image/svg+xml", null)).toBe("image");
    expect(resolveFileKind("audio/mpeg", null)).toBe("audio");
    expect(resolveFileKind("video/mp4", null)).toBe("video");
  });

  it("normalises mime casing and parameters", () => {
    expect(resolveFileKind("Application/PDF; charset=binary", null)).toBe("pdf");
  });

  it("falls back to the filename extension for generic or missing mimes", () => {
    expect(resolveFileKind("application/octet-stream", "rapport.docx")).toBe(
      "word",
    );
    expect(resolveFileKind(null, "budget.XLSX")).toBe("excel");
    expect(resolveFileKind(undefined, "slides.odp")).toBe("powerpoint");
    expect(resolveFileKind("", "archive.tar")).toBe("archive");
    expect(resolveFileKind(null, "notes.md")).toBe("markdown");
    expect(resolveFileKind(null, "data.json")).toBe("json");
  });

  it("keeps the historical GED default (pdf) when nothing is known", () => {
    expect(resolveFileKind(null, null)).toBe("pdf");
    expect(resolveFileKind(undefined, "Contrat sans extension")).toBe("pdf");
  });

  it("reports unknown for a discriminating-but-unmapped mime or extension", () => {
    expect(resolveFileKind("application/x-custom-thing", "blob.xyz")).toBe(
      "unknown",
    );
    expect(resolveFileKind(null, "firmware.xyz")).toBe("unknown");
  });
});

describe("FileTypeIcon", () => {
  it("renders a decorative icon carrying the kind colour", () => {
    const { container } = render(
      <FileTypeIcon mimeType="application/pdf" name="doc.pdf" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain("text-red-500");
  });

  it("keeps caller layout classes while applying the kind colour", () => {
    const { container } = render(
      <FileTypeIcon
        mimeType="text/csv"
        name="export.csv"
        className="h-6 w-6 flex-shrink-0"
      />,
    );
    const cls = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(cls).toContain("h-6");
    expect(cls).toContain("flex-shrink-0");
    expect(cls).toContain("text-emerald-600");
  });
});
