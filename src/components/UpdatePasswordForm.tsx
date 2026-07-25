"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null
  );

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({ type: "error", text: error.message });
      setLoading(false);
      return;
    }

    setMessage({ type: "success", text: "Password updated. Redirecting…" });
    window.location.href = "/dashboard";
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <Logo size="lg" />
        <p className="text-muted mt-3 text-sm">Choose a new password.</p>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-2xl p-6 sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
            />
          </div>

          {message && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ${
                message.type === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-green-500/10 text-green-400 border border-green-500/20"
              }`}
            >
              {message.text}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={loading} className="w-full">
            {loading ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
