"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_COLORS,
  getAvatarHex,
  type AvatarColorId,
  type Profile,
} from "@/lib/types";
import { Button } from "@/components/Button";

export function DashboardContent({
  profile,
  email,
}: {
  profile: Profile;
  email: string;
}) {
  const [username, setUsername] = useState(profile.username);
  const [teamName, setTeamName] = useState(profile.team_name);
  const [avatarColor, setAvatarColor] = useState<AvatarColorId>(
    profile.avatar_color as AvatarColorId
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();
  const avatarHex = getAvatarHex(avatarColor);
  const initials = username.slice(0, 2).toUpperCase();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        username,
        team_name: teamName,
        avatar_color: avatarColor,
      })
      .eq("id", profile.id);

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Profile saved!");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const createdDate = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0"
            style={{ backgroundColor: avatarHex }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{teamName}</h1>
            <p className="text-muted text-sm truncate">@{username}</p>
            <p className="text-muted text-xs mt-1">Member since {createdDate}</p>
          </div>
        </div>
      </section>

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

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Team name
            </label>
            <input
              type="text"
              required
              maxLength={40}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Avatar color
            </label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  title={color.label}
                  onClick={() => setAvatarColor(color.id)}
                  className={`w-9 h-9 rounded-full transition-transform ${
                    avatarColor === color.id
                      ? "ring-2 ring-gold ring-offset-2 ring-offset-dark-card scale-110"
                      : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: color.hex }}
                />
              ))}
            </div>
          </div>

          {message && (
            <p className="text-sm text-green-400">{message}</p>
          )}

          <Button type="submit" variant="primary" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-2">Coming soon</h2>
        <p className="text-muted text-sm mb-4">
          Draft stocks, join leagues, and compete on the leaderboard. Phase 2 is
          on the way.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {["Draft Room", "My Portfolio", "Leagues", "Leaderboard"].map((item) => (
            <div
              key={item}
              className="rounded-xl border border-dashed border-dark-border p-4 text-center text-sm text-muted"
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      <Button variant="ghost" onClick={handleSignOut} className="w-full">
        Sign out
      </Button>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-dark-border bg-dark px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm";
