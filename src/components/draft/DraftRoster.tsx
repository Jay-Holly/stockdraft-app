"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  formatMoney,
  formatShares,
} from "@/lib/draft/engine";
import type { DraftPick } from "@/lib/draft/types";
import { Button } from "@/components/Button";

export function DraftRoster({ picks }: { picks: DraftPick[] }) {
  const starters = picks.filter((p) => p.pick_type === "stock");
  const bench = picks.filter((p) => p.pick_type === "bench");
  const crypto = picks.filter((p) => p.pick_type === "crypto");

  return (
    <section className="bg-dark-card border border-dark-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Your roster</h2>
          <p className="text-muted text-sm">2026 season draft complete</p>
        </div>
        <Link
          href="/draft"
          className="text-xs font-semibold text-gold hover:underline shrink-0"
        >
          View draft board
        </Link>
      </div>

      <RosterSection title="Starters" count={`${starters.length} stocks`} tone="starters">
        {starters.map((pick) => (
          <RosterRow key={pick.id} pick={pick} tag="ST" />
        ))}
      </RosterSection>

      <RosterSection title="Crypto flex" count={`${crypto.length} picks`} tone="crypto">
        {crypto.map((pick) => (
          <RosterRow key={pick.id} pick={pick} tag="FX" />
        ))}
      </RosterSection>

      <RosterSection title="Bench" count="Doesn't score · still tracks" tone="bench">
        {bench.map((pick) => (
          <RosterRow key={pick.id} pick={pick} tag="BN" />
        ))}
      </RosterSection>

      <div className="p-4 border-t border-dark-border">
        <Button href="/game-rules" variant="ghost" className="w-full">
          View game rules
        </Button>
      </div>
    </section>
  );
}

function RosterSection({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: string;
  tone: "starters" | "crypto" | "bench";
  children: ReactNode;
}) {
  return (
    <div>
      <div className={`draft-roster-head draft-roster-head--${tone}`}>
        <span>{title}</span>
        <span className="draft-roster-count">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function RosterRow({ pick, tag }: { pick: DraftPick; tag: string }) {
  return (
    <div className="draft-roster-row">
      <span className={`draft-roster-tag draft-roster-tag--${tag.toLowerCase()}`}>
        {tag}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{pick.symbol}</p>
        <p className="text-muted text-xs truncate">
          {pick.pick_type === "bench"
            ? "Bench"
            : pick.pick_type === "crypto"
              ? `${formatMoney(pick.budget_spent)} · ${formatShares(pick.shares)}`
              : `${formatShares(pick.shares)} · ${formatMoney(pick.budget_spent)}`}
        </p>
      </div>
      <p className="text-sm text-muted shrink-0">
        @ {formatMoney(pick.price_at_pick)}
      </p>
    </div>
  );
}

export function DraftCallToAction() {
  return (
    <section className="bg-dark-card border border-dark-border rounded-2xl p-6">
      <h2 className="text-lg font-semibold mb-2">Ready to draft?</h2>
      <p className="text-muted text-sm mb-4">
        Build your $1M portfolio — 10 stocks, 2 bench picks, and a $200K crypto
        flex pool. Live Finnhub prices power every pick.
      </p>
      <Button href="/draft" variant="primary" className="w-full">
        Enter Draft Room
      </Button>
    </section>
  );
}
