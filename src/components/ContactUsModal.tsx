"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/Button";

export function ContactUsModal({
  open,
  email,
  onClose,
}: {
  open: boolean;
  email: string | null | undefined;
  onClose: () => void;
}) {
  const [supportCode, setSupportCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!message.trim()) {
      setError("Tell us what's going on.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/support-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supportCode: supportCode.trim() || null,
          message: message.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Could not send your message.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setSupportCode("");
    setMessage("");
    setError(null);
    setSubmitted(false);
    onClose();
  }

  const modal = (
    <div className="draft-modal-backdrop" onClick={busy ? undefined : handleClose}>
      <div
        className="draft-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-us-title"
      >
        <h3 id="contact-us-title" className="draft-modal-title">
          Contact Us
        </h3>

        {submitted ? (
          <div className="draft-modal-body space-y-3">
            <p className="text-sm text-emerald-200">
              Got it — we&rsquo;ll follow up at {email ?? "your account email"}.
            </p>
          </div>
        ) : (
          <div className="draft-modal-body space-y-3">
            <div>
              <label className="block text-xs text-muted mb-1">
                Your email
              </label>
              <input
                type="text"
                value={email ?? "Not set on your account"}
                disabled
                className="draft-input w-full opacity-70"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">
                League support code (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. SDFL-00069"
                value={supportCode}
                onChange={(e) => setSupportCode(e.target.value)}
                disabled={busy}
                className="draft-input w-full"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">
                What&rsquo;s going on?
              </label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={busy}
                className="draft-input w-full resize-none"
                placeholder="Describe the problem..."
              />
            </div>

            {error && <p className="text-sm text-red-300">{error}</p>}
          </div>
        )}

        <div className="draft-modal-actions">
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            {submitted ? "Close" : "Cancel"}
          </Button>
          {!submitted && (
            <Button
              variant="primary"
              onClick={() => void handleSubmit()}
              disabled={busy}
            >
              {busy ? "Sending…" : "Send"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
