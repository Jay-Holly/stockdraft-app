"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import type { AdminUser } from "@/lib/profile/admin-users";

function formatJoined(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UsersAdminList({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.username, u.team_name, u.email ?? ""].some((field) =>
        field.toLowerCase().includes(q)
      )
    );
  }, [users, query]);

  const emails = filtered
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));

  async function handleCopyEmails() {
    if (emails.length === 0) return;
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const missingEmail = users.filter((u) => !u.email).length;

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, team, or email…"
        className="w-full rounded-xl border border-dark-border bg-dark/40 px-4 py-3 text-sm text-white placeholder:text-muted focus:border-[var(--color-league-primary)] focus:outline-none"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {filtered.length} of {users.length} {users.length === 1 ? "user" : "users"}
          {missingEmail > 0 && ` · ${missingEmail} with no email`}
        </p>
        <Button
          variant="secondary"
          onClick={() => void handleCopyEmails()}
          disabled={emails.length === 0}
          className="!w-auto !px-4 !py-2 text-xs"
        >
          {copied ? "Copied" : `Copy ${emails.length} emails`}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm text-center py-8">
          No users match “{query}”.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((u) => (
            <div
              key={u.id}
              className="rounded-xl border border-dark-border bg-dark/20 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {u.username}
                    {u.is_admin && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gold">
                        Admin
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted truncate">{u.team_name}</p>
                </div>
                <p className="text-xs text-muted shrink-0">
                  {formatJoined(u.created_at)}
                </p>
              </div>

              <p className="text-sm text-white mt-2 break-all select-all">
                {u.email ?? (
                  <span className="text-muted italic">no email on file</span>
                )}
              </p>

              <p className="text-xs text-muted mt-2">
                {u.league_count} {u.league_count === 1 ? "league" : "leagues"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
