/**
 * user-signatures.ts
 *
 * Shared contract for the account-saved signature/initials marks served by
 * `/api/user/signatures`. Consumed by BOTH surfaces that list saved marks:
 * the capture dialog (one-click insert inside the dialog) and the toolbar's
 * signature dropdown (one-click insert without opening the dialog) — a single
 * fetch helper so the JSON shape is decoded in exactly one place.
 */

/** Whether a mark is a full signature or a short set of initials. */
export type SignatureKind = "signature" | "initials";

/** A signature/initials mark persisted to the caller's account. */
export interface UserSignatureMark {
  id: string;
  kind: SignatureKind;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

/** The payload handed to the editor when a mark is inserted on the page. */
export interface SignatureInsertPayload {
  dataUrl: string;
  width: number;
  height: number;
  kind: SignatureKind;
}

/**
 * Fetch the account's saved marks. Failures (offline, signed-out, 5xx) resolve
 * to an empty list — the saved marks are a convenience, never a blocker.
 */
export async function fetchUserSignatures(): Promise<UserSignatureMark[]> {
  try {
    const res = await fetch("/api/user/signatures", {
      credentials: "same-origin",
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const list = (data as { signatures?: UserSignatureMark[] } | null)
      ?.signatures;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
