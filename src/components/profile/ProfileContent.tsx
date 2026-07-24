"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Profile } from "@/lib/types";
import { Button } from "@/components/Button";

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";

export function ProfileContent({
  profile,
  email,
}: {
  profile: Profile;
  email: string;
}) {
  const [username, setUsername] = useState(profile.username);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        username,
      })
      .eq("id", profile.id);

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Profile saved!");
  }

  return (
    <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
      <h2 className="text-lg font-semibold mb-1">Your profile</h2>
      <p className="text-muted text-sm mb-6">{email}</p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Username
          </label>
          <input
            type="text"
            required
            minLength={3}
            maxLength={24}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
          />
        </div>

        {message && (
          <p
            className={`text-sm ${
              message === "Profile saved!" ? "text-green-400" : "text-red-400"
            }`}
          >
            {message}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </section>
  );
}
