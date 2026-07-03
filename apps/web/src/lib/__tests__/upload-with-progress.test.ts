/**
 * Tests du transport d'upload XHR (progression réelle par octets).
 * XMLHttpRequest est entièrement mocké : chaque test pilote les événements
 * (progress/load/error/abort) et vérifie le contrat fetch-like exposé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAbortError,
  uploadWithProgress,
  withTimeoutSignal,
  type UploadProgressEvent,
} from "../upload-with-progress";

type UploadProgressHandler =
  | ((event: {
      loaded: number;
      total: number;
      lengthComputable: boolean;
    }) => void)
  | null;

class MockXHR {
  static instances: MockXHR[] = [];

  upload: { onprogress: UploadProgressHandler } = { onprogress: null };
  withCredentials = false;
  responseType = "";
  status = 0;
  response: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  headers: Record<string, string> = {};
  openedWith: { method: string; url: string } | null = null;
  sentBody: unknown = null;
  aborted = false;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string): void {
    this.openedWith = { method, url };
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sentBody = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

function lastXhr(): MockXHR {
  const instance = MockXHR.instances[MockXHR.instances.length - 1];
  if (!instance) throw new Error("no XHR instance created");
  return instance;
}

beforeEach(() => {
  MockXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", MockXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("uploadWithProgress", () => {
  it("POSTs the body with credentials and the provided headers", () => {
    const fd = new FormData();
    void uploadWithProgress("/api/v1/storage/documents", fd, {
      headers: { Authorization: "Bearer token-123" },
    });

    const xhr = lastXhr();
    expect(xhr.openedWith).toEqual({
      method: "POST",
      url: "/api/v1/storage/documents",
    });
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.responseType).toBe("blob");
    expect(xhr.headers).toEqual({ Authorization: "Bearer token-123" });
    expect(xhr.sentBody).toBe(fd);
  });

  it("maps upload.onprogress events to onProgress (loaded/total)", () => {
    const events: UploadProgressEvent[] = [];
    void uploadWithProgress("/upload", new FormData(), {
      onProgress: (event) => events.push(event),
    });

    const xhr = lastXhr();
    xhr.upload.onprogress?.({ loaded: 10, total: 100, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 60, total: 100, lengthComputable: true });

    expect(events).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 60, total: 100 },
    ]);
  });

  it("reports total: null when the size is not computable (indeterminate)", () => {
    const events: UploadProgressEvent[] = [];
    void uploadWithProgress("/upload", new FormData(), {
      onProgress: (event) => events.push(event),
    });

    lastXhr().upload.onprogress?.({
      loaded: 42,
      total: 0,
      lengthComputable: false,
    });

    expect(events).toEqual([{ loaded: 42, total: null }]);
  });

  it("resolves with ok/status and a parseable json() on 2xx", async () => {
    const promise = uploadWithProgress("/upload", new FormData());
    const xhr = lastXhr();
    xhr.status = 201;
    xhr.response = new Blob([JSON.stringify({ data: { id: "doc-1" } })]);
    xhr.onload?.();

    const response = await promise;
    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    await expect(response.json<{ data: { id: string } }>()).resolves.toEqual({
      data: { id: "doc-1" },
    });
  });

  it("resolves (not rejects) with ok:false on a 4xx/5xx status, like fetch", async () => {
    const promise = uploadWithProgress("/upload", new FormData());
    const xhr = lastXhr();
    xhr.status = 413;
    xhr.response = new Blob([JSON.stringify({ detail: "too large" })]);
    xhr.onload?.();

    const response = await promise;
    expect(response.ok).toBe(false);
    expect(response.status).toBe(413);
    await expect(response.json<{ detail: string }>()).resolves.toEqual({
      detail: "too large",
    });
  });

  it("exposes the raw body via blob() (binary conversion routes)", async () => {
    const promise = uploadWithProgress("/api/convert/image", new FormData());
    const xhr = lastXhr();
    xhr.status = 200;
    xhr.response = new Blob(["%PDF-1.7"]);
    xhr.onload?.();

    const response = await promise;
    const blob = await response.blob();
    await expect(blob.text()).resolves.toBe("%PDF-1.7");
  });

  it("rejects with a TypeError on network error", async () => {
    const promise = uploadWithProgress("/upload", new FormData());
    lastXhr().onerror?.();
    await expect(promise).rejects.toBeInstanceOf(TypeError);
  });

  it("aborts the XHR and rejects with an AbortError when the signal fires", async () => {
    const controller = new AbortController();
    const promise = uploadWithProgress("/upload", new FormData(), {
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toSatisfy(isAbortError);
    expect(lastXhr().aborted).toBe(true);
  });

  it("rejects immediately (without sending) when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = uploadWithProgress("/upload", new FormData(), {
      signal: controller.signal,
    });

    await expect(promise).rejects.toSatisfy(isAbortError);
    expect(MockXHR.instances).toHaveLength(0);
  });
});

describe("withTimeoutSignal", () => {
  it("aborts after the timeout", () => {
    vi.useFakeTimers();
    const { signal, dispose } = withTimeoutSignal(undefined, 1_000);

    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(signal.aborted).toBe(true);
    dispose();
  });

  it("does not abort once disposed (settled work clears the timer)", () => {
    vi.useFakeTimers();
    const { signal, dispose } = withTimeoutSignal(undefined, 1_000);

    dispose();
    vi.advanceTimersByTime(5_000);
    expect(signal.aborted).toBe(false);
  });

  it("propagates a parent abort immediately", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const { signal, dispose } = withTimeoutSignal(parent.signal, 60_000);

    parent.abort();
    expect(signal.aborted).toBe(true);
    dispose();
  });

  it("starts aborted when the parent is already aborted", () => {
    const parent = new AbortController();
    parent.abort();
    const { signal, dispose } = withTimeoutSignal(parent.signal, 60_000);

    expect(signal.aborted).toBe(true);
    dispose();
  });
});

describe("isAbortError", () => {
  it("recognizes DOMException AbortError and named errors only", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    const named = new Error("aborted");
    named.name = "AbortError";
    expect(isAbortError(named)).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
