"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

const DFS_TIER_ROWS: [string, string, string][] = [
  ["$2 Bill", "$2", "150"],
  ["The 5 Spot", "$5", "100"],
  ["The Ten'er", "$10", "75"],
  ["The 25 Spot", "$25", "50"],
  ["The Fiddy Thousand Cent", "$50", "20"],
  ["The Big Ciento", "$100", "10"],
];

function RulesModal({ onClose }: { onClose: () => void }) {
  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="draft-modal max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sddfs-rules-title"
      >
        <h3 id="sddfs-rules-title" className="draft-modal-title">
          SDDFS Official Rules
        </h3>

        <div className="draft-modal-body space-y-4 text-sm text-white/90 leading-relaxed">
          <p className="font-semibold text-gold">
            Welcome to StockDraft Daily Fantasy (SDDFS) — the ultimate stock
            skills game, where the best of the best come to play and win cash
            prizes.
          </p>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">1. This is a game of skill</h4>
            <p>
              SDDFS is a fantasy contest of skill, not a game of chance. Your
              result is determined by the research, analysis, and sector
              strategy you apply when building your 12-pick lineup — not by
              a random draw, a house-set line, or odds set against you.
              Outcomes are driven by the real, publicly available performance
              of the stocks and crypto assets you select, which is
              independent of StockDraft and outside our control.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">
              2. No actual securities or crypto are bought, sold, or held
            </h4>
            <p>
              Entering SDDFS does not involve the purchase, sale, or
              custody of any actual stock, ETF, or cryptocurrency.
              StockDraft is not a broker-dealer, exchange, or investment
              adviser, and nothing in SDDFS constitutes investment advice.
              Your picks exist only to score your fantasy lineup, using
              publicly available open/close pricing data as a scoring
              reference.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">
              3. StockDraft does not profit from your entry fee
            </h4>
            <p>
              92% of every contest&apos;s collected entry fees is returned
              directly to players as the prize pool. The remaining share
              covers payment processing, hosting, and operating costs —
              StockDraft does not run SDDFS as a house-edge wagering
              product, and does not set odds or take the other side of
              your entry.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">4. Eligibility</h4>
            <ul className="list-disc list-outside ml-4 space-y-1">
              <li>You must be at least 18 years old (21+ where required by your state).</li>
              <li>You must be physically located in a jurisdiction where fantasy contests with cash entry fees are legally permitted at the time you enter.</li>
              <li>You are solely responsible for confirming that entering SDDFS is legal where you are located.</li>
              <li>One account and one entry per contest per person. Entries made using multiple accounts, on behalf of another person, or by any automated means are void.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">5. Prohibited participants</h4>
            <p>
              StockDraft employees, contractors, and their immediate family
              members are not eligible to enter SDDFS contests for cash
              prizes.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">6. How a contest works</h4>
            <ul className="list-disc list-outside ml-4 space-y-1">
              <li>Build a 12-pick lineup: one stock or crypto asset from each of the 11 GICS sectors, plus one Crypto pick. Picks are not exclusive to one entrant.</li>
              <li>Lineups lock at 9:00 AM ET (market open). Swaps are allowed up until lock via the Free Agents panel on your entry.</li>
              <li>Contests are scored at 4:00 PM ET (market close) on each pick&apos;s open-to-close percentage change, summed across all 12 picks.</li>
              <li>Top 3 finishers split 50% / 30% / 20% of the prize pool. Ties split the pooled share evenly across every tied entry.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">7. Contest tiers</h4>
            <div className="overflow-x-auto rounded-lg border border-white/10 mt-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="text-left py-1.5 px-2 text-muted font-semibold">Contest</th>
                    <th className="text-left py-1.5 px-2 text-muted font-semibold">Buy-in</th>
                    <th className="text-left py-1.5 px-2 text-muted font-semibold">Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {DFS_TIER_ROWS.map(([name, buyIn, cap]) => (
                    <tr key={name} className="border-b border-white/5 last:border-b-0">
                      <td className="py-1.5 px-2">{name}</td>
                      <td className="py-1.5 px-2">{buyIn}</td>
                      <td className="py-1.5 px-2">{cap}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">8. Voided or canceled contests</h4>
            <p>
              If a contest is canceled, voided due to a technical error, or
              fails to meet the conditions required to award prizes, entry
              fees for that contest are fully refunded to affected entrants.
              StockDraft reserves the right to void individual entries found
              to violate these rules.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">9. No guarantee of outcome</h4>
            <p>
              Past performance of any stock or crypto asset is not a
              guarantee of future results. StockDraft makes no
              representation about the likelihood of winning any contest or
              prize.
            </p>
          </section>

          <section className="space-y-1.5">
            <h4 className="font-semibold text-white">10. Changes to these rules</h4>
            <p>
              StockDraft may update these rules from time to time to reflect
              new features, jurisdictions, or legal requirements. The
              current version of these rules always governs contests you
              enter going forward.
            </p>
          </section>
        </div>

        <div className="draft-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-[var(--color-league-primary,#7c3aed)] text-white font-semibold py-2.5 text-sm hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function SddfsRulesButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm font-medium text-[var(--color-league-accent,#a855f7)] hover:underline ${className}`}
      >
        SDDFS Rules
      </button>
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}
