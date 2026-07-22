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
        aria-labelledby="sdwfs-rules-title"
      >
        <h3 id="sdwfs-rules-title" className="draft-modal-title">
          SDWFS Official Rules
        </h3>

        <div className="draft-modal-body space-y-4 text-sm text-white/90 leading-relaxed">
          <p className="font-semibold text-gold">
            Welcome to StockDraft Weekly Fantasy (SDWFS) — the ultimate stock
            skills game, where the best of the best come to play and win cash
            prizes.
          </p>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">What you&apos;re actually playing</h4>
            <p>
              SDWFS is a fantasy sport built on top of the public stock and
              crypto markets — the same way fantasy football is built on top
              of real NFL games. Your result comes from the sector research
              and lineup strategy you bring to the draft, not from a random
              draw or a line StockDraft sets against you. We never buy, sell,
              or hold any stock, ETF, or coin on your behalf, and nothing
              here is investment advice — your picks are a fantasy scoring
              input, referencing public price data, same as a stock ticker
              referencing a player&apos;s real-life stat line.
            </p>
            <p>
              We keep a small slice of each contest&apos;s buy-ins to cover
              payment processing and running the platform. The rest — 92
              cents of every dollar — goes back out to players as prize
              money. There&apos;s no house line to beat and no edge stacked
              against you.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">Drafting and scoring</h4>
            <p>
              Your lineup is 12 picks — one from each of the 11 GICS sectors
              (Technology, Financials, Healthcare, Consumer Discretionary,
              Consumer Staples, Energy, Industrials, Materials, Real Estate,
              Utilities, Communication Services) plus one Crypto pick.
              Nothing is exclusive — everyone in the contest can roster the
              same ticker if that&apos;s where the conviction is.
            </p>
            <p>
              Set your lineup any time before 9:00 AM ET Monday, when the
              field locks for the week. Contests settle at 4:00 PM ET market
              close on Friday: each pick scores on its cumulative
              Monday-open-to-Friday-close percentage move, and your 12 picks
              are added together for your total. First, second, and third
              place split the prize pool 50/30/20 — a tie splits its combined
              share evenly across everyone in it, even when the tie spans
              more than one paid place. Live standings and a running payout
              projection are always visible on your entry page all week, not
              just at Friday&apos;s final bell.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">Keeping it fair</h4>
            <p>
              One account, one entry per contest. Play under your own name —
              sharing logins, running duplicate accounts, entering on
              someone else&apos;s behalf, or automating entries with a bot or
              script gets everything involved forfeited. StockDraft
              employees, contractors, and their immediate family aren&apos;t
              eligible to enter for cash. Outside of that: this game is
              built for people who actually know the market, professionals
              included — that&apos;s the whole point.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">Who can enter</h4>
            <p>
              You need to be 18 or older (21+ in states that require it) and
              physically located somewhere that allows paid skill contests
              like this one at the moment you enter. It&apos;s on you to confirm
              that before playing — we use location signals to help enforce
              it, but the responsibility is yours.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">If something breaks</h4>
            <p>
              A contest that gets canceled, hits a technical error, or can&apos;t
              meet the conditions to pay out gets every affected entry fee
              refunded, no questions asked. On the flip side, an entry that
              violates these rules can be pulled. And obviously: what a
              stock or coin did last week doesn&apos;t promise anything about
              this week — nobody, including us, can guarantee an outcome
              here.
            </p>
          </section>

          <p className="text-xs text-muted">
            These rules can change as the game evolves or as new legal
            requirements apply — whatever version is live when you enter
            governs that contest.
          </p>
        </div>

        <div className="draft-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-[var(--color-league-primary,#14b8a6)] text-white font-semibold py-2.5 text-sm hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function SdwfsRulesButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm font-medium text-[var(--color-league-accent,#14b8a6)] hover:underline ${className}`}
      >
        SDWFS Rules
      </button>
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}
