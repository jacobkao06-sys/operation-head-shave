"use client";

/**
 * SPEC.md §6. Camera capture on mobile. Works without JavaScript too: the form
 * posts multipart straight to /api/upload, which 303s back here with ?r=CODE.
 */

import { useState } from "react";

const MESSAGES: Record<string, string> = {
  ACCEPTED: "ACCEPTED. COUNTDOWN FROZEN PENDING VERIFICATION.",
  PRESCREEN_REJECTED: "REJECTED. THAT DOES NOT LOOK LIKE A SHAVED HEAD. COUNTDOWN CONTINUES.",
  NO_FILE: "NO PHOTO ATTACHED.",
  TOO_LARGE: "OVER 10 MB. TRY A SMALLER PHOTO.",
  UNSUPPORTED_TYPE: "NOT AN IMAGE. JPEG, PNG, WEBP, OR HEIC ONLY.",
  HEIC_UNSUPPORTED: "HEIC COULD NOT BE READ. RETAKE THE PHOTO OR SEND A JPEG.",
  DECODE_FAILED: "THAT IMAGE COULD NOT BE DECODED.",
  RATE_LIMITED: "SLOW DOWN. TRY AGAIN LATER.",
  NOT_ACTIVE: "NO ACTIVE PROTOCOL.",
  CONFLICT: "STATE CHANGED UNDER YOU. TRY ONCE MORE.",
};

export function UploadForm({ token, initialResult }: { token: string; initialResult?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(
    initialResult ? (MESSAGES[initialResult] ?? initialResult) : null,
  );
  const [ok, setOk] = useState(initialResult === "ACCEPTED");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setResult("UPLOADING…");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: new FormData(form),
        headers: { accept: "application/json" },
      });
      const data = (await res.json()) as { ok: boolean; code: string; message: string };
      setOk(data.ok);
      setResult(MESSAGES[data.code] ?? data.message);
      if (data.ok) setTimeout(() => window.location.reload(), 2500);
    } catch {
      setOk(false);
      setResult("UPLOAD FAILED. CHECK YOUR CONNECTION AND TRY AGAIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      action="/api/upload"
      method="post"
      encType="multipart/form-data"
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "40rem" }}
    >
      <input type="hidden" name="token" value={token} />
      <label htmlFor="photo" className="statusblock" style={{ margin: 0 }}>
        UPLOAD PROOF OF SHAVED HEAD TO HALT COUNTDOWN
      </label>
      <input
        id="photo"
        className="field"
        type="file"
        name="photo"
        accept="image/*"
        capture="environment"
        required
        disabled={busy}
      />
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "UPLOADING…" : "SUBMIT PROOF"}
      </button>
      {result ? (
        <p
          className="statusblock"
          role="status"
          style={{ margin: 0, color: ok ? "var(--safe)" : "var(--fg)" }}
        >
          {result}
        </p>
      ) : null}
    </form>
  );
}
