"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { LeagueRulesModal } from "@/components/league/LeagueRulesModal";
import {
  SdplRulesContent,
  SdflRulesContent,
  SdlbSdhlSdbaRulesContent,
  DayTraderRulesContent,
  SddfsRulesContent,
  SdwfsRulesContent,
} from "@/components/league/rules-content";

type RulesKey = "sdpl" | "sdfl" | "sim" | "day-trader" | "sddfs" | "sdwfs";

const RULES_TITLES: Record<RulesKey, string> = {
  sdpl: "SDPL / SDAI Rules",
  sdfl: "SDFL Rules",
  sim: "SDLB / SDHL / SDBA Rules",
  "day-trader": "Day Trader Rules",
  sddfs: "SDDFS Rules",
  sdwfs: "SDWFS Rules",
};

function RulesContentFor({ rulesKey }: { rulesKey: RulesKey }) {
  switch (rulesKey) {
    case "sdpl":
      return <SdplRulesContent />;
    case "sdfl":
      return <SdflRulesContent />;
    case "sim":
      return <SdlbSdhlSdbaRulesContent />;
    case "day-trader":
      return <DayTraderRulesContent />;
    case "sddfs":
      return <SddfsRulesContent />;
    case "sdwfs":
      return <SdwfsRulesContent />;
  }
}

function SectionDivider() {
  return <hr className="border-dark-border my-8" />;
}

function NumberedSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-gold mt-8 mb-3 first:mt-0">{children}</h2>
  );
}

function BodyText({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-white/90 leading-relaxed">{children}</p>
  );
}

function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-outside ml-4 space-y-2 text-sm text-white/90 leading-relaxed mt-3">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3 text-center">
      <p className="text-xl font-bold text-gold">{value}</p>
      <p className="text-xs text-white/70 mt-1 leading-snug">{label}</p>
    </div>
  );
}

function LeagueCard({
  eyebrow,
  title,
  children,
  linkLabel,
  rulesKey,
  onOpenRules,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  linkLabel: string;
  rulesKey: RulesKey;
  onOpenRules: (key: RulesKey) => void;
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <p className="text-sm font-bold uppercase tracking-wider text-gold">
        {eyebrow}
      </p>
      <h3 className="text-base font-bold text-white mt-1">{title}</h3>
      <div className="space-y-2 mt-2">{children}</div>
      <button
        type="button"
        onClick={() => onOpenRules(rulesKey)}
        className="text-sm text-gold hover:underline mt-3"
      >
        {linkLabel}
      </button>
    </div>
  );
}

