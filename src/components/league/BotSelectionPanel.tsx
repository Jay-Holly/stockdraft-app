"use client";

import { useMemo, useState } from "react";
import {
  AI_BOTS,
  type BotPersonality,
  type BotProfile,
} from "@/lib/league/bots";
import { Button } from "@/components/Button";

const AVATAR_HEX: Record<string, string> = {
  blue: "#2563eb",
  red: "#dc2626",
  gold: "#d0ab48",
  green: "#16a34a",
  purple: "#9333ea",
  orange: "#ea580c",
  cyan: "#0891b2",
  teal: "#0d9488",
  yellow: "#ca8a04",
  pink: "#db2777",
  indigo: "#4f46e5",
  slate: "#64748b",
};

export function BotSelectionPanel({
  teamName,
  onCancel,
  onConfirm,
  confirming = false,
  error = null,
}: {
  teamName: string;
  onCancel: () => void;
  onConfirm: (personalities: BotPersonality[]) => void;
  confirming?: boolean;
  error?: string | null;
}) {
  const [selected, setSelected] = useState<BotPersonality[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedProfiles = useMemo(
    () =>
      selected
        .map((p) => AI_BOTS.find((b) => b.personality === p))
        .filter(Boolean) as BotProfile[],
    [selected]
  );

  function togglePersonality(personality: BotPersonality) {
    setSelected((prev) => {
      if (prev.includes(personality)) {
        return prev.filter((p) => p !== personality);
      }
      if (prev.length >= 3) return prev;
      return [...prev, personality];
    });
  }

  function handleContinue() {
    if (selected.length !== 3) return;
    setShowConfirm(true);
  }

  if (showConfirm) {
    return (
      <div className="bot-selection space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Confirm your league</h3>
          <p className="text-muted text-sm mt-1">
            You&apos;ll draft live against these three AI managers in rotation.
          </p>
        </div>

        <div className="bot-selection-lineup">
          <div className="bot-selection-lineup-card bot-selection-lineup-card--human">
            <span className="bot-selection-lineup-label">You</span>
            <p className="bot-selection-lineup-name">{teamName}</p>
          </div>
          {selectedProfiles.map((bot) => (
            <div key={bot.personality} className="bot-selection-lineup-card">
              <span
                className="bot-selection-avatar"
                style={{ backgroundColor: AVATAR_HEX[bot.avatarColor] ?? "#64748b" }}
              >
                {bot.displayName.replace("The ", "").slice(0, 2).toUpperCase()}
              </span>
              <p className="bot-selection-lineup-name">{bot.displayName}</p>
              <p className="bot-selection-lineup-strategy">{bot.strategySummary}</p>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={confirming}
            onClick={() => setShowConfirm(false)}
          >
            Back
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={confirming}
            onClick={() => onConfirm(selected)}
          >
            {confirming ? "Starting…" : "Start Live Draft"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bot-selection space-y-5">
      <div>
        <h3 className="text-lg font-semibold">Choose your 3 opponents</h3>
        <p className="text-muted text-sm mt-1">
          Pick exactly three AI managers. Each uses distinct draft logic within
          the same pool, pushback, and surcharge rules.
        </p>
        <p className="text-sm mt-2">
          Selected:{" "}
          <strong className="text-gold">
            {selected.length}/3
          </strong>
        </p>
      </div>

      <div className="bot-selection-grid">
        {AI_BOTS.map((bot) => {
          const isSelected = selected.includes(bot.personality);
          const disabled = !isSelected && selected.length >= 3;

          return (
            <button
              key={bot.personality}
              type="button"
              disabled={disabled}
              className={`bot-selection-card ${isSelected ? "bot-selection-card--selected" : ""} ${disabled ? "bot-selection-card--disabled" : ""}`}
              onClick={() => togglePersonality(bot.personality)}
            >
              <div className="bot-selection-card-header">
                <span
                  className="bot-selection-avatar"
                  style={{
                    backgroundColor: AVATAR_HEX[bot.avatarColor] ?? "#64748b",
                  }}
                >
                  {bot.displayName.replace("The ", "").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 text-left">
                  <p className="bot-selection-card-title">{bot.displayName}</p>
                  <p className="bot-selection-card-tagline">{bot.description}</p>
                </div>
                {isSelected && (
                  <span className="bot-selection-check" aria-hidden>
                    ✓
                  </span>
                )}
              </div>
              <p className="bot-selection-card-strategy">{bot.strategySummary}</p>
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={selected.length !== 3}
          onClick={handleContinue}
        >
          Review lineup
        </Button>
      </div>
    </div>
  );
}
