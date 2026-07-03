/**
 * XHR-based upload transport with REAL byte-level progress.
 *
 * `fetch()` cannot report request-body (upload) progress, so every upload
 * surface that needs a live progress bar routes through this helper instead.
 * Semantics mirror the app's fetch usage exactly:
 *   - cookies always sent (`withCredentials = true` ⇔ `credentials: "include"`)
 *   - the caller supplies the `Authorization: Bearer` header when needed
 *   - no Content-Type is set for FormData (the browser adds the boundary)
 *   - abort via a standard `AbortSignal` (rejects with a DOMException
 *     "AbortError", identical to an aborted fetch)
 *
 * The response is exposed through a minimal fetch-like shape (`ok`, `status`,
 * `blob()`, `text()`, `json()`) so call sites read the same as before.
 */

/** One upload progress tick. `total` is null when the size is not computable. */
export interface UploadProgressEvent {
  loaded: number;
  total: number | null;
}

export interface UploadWithProgressOptions {
  /** HTTP method, defaults to POST (uploads are always mutations here). */
  method?: string;
  /** Extra request headers (e.g. Authorization). Never set Content-Type for FormData. */
  headers?: Record<string, string>;
  /** Byte-level upload progress callback (loaded / total). */
  onProgress?: (event: UploadProgressEvent) => void;
  /** Abort the in-flight request (rejects with an AbortError). */
  signal?: AbortSignal;
}

/** Minimal fetch-like response shape returned by {@link uploadWithProgress}. */
export interface UploadHttpResponse {
  ok: boolean;
  status: number;
  blob: () => Promise<Blob>;
  text: () => Promise<string>;
  json: <T>() => Promise<T>;
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

/**
 * True when the error is an abort (user cancel / timeout signal).
 * NOTE: checks the `name` property on any object — `DOMException` does not
 * inherit from `Error` in every engine (jsdom included), so an
 * `instanceof Error` guard would miss real fetch/XHR aborts.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * POST a FormData (or Blob) body with real upload progress events.
 * Resolves with a fetch-like response for ANY HTTP status (like fetch, a 4xx/5xx
 * is a resolution with `ok: false`); rejects only on network error or abort.
 */
export function uploadWithProgress(
  url: string,
  body: FormData | Blob,
  options: UploadWithProgressOptions = {},
): Promise<UploadHttpResponse> {
  const { method = "POST", headers, onProgress, signal } = options;

  return new Promise<UploadHttpResponse>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = true;
    // Blob response covers both JSON APIs (parsed lazily via json()) and the
    // binary conversion routes (office/image → PDF bytes).
    xhr.responseType = "blob";

    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        xhr.setRequestHeader(name, value);
      }
    }

    const onSignalAbort = () => xhr.abort();
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onSignalAbort);

    if (onProgress) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        onProgress({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : null,
        });
      };
    }

    xhr.onload = () => {
      cleanup();
      const raw: unknown = xhr.response;
      const responseBlob = raw instanceof Blob ? raw : new Blob([]);
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        blob: () => Promise.resolve(responseBlob),
        text: () => responseBlob.text(),
        json: async <T,>() => JSON.parse(await responseBlob.text()) as T,
      });
    };

    xhr.onerror = () => {
      cleanup();
      reject(new TypeError("Network request failed"));
    };

    xhr.onabort = () => {
      cleanup();
      reject(createAbortError());
    };

    xhr.send(body);
  });
}

/**
 * Derive a signal that aborts after `timeoutMs` OR when `parent` aborts —
 * whichever comes first. Used to time-box the best-effort enrichment calls
 * (thumbnail render, text extraction) so a hung server request can NEVER
 * freeze the import pipeline (root cause of the "overlay stuck forever" bug).
 *
 * Always call `dispose()` once the guarded work settles to clear the timer.
 */
export function withTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) {
      controller.abort();
    } else {
      parent.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const dispose = () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  };

  return { signal: controller.signal, dispose };
}