export default function GameRulesPage() {
  const [openRules, setOpenRules] = useState<RulesKey | null>(null);

  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <header className="px-4 py-4 border-b border-dark-border">
        <Logo />
      </header>

      {openRules && (
        <LeagueRulesModal
          title={RULES_TITLES[openRules]}
          onClose={() => setOpenRules(null)}
        >
          <RulesContentFor rulesKey={openRules} />
        </LeagueRulesModal>
      )}

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <p className="text-sm font-bold uppercase tracking-widest text-gold">
          StockDraft — Rules Reference
        </p>
        <h1 className="text-2xl font-bold text-white mt-1 mb-1">How to Play</h1>
        <p className="text-muted text-sm mb-6 italic">
          Now the market has a season.
        </p>

        <BodyText>
          You draft real stocks and crypto like players. You compete
          head-to-head every week. You win when your portfolio actually beats
          theirs — not because you predicted anything, not because you knew
          trivia. Real markets. Real money movement. Real smack talking.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Every format below runs on the same core engine — draft, lock,
          score, repeat — but each one bends the rules of &quot;fantasy sports
          meets stock market&quot; in a different direction. Some strip out
          everything that makes fantasy sports maddening. Some put it all
          back in, on purpose. Pick your poison.
        </p>

        <SectionDivider />

        <NumberedSectionTitle>01 &nbsp; The Pitch</NumberedSectionTitle>
        <BodyText>
          Fantasy sports without the parts that make you want to throw your
          phone against the wall every Sunday:
        </BodyText>
        <BulletList
          items={[
            <>
              No bye weeks. Every stock plays, every week. The crypto market
              doesn&apos;t take weekends off.
            </>,
            <>
              No injuries — in the base game. You&apos;re #1 overall pick
              isn&apos;t landing on the 10-day DL because it &quot;felt
              tightness.&quot; (Sports Sim leagues bring this back on purpose.
              More on that shortly.)
            </>,
            <>
              No coaching decisions, no contract disputes, no weather.
              Nothing benches your pick except the market itself.
            </>,
            <>
              No waiver sniping. Free agency is first-click-wins — no queue,
              no priority order, no setting an alarm for midnight.
            </>,
          ]}
        />

        <SectionDivider />

        <NumberedSectionTitle>02 &nbsp; The Mechanics, Fast</NumberedSectionTitle>
        <BodyText>
          The full breakdown lives in each league&apos;s rules doc.
          Here&apos;s what&apos;s true almost everywhere:
        </BodyText>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile value="$1M" label="salary cap per manager, every league" />
          <StatTile value="9:30" label="daily lineup lock, ET" />
          <StatTile value="13" label="week season, SDPL/SDAI" />
          <StatTile value="1st" label="click wins any free agent claim" />
        </div>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Crypto is the wild card — it trades 24/7, and in leagues with a
          flex pool, it gets more expensive the more managers pile into the
          same coin. Draft smart. Don&apos;t chase the crowd.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          And always bear in mind. Is a league based on making the most
          dollars to win, or is it based on having the highest percentage
          gain to win. A $5 stock or crypto can out gain a $1000 stock
          percentage wise with ease. That&apos;s what makes StockDraft so
          fun!
        </p>

        <SectionDivider />

        <NumberedSectionTitle>03 &nbsp; Pick Your League</NumberedSectionTitle>
        <BodyText>
          Eight ways to play. Same market, wildly different amounts of
          chaos.
        </BodyText>

        <div className="space-y-4 mt-3">
          <LeagueCard
            eyebrow="SDPL · SDAI — Season · Weekly Matchups"
            title="Player Leagues &amp; Free Sim"
            linkLabel="Read the full SDPL/SDAI rules →"
            rulesKey="sdpl"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              The purest version. 10 starters, a crypto flex pool, 13 weeks
              to prove you actually know something.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Squad up with real people (SDPL) or throw down against the
              house bots (SDAI). No injuries, no waiver drama — just your
              picks against the tape, week after week, all the way to a
              2-week playoff. Draft the same crypto as everyone else and pay
              a surcharge for it, and chase weekly bonus awards like Diamond
              Hands and the dreaded Bench Curse along the way.
            </p>
          </LeagueCard>

          <LeagueCard
            eyebrow="SDFL — Weekly · 18-Week Season"
            title="Football League"
            linkLabel="Read the full SDFL rules →"
            rulesKey="sdfl"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              Here&apos;s the puzzle: every stock is secretly wearing a
              jersey. Get hurt in the real league, and your stock lands on
              IR — you won&apos;t know whose jersey it was until it happens.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Same engine as SDPL, mirrored onto the NFL. 32 franchises, real
              injury data, real bye weeks, real schedule.
            </p>
          </LeagueCard>

          <LeagueCard
            eyebrow="SDHL · SDBA · SDLB — Daily / Series · Sunday Close"
            title="Hockey, Basketball &amp; Baseball"
            linkLabel="Read the full Sports Sim rules →"
            rulesKey="sim"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              SDFL&apos;s siblings — same injury-to-IR pipeline, different
              math entirely. 5 stocks and 5 crypto start every single
              lineup, fixed, no exceptions, with 3 IR slots waiting for
              whichever one gets hurt.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Hockey and basketball throw a new opponent at you almost
              daily; baseball runs series like the real thing, 3–4 days per
              matchup. And because these leagues cryptos score straight
              through the weekend, free agency doesn&apos;t open until
              Sunday 4:00 PM ET — the one scheduling quirk that trips up
              everybody&apos;s first week.
            </p>
          </LeagueCard>

          <LeagueCard
            eyebrow="Day Trader — Weekly · Free · $500K Flat"
            title="Free Weekly Contest"
            linkLabel="Read the full Day Trader rules →"
            rulesKey="day-trader"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              Everyone starts with the exact same $500,000. No draft-day
              edge, no lucky salary-cap math — just you, the tape, and
              Friday&apos;s bell.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Copy any team you&apos;ve already drafted, reset flat, and
              trade freely all week. It&apos;s the closest thing here to
              pure skill with the training wheels off — and it&apos;s free
              to enter.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Your one entry is competing for that week&apos;s sponsor
              prize — two winners every week: Top $ Gainer (most total
              dollar gain) and Top % Gainer (best percentage gain), both
              measured against everyone else entered.
            </p>
          </LeagueCard>

          <LeagueCard
            eyebrow="SDDFS — Single Day · No Safety Net"
            title="Daily Fantasy Sport"
            linkLabel="Read the full SDDFS rules →"
            rulesKey="sddfs"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              Put your money where your mouth is! Daily contests. Add money
              to your wallet and invest $2-$100 into a pool to see who wins.
              Your skill wins you real MONEY! No bench. No free agency. No
              do-overs. Twelve picks, one morning, one closing bell.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              One from each of 11 GICS sectors, plus a crypto wildcard —
              lock it in at the open, and live with it until close.
              It&apos;s the same market skill as the season-long leagues,
              just with the safety rails removed. Higher variance, same
              brain required.
            </p>
          </LeagueCard>

          <LeagueCard
            eyebrow="SDWFS — Weekly · Same Bet, Longer Fuse"
            title="Weekly Fantasy Sport"
            linkLabel="Read the full SDWFS rules →"
            rulesKey="sdwfs"
            onOpenRules={setOpenRules}
          >
            <p className="text-sm text-white/90 leading-relaxed">
              SDDFS&apos;s calmer sibling — same 12-pick format, but
              you&apos;ve got all week for the market to prove you right.
            </p>
            <p className="text-sm text-white/90 leading-relaxed">
              Lock your lineup Monday morning, then watch it play out
              through Friday&apos;s close. Still no bench, still no
              mid-week bailout — you&apos;re just given more runway before
              the scoreboard&apos;s final.
            </p>
          </LeagueCard>
        </div>

        <SectionDivider />

        <NumberedSectionTitle>04 &nbsp; Who&apos;s This For</NumberedSectionTitle>
        <BodyText>
          Anyone. Whether you&apos;re 14 or 114, if the market has ever felt
          like a locked room, this is the door in. Learn how it actually
          moves — no real money at risk, no permission required.
        </BodyText>

        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Day Trader, SDDFS, and SDWFS are 18+ only — entrants must be 18
          years or older to enter any of these three contests, void where
          prohibited by law.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          No purchase necessary to enter or win. StockDraft is the sole
          sponsor of the Day Trader contest and any associated prizes — not
          affiliated with, endorsed by, or administered by Apple Inc. or
          Google LLC.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Platform Fee: StockDraft keeps 8% of each contest&apos;s prize
          pool to cover operating costs — servers, market data, and payment
          processing. That 8% is the only portion of any contest that is
          ever forwarded to a StockDraft account.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Your Funds: All other funds deposited by users are held in
          third-party escrow — safely, and never managed or held directly
          by StockDraft.
        </p>

        <p className="text-center mt-8">
          <Link href="/" className="text-sm text-gold hover:underline">
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
