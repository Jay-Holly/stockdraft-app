import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

function SectionDivider() {
  return <hr className="border-dark-border my-8" />;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-gold mt-8 mb-3 first:mt-0">{children}</h2>
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

function RulesTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto mt-3 rounded-xl border border-dark-border">
      <table className="w-full text-sm border-collapse min-w-[280px]">
        <thead>
          <tr className="border-b border-dark-border bg-dark-card">
            {headers.map((header) => (
              <th
                key={header}
                className="text-left py-2.5 px-3 text-gold font-semibold text-xs uppercase tracking-wider"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-dark-border/50 last:border-b-0"
            >
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 px-3 text-white/90 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GameRulesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-dark">
      <header className="px-4 py-4 border-b border-dark-border">
        <Logo />
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h1 className="text-2xl font-bold text-white mb-1 uppercase tracking-wide">
          StockDraft Game Rules
        </h1>
        <p className="text-muted text-sm mb-6 italic">
          Now the market has a season.
        </p>

        <SectionTitle>THE CONCEPT</SectionTitle>
        <BodyText>
          StockDraft is fantasy sports for the stock market. You draft real stocks
          and crypto like players, compete head-to-head against other managers
          every week, and win based on how your portfolio actually performs — not
          predictions, not trivia. Real markets. Real money movement. Real
          competition. Real shit talking with your friends.
        </BodyText>
        <BodyText>
          And best of all? StockDraft eliminates every single thing that has ever
          made you want to throw your phone across the room on a Sunday afternoon.
        </BodyText>
        <BulletList
          items={[
            <>
              <strong>No bye weeks.</strong> Your entire starting lineup is
              available every single week. The market doesn&apos;t take Sundays
              off — and neither do you.
            </>,
            <>
              <strong>No injuries.</strong> You don&apos;t have to worry about
              your stud player blowing out his damn knee in Week 2 and being
              lost for the entire season. NVDA isn&apos;t going on the 10-day DL
              because it &quot;felt tightness&quot; in warmups.
            </>,
            <>
              <strong>No weather.</strong> Your stock isn&apos;t getting 4
              carries because the game went 28-0 in the first quarter and the
              coach spent the rest of it handing off to a backup.
            </>,
            <>
              <strong>No contract disputes.</strong> Your stocks aren&apos;t
              holding out for a better deal or demanding a trade to a contender.
            </>,
            <>
              <strong>No coaching decisions.</strong> Nobody is benching your
              star for &quot;load management&quot; or moving it to a different
              role midseason because a new offensive coordinator wants to
              &quot;establish the run.&quot;
            </>,
            <>
              <strong>No waiver wire sniping.</strong> Well... actually the free
              agency window is still there. But at least it&apos;s fair. Worst
              record picks first. No one is dropping a player at 11:59 PM on a
              Tuesday and sniping him before you wake up.
            </>,
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          And on top of all that? StockDraft is a genuinely great way to learn
          how the market actually works — without risking a dime of your own
          money. Whether you&apos;re 14 or 140, if markets have ever felt
          intimidating or out of reach, this is your way in.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Every SDPL (StockDraft Player League) season runs 13 weeks — 11 weeks
          of regular season play plus a 2-week playoff — mirroring the same
          13-week financial quarters the real market runs on. That&apos;s not a
          coincidence. That&apos;s the whole point.
        </p>

        <SectionDivider />

        <SectionTitle>YOUR ROSTER</SectionTitle>
        <BodyText>Every manager drafts the same structure:</BodyText>
        <BulletList
          items={[
            <>
              <strong>10 Starting Stocks</strong> — your core lineup, scored in
              every matchup. No bye weeks. No injuries. All ten available every
              single week.
            </>,
            <>
              <strong>2 Bench Spots</strong> — hold backup stocks, swap them in
              during free agency
            </>,
            <>
              <strong>Crypto Flex Pool</strong> — $200,000 to invest across 1–3
              cryptocurrencies, always live, always tradeable
            </>,
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Stocks come from the S&P 500 pool. NVDA isn&apos;t going on the 10-day
          DL. Crypto runs 24/7 and never locks — more on that below.
        </p>

        <SectionDivider />

        <SectionTitle>THE DRAFT</SectionTitle>
        <BodyText>
          StockDraft uses a salary cap draft. Every manager gets $80,000 per
          stock slot to spend on each of their 10 starters and 2 bench spots.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Crypto works differently. Your $200,000 crypto budget is spent during
          the draft across as many coins as you want. But here&apos;s the catch
          — the more managers that draft the same coin, the more expensive it
          gets. Each additional buyer pays a surcharge:
        </p>
        <BulletList
          items={[
            "1st buyer: no surcharge",
            "2nd buyer: +5%",
            "3rd buyer: +10%",
            "4th buyer: +20%",
            "5th buyer: +40%",
            "6th+ buyer: +80%",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          That surcharge money goes directly into the Weekly Bonus Pool — more on
          that below. Draft smart. Don&apos;t chase the crowd.
        </p>

        <SectionDivider />

        <SectionTitle>WEEKLY SCORING &amp; MATCHUPS</SectionTitle>
        <BodyText>
          Just like fantasy football, each week you face one opponent
          head-to-head. The manager whose portfolio gains more wins the matchup
          — simple as that.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Your score is based on your 10 starting stocks plus your crypto flex
          pool. Bench spots don&apos;t score in matchups — they&apos;re depth,
          not starters.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          The week doesn&apos;t end Friday. Stocks freeze at Friday 4:00 PM ET
          market close, but crypto keeps moving all weekend. If you&apos;re down
          going into the weekend, your crypto trades can still flip the result
          before the final whistle. No game script. No garbage time. No coach
          pulling your guy because the game is out of hand.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Final scores lock Monday 6:00 AM ET. That&apos;s when the week
          officially ends, winners are determined, and the next week begins.
        </p>

        <SectionDivider />

        <SectionTitle>DAILY LINEUP LOCK</SectionTitle>
        <BodyText>
          Lineups lock every day at 9:30 AM ET when the market opens. You
          can&apos;t swap bench players to starters or change your active lineup
          during market hours.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          At 4:00 PM ET market close, lineups unlock and you can make changes
          until the next morning&apos;s 9:30 AM lock.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Nobody is putting your stock on a snap count. Nobody is moving it to a
          different role. It plays. Every day. Full time.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Crypto is always exempt. Buy, sell, and rebalance your crypto flex pool
          any time — day, night, weekend, holidays. No locks, ever.
        </p>

        <SectionDivider />

        <SectionTitle>FREE AGENCY</SectionTitle>
        <BodyText>
          Your roster is locked for the entire week — no free agent pickups, no
          drops, no adding new stocks from Monday 9:30 AM ET through Friday 4:00
          PM ET. You play the week with the starters and bench you have. Period.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          The free agent pickup window opens every Saturday at 9:30 AM ET and
          closes Monday at 9:30 AM ET. That&apos;s your one window each week to
          drop underperformers and add new stocks to your bench.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          There is also a waiver wire for the first round of pickup moves.
          Waiver priority goes to the manager with the worst weekly gain
          percentage the prior week — worst record gets first pick, best record
          picks last.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Plan your roster before Monday morning. Once the market opens,
          you&apos;re committed.
        </p>

        <SectionDivider />

        <SectionTitle>LEAGUE FORMATS — SDPL (STOCK DRAFT PLAYER LEAGUES)</SectionTitle>
        <BodyText>
          StockDraft Player Leagues come in five sizes. The rules are identical
          across all five — the only difference is how many managers
          you&apos;re competing against:
        </BodyText>
        <RulesTable
          headers={["Format", "Teams", "Weekly Matchups", "Playoff Teams"]}
          rows={[
            ["SDPL4", "4 teams", "2 games/week", "All 4"],
            ["SDPL6", "6 teams", "3 games/week", "Top 4"],
            ["SDPL8", "8 teams", "4 games/week", "Top 4"],
            ["SDPL10", "10 teams", "5 games/week", "Top 4"],
            ["SDPL12", "12 teams", "6 games/week", "Top 4"],
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          All formats run 11 regular season weeks followed by a 2-week playoff.
          The top 4 teams always make the playoffs, regardless of league size.
          In a 4-team league, everyone gets in. In a 12-team league, you need
          to earn it.
        </p>

        <SectionDivider />

        <SectionTitle>PLAYOFFS</SectionTitle>
        <BodyText>
          The top 4 teams by regular season record advance. Seeding is determined
          by wins, then losses, then season gain percentage as a tiebreaker.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Week 12 — Semifinals:
        </p>
        <BulletList
          items={["#1 seed vs #4 seed", "#2 seed vs #3 seed"]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Week 13 — Championship + 3rd Place:
        </p>
        <BulletList
          items={[
            "Semifinal winners play for the championship",
            "Semifinal losers play for 3rd place",
            "3rd place matters. In leagues with prize pools, 3rd place typically gets their money back.",
          ]}
        />

        <SectionDivider />

        <SectionTitle>WEEKLY BONUS AWARDS</SectionTitle>
        <BodyText>
          Every week, 7 bonus awards are paid out from the $100,000 season bonus
          pool — funded at the start of the season and supplemented by crypto
          surcharge money from the draft. Weekly base payout: $8,636/week.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Award money deposits directly into your crypto flex pool — you choose
          which coin to add it to. No locks, no waiting. It&apos;s yours to
          invest immediately.
        </p>
        <RulesTable
          headers={["Award", "Payout", "How to Win"]}
          rows={[
            ["🏆 Winner of the Week", "$2,000", "Highest total dollar gain in the league"],
            ["🌟 Rookie of the Week", "$1,500", "Best single stock % gain"],
            ["💎 Diamond Hands", "$1,500", "Biggest recovery swing on a stock you held all week"],
            ["🎰 Lottery Hit", "$1,500", "A non-Top-100 stock up 10%+ on your roster"],
            ["🔥 Sweep Week", "$1,500", "Every single starter finishes green"],
            ["😢 Loser of the Week", "$832", "Worst weekly % — a consolation prize, not a penalty"],
            ["🪑 Bench Curse", "$1", "Your bench outperformed your starters. One dollar. No sympathy."],
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Unclaimed awards roll into the Playoff Bonus Pool.
        </p>

        <SectionDivider />

        <SectionTitle>PLAYOFF BONUS POOL</SectionTitle>
        <BodyText>
          $5,000 is seeded into the Playoff Bonus Pool at the start of every
          season. Every unclaimed weekly award adds to it throughout the year.
          Watch it grow on the Awards page.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          When the playoffs begin (Week 12), all 4 playoff teams split the
          accumulated pool based on their seed:
        </p>
        <BulletList
          items={[
            "🥇 1st seed: 40%",
            "🥈 2nd seed: 25%",
            "🥉 3rd seed: 20%",
            "4th seed: 15%",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Each team&apos;s share gets invested into one stock they currently own
          — starters or bench, their choice. No deadline — claim anytime during
          the playoff weeks.
        </p>

        <SectionDivider />

        <SectionTitle>DAY TRADER — FREE WEEKLY CONTEST</SectionTitle>
        <BodyText>
          Day Trader is a free weekly contest open to anyone with a StockDraft
          team. No new draft required — just pick one of your existing league
          teams as your entry.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          How it works:
        </p>
        <BulletList
          items={[
            "Select any team from any league you're currently in",
            "Your 10 starting stocks are copied and reset to a flat $50,000 each ($500,000 total) — leveling the playing field for everyone",
            "Trade freely during market hours (Monday 9:30 AM – Friday 4:00 PM ET)",
            "The week resets every Monday — enter a different team if you want",
            "Entry window: Opens Friday 4:00 PM ET (as soon as the previous week ends). Lock in your team anytime over the weekend before trading begins Monday 9:30 AM ET.",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Two leaderboards run simultaneously:
        </p>
        <BulletList
          items={[
            "🏆 Top $ Gainer — most total dollar gain on your $500K portfolio",
            "📈 Top % Gainer — best percentage gain on your $500K portfolio",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Tied scores rank by earliest entry time — so signing up early matters.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Weekly prizes are sponsor-funded and announced each Monday. Check the
          Day Trader page for this week&apos;s contest name, sponsor, and prize
          details.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          No purchase necessary. Free to enter. One entry per user per week.
        </p>

        <SectionDivider />

        <SectionTitle>SDDFS — STOCKDRAFT DAILY FANTASY SPORT</SectionTitle>
        <BodyText>
          SDDFS is a single-day contest, separate from your season leagues.
          Build a 12-pick lineup each morning, lock it in at the open, and see
          where you land when the market closes that afternoon.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Building your lineup:
        </p>
        <BulletList
          items={[
            "12 picks total — one stock or crypto from each of the 11 GICS sectors (Technology, Financials, Healthcare, Consumer Discretionary, Consumer Staples, Energy, Industrials, Materials, Real Estate, Utilities, Communication Services) plus one Crypto pick",
            "Picks are not exclusive — any number of players can roster the same stock or coin. It's not first-come-first-served, so draft the pick you think will actually move.",
            "One entry per contest, one contest per buy-in tier per day",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Contest tiers:
        </p>
        <RulesTable
          headers={["Contest", "Buy-in", "Entrant cap"]}
          rows={[
            ["The $2 Bill", "$2", "150"],
            ["The 5 Spot", "$5", "100"],
            ["The 10'er", "$10", "75"],
            ["The 25 Spot", "$25", "50"],
            ["The Fiddy Hundred Cent", "$50", "20"],
            ["The Big Ciento", "$100", "10"],
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3 font-semibold">
          Lock, scoring, and payouts:
        </p>
        <BulletList
          items={[
            "Lineups lock at 9:00 AM ET (market open) — make any last-minute swaps before then in the Free Agents panel on your entry's page",
            "Scored at 4:00 PM ET (market close) on each pick's open-to-close % change, summed across all 12 picks — highest total score wins",
            "Top 3 finishers split 50% / 30% / 20% of a prize pool equal to 92% of all buy-ins collected",
            "Ties split the pooled share evenly across every tied entry, even when a tie straddles the paid places (e.g. a 3-way tie for 2nd splits the 2nd + 3rd shares evenly across all three)",
          ]}
        />
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Track your live standings and projected payout anytime from My Teams
          — scores update throughout the day as the market moves, not just
          once at close.
        </p>

        <SectionDivider />

        <SectionTitle>COMING SOON — SPORTS SIM LEAGUES</SectionTitle>
        <BodyText>
          StockDraft is expanding into sport-specific leagues that mirror real
          professional seasons. Same game, same rules — but now add everything
          fantasy sports is famous for. The good stuff. The infuriating stuff.
          All of it.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Remember everything we told you StockDraft Player Leagues don&apos;t
          have? Sports Sim leagues have all of it. On purpose. Because some of
          you sick bastards miss the chaos.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Injuries. IR slots. Bye weeks. Weather. Bad coaching decisions. The
          whole nightmare. Welcome back.
        </p>

        <SectionDivider />

        <SectionTitle>THE FOUR LEAGUES</SectionTitle>
        <div className="space-y-4 mt-3">
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <h3 className="text-base font-bold text-gold">SDFL — Stock Draft Football League</h3>
            <p className="text-sm text-white/90 mt-2 leading-relaxed">
              Mirrors the NFL. 32 franchises, weekly matchups, 17-week regular
              season. Playoff bracket mirrors the NFL postseason. Your season
              starts when the NFL starts, ends when the NFL ends, and your
              championship happens the same week as the Super Bowl.
            </p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <h3 className="text-base font-bold text-gold">SDHL — Stock Draft Hockey League</h3>
            <p className="text-sm text-white/90 mt-2 leading-relaxed">
              Mirrors the NHL. 32 franchises, near-daily matchups Monday through
              Friday. Hockey&apos;s relentless pace translates perfectly — new
              opponent almost every trading day, no weekends (the market&apos;s
              closed and everyone deserves a break), deep roster management all
              season long.
            </p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <h3 className="text-base font-bold text-gold">SDBA — Stock Draft Basketball Association</h3>
            <p className="text-sm text-white/90 mt-2 leading-relaxed">
              Mirrors the NBA. 30 franchises, same daily rotation format as the
              SDHL. Fast-paced, high-scoring, constant action. Built for
              managers who want to be making decisions every single morning.
            </p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <h3 className="text-base font-bold text-gold">SDLB — Stock Draft League Baseball</h3>
            <p className="text-sm text-white/90 mt-2 leading-relaxed">
              Mirrors MLB. 30 franchises, series format — same opponent for 3–4
              trading days, then rotate. 162 total matchups over the season. The
              longest, deepest format in StockDraft. A marathon grind to October.
              Not for the faint of heart.
            </p>
          </div>
        </div>

        <SectionDivider />

        <SectionTitle>YOUR CITY, YOUR FRANCHISE</SectionTitle>
        <BodyText>
          When you join a sports sim league, you type in your city. The system
          validates it against a 100-mile radius from every real pro
          team&apos;s home market for that sport. If your city qualifies, you
          claim that division slot — and it&apos;s yours for the season.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          First come, first served. Once a city is claimed, it&apos;s gone.
          Cities that fall within 100 miles of multiple pro markets get to
          choose which conference and division they want to represent. Border
          city? You pick your side.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Every franchise identity is user-created — your team name, your brand,
          your call. The city just determines which division you belong to.
        </p>

        <SectionDivider />

        <SectionTitle>THE STOCK-TO-PLAYER MAPPING</SectionTitle>
        <BodyText>
          Here&apos;s where Sports Sim leagues get truly unique.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Every S&amp;P 500 stock is mapped to a real NFL/NHL/NBA/MLB player,
          ranked in parallel. The #1 stock by market cap maps to the #1 ranked
          player. Stock #47 maps to player #47. All the way down the list.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          When you draft a stock in a sports sim league, you&apos;re not just
          drafting a company. You&apos;re drafting that player&apos;s history.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          And that history plays out on your roster.
        </p>

        <SectionDivider />

        <SectionTitle>THE INJURY SYSTEM</SectionTitle>
        <BodyText>
          Using real 2025 season injury data, stocks go to IR on the same
          schedule their mapped player actually got hurt.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          If the player mapped to your stock blew out their knee in Week 6 and
          missed three weeks — your stock goes to IR in Week 6 and sits out
          three weeks. You need a replacement. Just like real fantasy sports.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          The injury schedule is published before every season. You can see
          exactly which stocks carry injury risk going in. Draft around it. Plan
          for it. Ignore it at your own peril.
        </p>

        <SectionDivider />

        <SectionTitle>THE IR SLOT</SectionTitle>
        <BodyText>
          Sports sim leagues include 2 IR slots per roster — separate from your
          bench spots.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          A stock on IR doesn&apos;t score. It doesn&apos;t count against your
          active lineup. And you can pick up a replacement during the free
          agency window to fill the gap.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          When the IR period ends — matching the real player&apos;s return date
          from 2025 — your stock comes back off IR and is eligible to return to
          your active lineup.
        </p>

        <SectionDivider />

        <SectionTitle>BYE WEEKS</SectionTitle>
        <BodyText>
          Every stock has a bye week — matching the real team bye week of the
          player it&apos;s mapped to. During your stock&apos;s bye week, it
          doesn&apos;t score. It just sits there. Staring at you. Like a useless
          $80,000 mistake.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Plan around it. Or don&apos;t. But don&apos;t say we didn&apos;t warn
          you.
        </p>

        <SectionDivider />

        <SectionTitle>WEATHER</SectionTitle>
        <BodyText>
          Outdoor stadium games in bad weather affect scoring. Stocks mapped to
          players on teams playing in cold, rain, or snow conditions that week
          take a scoring modifier — reflecting the real historical impact
          weather had on that game in 2025.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Dome teams are safe. Buffalo in January is not.
        </p>

        <SectionDivider />

        <SectionTitle>DRAFT ORDER</SectionTitle>
        <BodyText>
          Draft order mirrors real prior-season league standings. Worst real-world
          record picks first. Best record picks last. Same as the real draft —
          the worst team gets the best pick.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Until the live standings data pipeline is built, draft order defaults
          to random shuffle.
        </p>

        <SectionDivider />

        <SectionTitle>BOT FILL — BETA ONLY</SectionTitle>
        <BodyText>
          During the StockDraft beta, any open roster slot in a sports sim
          league is filled by an AI manager — clearly identified in the
          standings so you always know who&apos;s real and who&apos;s a bot.
          This keeps your league competitive and running from day one while real
          managers from your region sign up. Once a real human claims a slot,
          the AI steps aside permanently.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Every league has an Invite button. Use it. The more real managers in
          your division, the better the competition and the more the trash talk
          means something.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Bot opponents are a beta feature only. At full launch, if a division
          slot isn&apos;t claimed by a real player, it stays open. Real humans
          only.
        </p>

        <SectionDivider />

        <SectionTitle>SCHEDULING CADENCE</SectionTitle>
        <RulesTable
          headers={["League", "Format", "Matchup Style"]}
          rows={[
            ["SDFL", "Weekly", "1 matchup per week, scores lock Friday 4 PM ET"],
            ["SDHL", "Daily", "New opponent nearly every trading day"],
            ["SDBA", "Daily", "Same as SDHL, NBA geography"],
            ["SDLB", "Series", "Same opponent 3–4 trading days, then rotate"],
          ]}
        />

        <div className="rounded-xl border border-dark-border bg-dark-card p-4 mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold mb-2">
            Beta note
          </p>
          <p className="text-sm text-white/90 leading-relaxed">
            During the beta period, sports sim leagues can begin at any time.
            Season schedules are structured to reflect the 2025 real league
            seasons. The geographic city-claiming system, live injury data feed,
            and annual standings pipeline are in active development.
          </p>
          <p className="text-sm text-white/90 leading-relaxed mt-2">
            Sports sim leagues are currently in development. Join the waitlist
            on the dashboard to be notified when your sport launches.
          </p>
        </div>

        <SectionDivider />

        <SectionTitle>WHO CAN PLAY</SectionTitle>
        <BodyText>
          StockDraft is open to all ages. Whether you&apos;re 14 or 140, if you
          want to learn how the market works while competing against friends,
          you&apos;re in.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-4 font-semibold text-gold">
          Day Trader Prize Contests
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-2">
          Prize eligibility depends on the week&apos;s sponsor and prize type.
          Some prizes (gift cards, merch, StockDraft credits) are open to all
          ages. Prizes involving financial accounts (brokerage credits, cash
          transfers) require winners to be 18 or older — or have a parent or
          guardian claim on their behalf.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          When you win, the prize details page will tell you exactly
          what&apos;s required to collect. No surprises.
        </p>

        <SectionDivider />

        <SectionTitle>SWEEPSTAKES DISCLAIMER</SectionTitle>
        <BodyText>
          No purchase necessary to enter or win. StockDraft is the sole sponsor
          of the Day Trader contest and any associated prizes. Prizes may be
          funded or provided by third-party sponsors named in that week&apos;s
          contest, but StockDraft is solely responsible for administering the
          contest, determining winners, and awarding prizes.
        </BodyText>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          This promotion is in no way sponsored, endorsed, administered by, or
          associated with Apple Inc. or Google LLC. Apple and Google have no
          involvement in or responsibility for this contest.
        </p>
        <p className="text-sm text-white/90 leading-relaxed mt-3">
          Prize eligibility varies by contest. Some prizes require winners to be
          18 or older or have parental consent to claim. Full eligibility
          requirements are listed on each week&apos;s Day Trader contest page.
          Void where prohibited by law.
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
