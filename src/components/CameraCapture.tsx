"use client";

/**
 * Live-camera-only proof capture. SPEC.md §6, amended 2026-09-25.
 *
 * The original spec used `<input type="file" accept="image/*" capture="environment">`.
 * `capture` is only a *hint*: on most browsers the viewer can still reach the
 * photo library, and on desktop it is ignored entirely. That let an old photo of
 * a shaved head halt a live countdown, which defeats the point of the system.
 *
 * So there is no file input here at all. The only way to produce bytes is
 * getUserMedia -> <video> -> <canvas> -> blob, i.e. a frame from a camera that
 * is streaming right now.
 *
 * Honest about its limits: this is enforcement by construction, not proof of
 * provenance. Nothing on the web can prove a JPEG came from a real lens — a
 * virtual camera or a hand-rolled POST still gets through. It removes the easy
 * cheat, which is what was asked for. The server-side freshness token is the
 * other half; see /api/upload.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MESSAGES: Record<string, string> = {
  ACCEPTED: "ACCEPTED. COUNTDOWN FROZEN PENDING VERIFICATION.",
  PRESCREEN_REJECTED: "REJECTED. THAT DOES NOT LOOK LIKE A SHAVED HEAD. COUNTDOWN CONTINUES.",
  STALE_CAPTURE: "THIS PAGE WENT STALE. RELOAD AND TAKE THE PHOTO AGAIN.",
  NO_FILE: "NOTHING WAS CAPTURED.",
  TOO_LARGE: "THAT FRAME IS OVER 10 MB.",
  UNSUPPORTED_TYPE: "THE CAPTURED FRAME WAS NOT A VALID IMAGE.",
  DECODE_FAILED: "THE CAPTURED FRAME COULD NOT BE DECODED.",
  RATE_LIMITED: "SLOW DOWN. TRY AGAIN LATER.",
  NOT_ACTIVE: "NO ACTIVE PROTOCOL.",
  CONFLICT: "STATE CHANGED UNDER YOU. TRY ONCE MORE.",
};

type Phase = "idle" | "starting" | "live" | "review" | "sending" | "done";

export function CameraCapture({ token, captureToken }: { token: string; captureToken: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("live");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setPhase("idle");
      setError(
        name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED. THIS PAGE ONLY ACCEPTS A LIVE PHOTO — ALLOW THE CAMERA AND TRY AGAIN."
          : name === "NotFoundError"
            ? "NO CAMERA FOUND ON THIS DEVICE. USE A PHONE."
            : "COULD NOT START THE CAMERA. CHECK NOTHING ELSE IS USING IT.",
      );
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setShot({ blob, url: URL.createObjectURL(blob) });
        setPhase("review");
        stop();
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setResult(null);
    void start();
  }

  async function submit() {
    if (!shot) return;
    setPhase("sending");
    const body = new FormData();
    body.set("token", token);
    body.set("captureToken", captureToken);
    body.set("photo", shot.blob, "proof.jpg");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body,
        headers: { accept: "application/json" },
      });
      const data = (await res.json()) as { ok: boolean; code: string; message: string };
      setResult({ ok: data.ok, text: MESSAGES[data.code] ?? data.message });
      setPhase("done");
      if (data.ok) setTimeout(() => window.location.reload(), 2500);
    } catch {
      setResult({ ok: false, text: "UPLOAD FAILED. CHECK YOUR CONNECTION AND TRY AGAIN." });
      setPhase("review");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "34rem" }}>
      <p className="statusblock" style={{ margin: 0 }}>
        UPLOAD PROOF OF SHAVED HEAD TO HALT COUNTDOWN
        <br />
        LIVE CAMERA ONLY — STORED PHOTOS ARE NOT ACCEPTED
      </p>

      <div
        style={{
          border: "1px solid var(--fg-dim)",
          aspectRatio: "3 / 4",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          background: "#050505",
        }}
      >
        {phase === "review" && shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.url}
            alt="captured frame awaiting submission"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: phase === "live" ? "block" : "none",
            }}
          />
        )}
        {phase === "idle" || phase === "starting" ? (
          <p className="statusblock" style={{ margin: 0, padding: "1rem", textAlign: "center" }}>
            {phase === "starting" ? "STARTING CAMERA…" : "CAMERA OFF"}
          </p>
        ) : null}
      </div>

      {phase === "idle" ? (
        <button className="btn" type="button" onClick={start}>
          START CAMERA
        </button>
      ) : null}

      {phase === "live" ? (
        <button className="btn" type="button" onClick={capture}>
          TAKE PHOTO
        </button>
      ) : null}

      {phase === "review" || phase === "sending" ? (
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={submit} disabled={phase === "sending"}>
            {phase === "sending" ? "SUBMITTING…" : "SUBMIT PROOF"}
          </button>
          <button className="btn" type="button" onClick={retake} disabled={phase === "sending"}>
            RETAKE
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="statusblock" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <p
          className="statusblock"
          role="status"
          style={{ margin: 0, color: result.ok ? "var(--safe)" : "var(--fg)" }}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
