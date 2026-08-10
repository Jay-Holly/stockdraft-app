"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

function RulesModal({ onClose }: { onClose: () => void }) {
  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="draft-modal max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-trader-rules-title"
      >
        <h3 id="day-trader-rules-title" className="draft-modal-title">
          Day Trader Official Rules
        </h3>

        <div className="draft-modal-body space-y-4 text-sm text-white/90 leading-relaxed">
          <p className="font-semibold text-gold">
            Day Trader is a free weekly contest open to anyone with a
            StockDraft team. No new draft required — just pick one of your
            existing league teams as your entry.
          </p>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">How it works</h4>
            <p>
              Select any team from any league you&apos;re currently in. Your
              10 starting stocks are copied and reset to a flat $50,000 each
              ($500,000 total) — leveling the playing field for everyone.
              Trade freely during market hours (Monday 9:30 AM – Friday 4:00
              PM ET). The week resets every Monday, so you can enter a
              different team if you want.
            </p>
            <p>
              Entry opens Monday 10:00 AM ET for the following week. Lock in
              your team anytime up until trading begins at 9:30 AM ET the
              next Monday.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">Leaderboards</h4>
            <p>
              Two leaderboards run simultaneously: Top $ Gainer (most total
              dollar gain on your $500K portfolio) and Top % Gainer (best
              percentage gain on your $500K portfolio). Tied scores rank by
              earliest entry time, so signing up early matters.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">Prizes</h4>
            <p>
              Weekly prizes are sponsor-funded and announced each Monday.
              Check the Day Trader page for that week&apos;s contest name,
              sponsor, and prize details. No purchase necessary. Free to
              enter. One entry per user per week.
            </p>
            <p>
              Prize eligibility depends on the week&apos;s sponsor and prize
              type. Some prizes (gift cards, merch, StockDraft credits) are
              open to all ages. Prizes involving financial accounts
              (brokerage credits, cash transfers) require winners to be 18 or
              older — or have a parent or guardian claim on their behalf.
            </p>
          </section>

          <p className="text-xs text-muted">
            No purchase necessary to enter or win. StockDraft is the sole
            sponsor of the Day Trader contest and any associated prizes.
            Prizes may be funded or provided by third-party sponsors named in
            that week&apos;s contest, but StockDraft is solely responsible for
            administering the contest, determining winners, and awarding
            prizes. This promotion is in no way sponsored, endorsed,
            administered by, or associated with Apple Inc. or Google LLC.
          </p>
        </div>

        <div className="draft-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-[var(--color-league-primary,#16a34a)] text-white font-semibold py-2.5 text-sm hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function DayTraderRulesButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm font-medium text-[var(--color-league-accent,#22c55e)] hover:underline ${className}`}
      >
        Day Trader Rules
      </button>
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}
