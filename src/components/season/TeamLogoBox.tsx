"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export function TeamLogoBox({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null | undefined;
  onChange: (nextLogoUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("Use a PNG, JPG, or WEBP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Logo must be under 2 MB.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to upload a logo.");
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      // Storage RLS requires the first path segment to be the user's id.
      const path = `${user.id}/team-logo-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("team-logos")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("team-logos").getPublicUrl(path);

      const res = await fetch("/api/team/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: publicUrl }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not save your logo.");
        return;
      }

      onChange(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team/logo", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not remove your logo.");
        return;
      }
      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dark-border/60 bg-dark/20 px-3 py-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {logoUrl ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Image
              src={logoUrl}
              alt="Your team logo"
              width={56}
              height={56}
              unoptimized
              className="h-14 w-14 rounded-full object-cover border border-[var(--color-league-accent)] shrink-0"
            />
            <p className="text-xs text-muted">Your team logo</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="text-xs font-semibold text-[var(--color-league-primary)] hover:underline disabled:opacity-50"
            >
              {busy ? "Working…" : "Replace"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRemove()}
              className="text-xs font-semibold text-red-400 hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted">
            Want a custom team logo? Try Nano Banana with a prompt like{" "}
            <span className="text-white">
              &ldquo;Design a bold circular esports-style team logo for [team
              name], a fantasy stock-draft team, dark background, no text&rdquo;
            </span>
            , download it, then upload it here.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="https://gemini.google.com/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[var(--color-league-primary)] hover:underline"
            >
              Create logo →
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="text-xs font-semibold text-[var(--color-league-primary)] hover:underline disabled:opacity-50"
            >
              {busy ? "Uploading…" : "Upload logo"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
