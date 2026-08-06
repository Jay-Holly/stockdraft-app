import { RuleSection, RuleCallout } from "@/components/league/LeagueRulesModal";

function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto my-3 rounded-lg border" style={{ borderColor: "#2C2717" }}>
      <table className="w-full text-sm border-collapse min-w-[280px]">
        <thead>
          <tr style={{ background: "#241F11" }}>
            {headers.map((h) => (
              <th
                key={h}
                className="text-left py-2 px-3 text-xs font-bold uppercase tracking-wider"
                style={{ color: "#E8BE4A" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: "1px solid #2C2717" }}>
              {row.map((cell, j) => (
                <td key={j} className="py-2 px-3 align-top" style={{ color: "#ECE7D9" }}>
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

/** SDPL_SDAI_Player_League_Rules.docx — verbatim. Shown for both the Player League and Free Sim League cards. */
export function SdplRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        SDPL2 / SDPL4 / SDPL6 / SDPL8 / SDPL10 / SDPL12 / SDAI — StockDraft
        Player Leagues &amp; Free AI Leagues
      </p>

      <RuleSection title="The Concept">
        <p>
          StockDraft is fantasy sports for the stock market. You draft real
          stocks and crypto like players, compete head-to-head against other
          managers every week, and win based on how your portfolio actually
          performs — not predictions, not trivia.
        </p>
        <p>
          Every StockDraft season runs 13 weeks — 11 weeks of regular season
          play plus a 2-week playoff — mirroring the same 13-week financial
          quarters the real market runs on.
        </p>
        <p>
          Here&rsquo;s what fantasy sports usually throws at you — and what
          StockDraft strips out:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            No bye weeks. Your entire starting lineup is available every
            single week. The market doesn&rsquo;t take Sundays off — and
            neither do you.
          </li>
          <li>
            No injuries. You don&rsquo;t have to worry about your stud player
            blowing out his damn knee in Week 2 and being lost for the entire
            season. NVDA isn&rsquo;t going on the 10-day DL because it &ldquo;felt
            tightness&rdquo; in warmups.
          </li>
          <li>
            No weather. Your stock isn&rsquo;t getting 4 carries because the
            game went 28-0 in the first quarter and the coach spent the rest
            of it handing off to a backup.
          </li>
          <li>
            No contract disputes. Your stocks aren&rsquo;t holding out for a
            better deal or demanding a trade to a contender.
          </li>
          <li>
            No coaching decisions. Nobody is benching your star for &ldquo;load
            management&rdquo; or moving it to a different role midseason because
            a new offensive coordinator wants to &ldquo;establish the run.&rdquo;
          </li>
        </ul>
      </RuleSection>

      <RuleSection title="Your Roster">
        <p>Every manager drafts the same structure:</p>
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            10 Starting Stocks — your core lineup, scored in every matchup.
            No bye weeks, no injuries. All ten available every single week.
          </li>
          <li>
            2 Bench Spots — hold backup stocks, swap them in during free
            agency.
          </li>
          <li>
            Crypto Flex Pool — $200,000 to invest across 1–3 cryptocurrencies,
            always live, always tradeable.
          </li>
        </ul>
        <p>Stocks come from the S&amp;P 500 pool. Crypto runs 24/7 and never locks.</p>
      </RuleSection>

      <RuleSection title="The Draft">
        <p>
          Salary cap draft. Every manager gets $80,000 per stock slot to
          spend on each of their 10 starters and 2 bench spots.
        </p>
        <p>
          Crypto works differently. Your $200,000 crypto budget is spent
          during the draft across as many coins as you want. The more
          managers that draft the same coin, the more expensive it gets —
          each additional buyer pays a surcharge:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1">
          <li>1st buyer: no surcharge</li>
          <li>2nd buyer: +5%</li>
          <li>3rd buyer: +10%</li>
          <li>4th buyer: +15%</li>
          <li>5th buyer: +20%</li>
          <li>6th+ buyer: +25%</li>
        </ul>
        <p>Surcharge money goes directly into the Weekly Bonus Pool.</p>
      </RuleSection>

      <RuleSection title="Weekly Scoring & Matchups">
        <p>
          Each week you face one opponent head-to-head. The manager whose
          portfolio gains more wins the matchup.
        </p>
        <p>
          Your score is based on your 10 starting stocks plus your crypto
          flex pool. Bench spots don&rsquo;t score.
        </p>
        <p>
          Stocks freeze at Friday 4:00 PM ET market close. Final scores lock
          Friday 4:00 PM ET.
        </p>
      </RuleSection>

      <RuleSection title="Daily Lineup Lock">
        <p>
          Lineups lock every day at 9:30 AM ET when the market opens — no
          swaps during market hours.
        </p>
        <p>
          At 4:00 PM ET market close, lineups unlock until the next
          morning&rsquo;s 9:30 AM lock. No free agent moves allowed — only bench
          moves. Free agents can only be picked up at the close of the week.
        </p>
        <p>Crypto is always exempt — buy, sell, and rebalance any time, no locks, ever.</p>
      </RuleSection>

      <RuleSection title="Free Agency">
        <p>
          Your roster is locked for the entire week — no pickups, drops, or
          adds from Monday 9:30 AM ET through Friday 4:00 PM ET.
        </p>
        <p>
          The free agent pickup window opens automatically at Friday 4:00 PM
          ET, right when trading closes for the week, and closes Monday 9:30
          AM ET. Claims are first-come, first-served — whichever request
          registers first gets the stock, no waiver order, no queue. In the
          rare case two claims land at the exact same instant, the
          tiebreaker goes to whichever team currently has the worse record in
          the standings — this only resolves genuine simultaneous conflicts,
          not general priority.
        </p>
      </RuleSection>

      <RuleSection title="League Format">
        <p>
          StockDraft Player Leagues (SDPL) come in five official sizes;
          all-AI leagues (SDAI) run the same 4-team format populated entirely
          by AI managers. The rules are identical across all sizes — only the
          number of managers differs:
        </p>
        <DocTable
          headers={["Format", "Teams", "Weekly Matchups", "Playoff Teams"]}
          rows={[
            ["SDPL2", "2 teams", "1 game/week", "Both teams"],
            ["SDPL4 / SDAI", "4 teams", "2 games/week", "All 4"],
            ["SDPL6", "6 teams", "3 games/week", "Top 4"],
            ["SDPL8", "8 teams", "4 games/week", "Top 4"],
            ["SDPL10", "10 teams", "5 games/week", "Top 4"],
            ["SDPL12", "12 teams", "6 games/week", "Top 4"],
          ]}
        />
        <p>
          All formats run 11 regular season weeks followed by a 2-week
          playoff. In a 2- or 4-team league, everyone (or nearly everyone)
          makes the playoffs; in a 12-team league, you need to earn it.
        </p>
      </RuleSection>

      <RuleSection title="Playoffs">
        <p>
          The top 4 teams (or all teams, in SDPL2) by regular season record
          advance. Seeding is by wins, then losses, then season gain
          percentage as a tiebreaker.
        </p>
        <p>
          Week 12 — Semifinals: #1 seed vs #4 seed, #2 seed vs #3 seed.
        </p>
        <p>
          Week 13 — Championship + 3rd Place: semifinal winners play for the
          championship; semifinal losers play for 3rd place.
        </p>
      </RuleSection>

      <RuleSection title="Weekly Bonus Awards">
        <p>
          Every week, 7 bonus awards are paid out from the $100,000 season
          bonus pool. Weekly base payout: $8,636/week. Award money deposits
          directly into your crypto flex pool.
        </p>
        <DocTable
          headers={["Award", "Payout", "How to Win"]}
          rows={[
            ["Winner of the Week", "$2,000", "Highest total dollar gain in the league"],
            ["Rookie of the Week", "$1,500", "Best single stock % gain"],
            ["Diamond Hands", "$1,500", "Biggest recovery swing on a stock held all week"],
            ["Lottery Hit", "$1,500", "A non-Top-100 stock up 10%+ on your roster"],
            ["Sweep Week", "$1,500", "Every single starter finishes green"],
            ["Loser of the Week", "$832", "Worst weekly % — a consolation prize, not a penalty"],
            ["Bench Curse", "$1", "Your bench outperformed your starters"],
          ]}
        />
        <p>Unclaimed awards roll into the Playoff Bonus Pool.</p>
      </RuleSection>

      <RuleSection title="Playoff Bonus Pool">
        <p>
          $5,000 is seeded into the Playoff Bonus Pool at the start of every
          season, plus every unclaimed weekly award throughout the year.
          When playoffs begin (Week 12), all playoff teams split the pool by
          seed:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1">
          <li>1st seed: 40%</li>
          <li>2nd seed: 25%</li>
          <li>3rd seed: 20%</li>
          <li>4th seed: 15%</li>
        </ul>
        <p>
          Each team&rsquo;s share is invested into one stock they currently own —
          starters or bench, their choice.
        </p>
      </RuleSection>

      <RuleSection title="Who Can Play">
        <p>
          StockDraft is open to all ages. Whether you&rsquo;re 14 or 114, if you
          want to learn how the market works while competing against
          friends, you&rsquo;re in.
        </p>
      </RuleSection>
    </>
  );
}

/** SDAI reuses the same SDPL_SDAI doc — there is no separate SDAI-only file. */
export function SdaiRulesContent() {
  return <SdplRulesContent />;
}

/** SDFL_Football_League_Rules.docx — verbatim. */
export function SdflRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        SDFL — Stock Draft Football League
      </p>
      <p>
        Mirrors the pro football season. 17-week regular season, playoff
        bracket mirrors their postseason. Season starts when the real league
        starts, ends when their league ends, and the championship lands the
        same week as the Championship Game. Our SDFL Bowl.
      </p>

      <RuleSection title="The Concept">
        <p>
          SDFL runs on the same core StockDraft engine as the Player Leagues
          (SDPL/SDAI) — same $80,000-per-slot salary cap draft, same daily
          lineup lock at market open/close, and free agency that opens
          automatically at Friday 4:00 PM ET (when trading closes for the
          week) through Monday 9:30 AM ET. Claims are first-come,
          first-served — whichever request registers first gets the stock; a
          genuine simultaneous tie is broken by worse record in the
          standings. Roster structure differs: 10 starters (7 stocks + 3
          crypto, fixed split) plus a 3-spot bench (stocks only) and 3 IR
          slots. See the base StockDraft Player League rules for those
          shared mechanics — one exception: the crypto surcharge system
          (same-coin pricing markup) does NOT apply here. SDFL&rsquo;s 3 crypto
          slots are fixed roster picks, not a flex pool, so there&rsquo;s
          nothing to surcharge.
        </p>
        <p>
          SDFL adds a sports-sim layer on top: it mirrors a real professional
          league&rsquo;s structure, schedule, and player outcomes — including the
          chaos (injuries, bye weeks, weather) that Player Leagues
          deliberately exclude.
        </p>
        <p>
          Remember everything SDPL and SDAI strip out? SDFL puts it right
          back in — on purpose:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            Real injuries. Your #1 pick can blow out a knee in Week 6, and
            your salary cap can&rsquo;t do a thing about it.
          </li>
          <li>
            Real bye weeks. Every stock sits one week out, just like the
            player it&rsquo;s mapped to.
          </li>
          <li>
            Real weather. A snowed-out game can tank a stock&rsquo;s score no
            matter how the market&rsquo;s doing that day.
          </li>
          <li>
            Real chaos. The one variable pure stock-picking skill can&rsquo;t
            price in — and that&rsquo;s exactly what makes it fun.
          </li>
        </ul>
      </RuleSection>

      <RuleSection title="Franchises & Draft Order">
        <p>32 franchises (pro football-mirrored), one per real-world team&rsquo;s market.</p>
        <p>
          Draft order mirrors real prior-season league standings — worst
          real-world record picks first, best record picks last. Until the
          live standings data pipeline is built, draft order defaults to
          random shuffle.
        </p>
      </RuleSection>

      <RuleSection title="Your City, Your Franchise">
        <p>
          When you join, you pick your franchise&rsquo;s city. The system
          validates it against a 100-mile radius from every real pro
          team&rsquo;s home market for that sport.
        </p>
        <p>
          First come, first served — once a city is claimed, it&rsquo;s gone.
          Cities within 100 miles of multiple pro markets get to choose
          which conference/division to represent.
        </p>
        <p>
          Every franchise identity (team name, brand) is user-created. The
          city only determines which division you belong to.
        </p>
      </RuleSection>

      <RuleSection title="The Stock-to-Player Mapping">
        <p>
          Every S&amp;P 500 stock is mapped to a real player in the sport,
          ranked in parallel — the #1 stock by market cap maps to the #1
          ranked player, stock #47 to player #47, and so on. When you draft
          a stock, you&rsquo;re drafting that player&rsquo;s history, and that
          history plays out on your roster.
        </p>
      </RuleSection>

      <RuleSection title="The Injury System">
        <p>
          Using real 2026 season injury data, stocks go to IR on the same
          schedule their mapped player actually got hurt. If the mapped
          player missed three weeks starting Week 6, your stock goes to IR
          in Week 6 for three weeks — you need a replacement.
        </p>
        <p>The injury schedule is published before every season so you can draft and plan around it.</p>
      </RuleSection>

      <RuleSection title="The IR Slot">
        <p>
          3 IR slots per roster, separate from bench spots. A stock on IR
          doesn&rsquo;t score and doesn&rsquo;t count against your active lineup. You
          can pick up a replacement during the free agency window. When the
          IR period ends (matching the real player&rsquo;s 2026 return date),
          your stock is eligible to return to your active lineup.
        </p>
      </RuleSection>

      <RuleSection title="Bye Weeks">
        <p>Every stock has a bye week matching the real team bye week of the player it&rsquo;s mapped to. During that week it doesn&rsquo;t score.</p>
      </RuleSection>

      <RuleSection title="Weather">
        <p>
          Outdoor stadium games in bad weather affect scoring — stocks
          mapped to players on teams playing in cold, rain, or snow
          conditions that week take a scoring modifier reflecting the real
          historical impact weather had on that 2026 game. Dome teams are
          unaffected.
        </p>
      </RuleSection>

      <RuleSection title="Bot Fill — Beta Only">
        <p>
          During the StockDraft beta, any open roster slot is filled by an
          AI manager, clearly identified in the standings. Once a real human
          claims a slot, the AI steps aside permanently. At full launch,
          unclaimed slots stay open — real humans only.
        </p>
      </RuleSection>

      <RuleSection title="Scheduling Cadence">
        <DocTable
          headers={["League", "Format", "Matchup Style"]}
          rows={[["SDFL", "Weekly", "1 matchup per week, scores lock Friday 4 PM ET"]]}
        />
      </RuleSection>

      <RuleSection title="Who Can Play">
        <p>StockDraft is open to all ages. Invite your friends!</p>
      </RuleSection>
    </>
  );
}

/** SDLB_SDHL_SDBA_Sim_League_Rules.docx — verbatim. */
export function SdlbSdhlSdbaRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        SDLB / SDHL / SDBA — Stock Draft Baseball, Hockey &amp; Basketball Leagues
      </p>
      <p>
        SDLB, SDHL, and SDBA share an identical rule set below — the only
        differences between the three are franchise count and matchup
        cadence, shown in the tables under Franchises and Scheduling
        Cadence.
      </p>

      <RuleSection title="Franchises & Scheduling Cadence by League">
        <DocTable
          headers={["League", "Mirrors", "Franchises", "Format", "Matchup Style"]}
          rows={[
            ["SDLB", "Pro Baseball", "30", "Series", "Same opponent 3–4 trading days, then rotate — 162 matchups/season"],
            ["SDHL", "Pro Hockey", "32", "Daily", "New opponent nearly every trading day, Mon–Fri"],
            ["SDBA", "Pro Basketball", "30", "Daily", "Same as SDHL — new opponent nearly every trading day, Mon–Fri"],
          ]}
        />
      </RuleSection>

      <RuleSection title="The Concept">
        <p>
          SDLB / SDHL / SDBA runs on the same core StockDraft engine as the
          Player Leagues (SDPL/SDAI) — same $80,000-per-slot salary cap
          draft, same daily lineup lock at market open/close. Roster
          structure differs: 10 starters (5 stocks + 5 crypto, fixed split)
          plus a 3-spot bench (stocks only). Stocks lock at 9:30 AM ET
          market open; crypto can be swapped in and out at any time. The
          SDPL/SDAI crypto surcharge system (same-coin pricing markup) does
          NOT apply here — these 5 crypto slots are fixed roster picks, not
          a flex pool, so there&rsquo;s nothing to surcharge.
        </p>

        <RuleCallout>
          <p className="font-bold" style={{ color: "#E8BE4A" }}>
            KEY DIFFERENCE FROM EVERY OTHER LEAGUE — Free agency opens Sunday
            4:00 PM ET, not Friday.
          </p>
          <p className="mt-1.5">
            Because SDLB/SDHL/SDBA scoring runs through the weekend (crypto
            keeps scoring Saturday and Sunday), trading and scoring for the
            week don&rsquo;t close until Sunday 4:00 PM ET — so free agency opens
            then instead of right after Friday&rsquo;s close like every other
            league. The free agent pick up period closes Monday 9:30 AM ET
            when the new week begins, same as everywhere else. Claims are
            first-come, first-served — whichever request registers first
            gets the stock; a genuine simultaneous tie is broken by worse
            record in the standings.
          </p>
        </RuleCallout>

        <p>
          SDLB / SDHL / SDBA adds a sports-sim layer that&rsquo;s on steroids in
          comparison to the SDFL season. The SDBA and SDHL are two seasons
          based on an 80+ game schedule. The ultimate StockDraft long play
          contest is the SDLB. A 162 game schedule.
        </p>
        <p>
          All based on stocks and crypto. A definitive tangible rather than
          relying on the physics of how far a ball can fly or be thrown and
          how many beers said player had the night before the game.
        </p>
        <p>
          Each league mirrors the real professional league&rsquo;s divisional
          layouts, the schedule, player outcomes, playoff structures. And
          including the chaos that Player Leagues deliberately exclude.
        </p>

        <p>
          Remember everything SDPL and SDAI strip out? SDLB/SDHL/SDBA puts
          it right back in — on purpose:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            Real injuries. Your best pick can go down mid-series or
            mid-week, and your salary cap can&rsquo;t do a thing about it.
          </li>
          <li>
            Real bye weeks. Every stock sits out on schedule, just like the
            player it&rsquo;s mapped to.
          </li>
          <li>
            Real weather. Outdoor games in bad weather can tank a stock&rsquo;s
            score no matter how the market&rsquo;s doing that day.
          </li>
          <li>
            Real chaos. The one variable pure stock-picking skill can&rsquo;t
            price in — and that&rsquo;s exactly what makes it fun.
          </li>
        </ul>
      </RuleSection>

      <RuleSection title="Franchises & Draft Order">
        <p>
          30 (SDLB, SDBA) or 32 (SDHL) franchises — see table above
          franchises, one per real-world team&rsquo;s market.
        </p>
        <p>
          Draft order mirrors real prior-season league standings — worst
          real-world record picks first, best record picks last. Until the
          live standings data pipeline is built, draft order defaults to
          random shuffle.
        </p>
      </RuleSection>

      <RuleSection title="Your City, Your Franchise">
        <p>
          When you join, you pick your franchise&rsquo;s city. The system
          validates it against a 100-mile radius from every real pro
          team&rsquo;s home market for that sport.
        </p>
        <p>
          First come, first served — once a city is claimed, it&rsquo;s gone.
          Cities within 100 miles of multiple pro markets get to choose
          which conference/division to represent.
        </p>
        <p>
          Every franchise identity (team name, brand) is user-created. The
          city only determines which division you belong to.
        </p>
      </RuleSection>

      <RuleSection title="The Stock-to-Player Mapping">
        <p>
          Every S&amp;P 500 stock is mapped to a real player in the sport,
          ranked in parallel — the #1 stock by market cap maps to the #1
          ranked player, stock #47 to player #47, and so on. When you draft
          a stock, you&rsquo;re drafting that player&rsquo;s history, and that
          history plays out on your roster.
        </p>
      </RuleSection>

      <RuleSection title="The Injury System">
        <p>
          Using real 2026 season injury data, stocks go to IR on the same
          schedule their mapped player actually got hurt. If the mapped
          player missed three weeks starting Week 6, your stock goes to IR
          in Week 6 for three weeks — you need a replacement.
        </p>
        <p>The injury schedule is published before every season so you can draft and plan around it.</p>
      </RuleSection>

      <RuleSection title="The IR Slot">
        <p>
          3 IR slots per roster, separate from bench spots. A stock on IR
          doesn&rsquo;t score and doesn&rsquo;t count against your active lineup. You
          can pick up a replacement during the free agency window. When the
          IR period ends (matching the real player&rsquo;s 2026 return date),
          your stock is eligible to return to your active lineup.
        </p>
      </RuleSection>

      <RuleSection title="Bye Weeks">
        <p>Every stock has a bye week matching the real team bye week of the player it&rsquo;s mapped to. During that week it doesn&rsquo;t score.</p>
      </RuleSection>

      <RuleSection title="Weather">
        <p>
          Outdoor stadium games in bad weather affect scoring — stocks
          mapped to players on teams playing in cold, rain, or snow
          conditions that week take a scoring modifier reflecting the real
          historical impact weather had on that 2026 game. Dome teams are
          unaffected.
        </p>
      </RuleSection>

      <RuleSection title="Bot Fill — Beta Only">
        <p>
          During the StockDraft beta, any open roster slot is filled by an
          AI manager, clearly identified in the standings. Once a real human
          claims a slot, the AI steps aside permanently. At full launch,
          unclaimed slots stay open — real humans only.
        </p>
      </RuleSection>

      <RuleSection title="Scheduling Cadence">
        <DocTable
          headers={["League", "Format", "Matchup Style"]}
          rows={[["SDLB/SDHL/SDBA", "Daily or Series", "See franchise table above for per-league cadence"]]}
        />
      </RuleSection>

      <RuleSection title="Who Can Play">
        <p>StockDraft is open to all ages. Invite your friends!</p>
      </RuleSection>
    </>
  );
}

/** Combined view — SDFL rules followed by the shared SDLB/SDHL/SDBA rules. */
export function SportsSimRulesContent() {
  return (
    <>
      <SdflRulesContent />
      <div className="mt-6" />
      <SdlbSdhlSdbaRulesContent />
    </>
  );
}

/** DayTrader_Contest_Rules.docx — verbatim. */
export function DayTraderRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        Day Trader — Free Weekly Contest
      </p>
      <p className="italic" style={{ color: "#A29A82" }}>
        Standalone contest, not a season league. Separate ruleset from
        SDPL/SDAI/SDFL/SDHL/SDBA/SDLB.
      </p>

      <RuleSection title="Overview">
        <p>
          Day Trader is a free weekly contest open to anyone with a
          StockDraft team. No new draft required — just pick one of your
          existing league teams as your entry. And it&rsquo;s not just bragging
          rights — real, sponsor-funded prizes are on the line every week.
        </p>
      </RuleSection>

      <RuleSection title="How It Works">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>Select any team from any league you&rsquo;re currently in</li>
          <li>
            Your 10 starting stocks are copied and reset to a flat $50,000
            each ($500,000 total) — leveling the playing field for everyone
          </li>
          <li>Trade freely during market hours (Monday 9:30 AM – Friday 4:00 PM ET)</li>
          <li>The week resets every Monday — enter a different team if you want</li>
          <li>
            Entry window: Opens Monday 10:00 AM ET. Lock in your team
            anytime until Monday 9:30 AM ET the following week, then trading
            begins.
          </li>
        </ul>
      </RuleSection>

      <RuleSection title="Leaderboards">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>Top $ Gainer — most total dollar gain on your $500K portfolio</li>
          <li>Top % Gainer — best percentage gain on your $500K portfolio</li>
        </ul>
        <p>Tied scores rank by earliest entry time — so signing up early matters.</p>
      </RuleSection>

      <RuleSection title="Prizes & Eligibility">
        <p>
          Weekly prizes are sponsor-funded and announced each Monday. No
          purchase necessary. Free to enter. One entry per user per week.
        </p>
        <p>
          Entrants must be 18 years or older. Void where prohibited by law.
        </p>
      </RuleSection>

      <RuleSection title="Sweepstakes Disclaimer">
        <p>
          No purchase necessary to enter or win. StockDraft is the sole
          sponsor of the Day Trader contest and any associated prizes.
          Prizes may be funded or provided by third-party sponsors named in
          that week&rsquo;s contest, but StockDraft is solely responsible for
          administering the contest, determining winners, and awarding
          prizes.
        </p>
        <p>
          This promotion is in no way sponsored, endorsed, administered by,
          or associated with Apple Inc. or Google LLC.
        </p>
      </RuleSection>
    </>
  );
}

/** SDDFS_Daily_Fantasy_Rules.docx — verbatim. */
export function SddfsRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        SDDFS — StockDraft Daily Fantasy Sport
      </p>
      <p className="italic" style={{ color: "#A29A82" }}>
        Standalone single-day contest, separate from season leagues. Shares
        its GICS-sector draft format and payout structure with SDWFS.
      </p>

      <RuleSection title="Overview">
        <p>
          SDDFS is a single-day put your money where your mouth is contest.
          Totally separate from your season leagues. Build a 12-pick lineup
          each morning, lock it in at the open, and see where you land when
          the market closes that afternoon. Watch your wallet grow and let
          that show everyone how well you know the stock market!
        </p>
        <RuleCallout>
          <p className="font-bold" style={{ color: "#E8BE4A" }}>
            SDDFS vs. the rest of StockDraft
          </p>
          <p className="mt-1.5">
            SDDFS is single-shot: once your lineup locks, there&rsquo;s no bench
            and no free agency to fix a bad pick — unlike SDPL/SDAI&rsquo;s
            season-long format, where a bad stock can be benched or swapped
            out in the next free agency window. Both formats are still pure
            market skill and luck — no injuries in either. The Sports Sim
            leagues (SDFL, SDHL, SDBA, SDLB) add a separate, unrelated luck
            layer on top of the market: real-player injuries, bye weeks, and
            weather can sideline your stock regardless of how it&rsquo;s trading
            — so winning those leagues takes even more luck than picking
            stocks alone. Among the four Sports Sim leagues, SDFL shares the
            same injury/bye/weather system as SDHL, SDBA, and SDLB, but
            differs in roster split (7 stocks + 3 crypto vs. 5 stocks + 5
            crypto) and matchup cadence (weekly vs. daily/series).
          </p>
        </RuleCallout>
      </RuleSection>

      <RuleSection title="Building Your Lineup">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            12 picks total — one stock or crypto from each of the 11 GICS
            sectors (Technology, Financials, Healthcare, Consumer
            Discretionary, Consumer Staples, Energy, Industrials, Materials,
            Real Estate, Utilities, Communication Services) plus one Crypto
            pick
          </li>
          <li>
            Picks are not exclusive — any number of players can roster the
            same stock or coin. It&rsquo;s not first-come-first-served, so draft
            the pick you think will actually move.
          </li>
          <li>One entry per contest, one contest per buy-in tier per day</li>
        </ul>
      </RuleSection>

      <RuleSection title="Contest Tiers">
        <DocTable
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
      </RuleSection>

      <RuleSection title="Lock, Scoring & Payouts">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>
            Lineups lock at 9:30 AM ET (market open) — make any last-minute
            swaps before then in the Free Agents panel on your entry&rsquo;s page
          </li>
          <li>
            Scored at 4:00 PM ET (market close) on each pick&rsquo;s open-to-close
            % change, summed across all 12 picks — highest total score wins
          </li>
          <li>
            Top 3 finishers split 50% / 30% / 20% of a prize pool equal to
            90% of all buy-ins collected
          </li>
          <li>
            Ties split the pooled share evenly across every tied entry, even
            when a tie straddles the paid places (e.g. a 3-way tie for 2nd
            splits the 2nd + 3rd shares evenly across all three)
          </li>
        </ul>
        <p>
          Track your live standings and projected payout anytime from My
          Teams — scores update throughout the day as the market moves, not
          just once at close.
        </p>
      </RuleSection>

      <RuleSection title="Games of Skill, Not Chance">
        <p>
          SDDFS is a game of skill. Outcomes are determined by each
          entrant&rsquo;s research, analysis, and selection of stocks and crypto
          — not random chance. This is the same legal basis on which daily
          fantasy sports operate in most U.S. states.
        </p>
      </RuleSection>

      <RuleSection title="Eligibility">
        <p>
          Entrants must be 18 years or older. Void where prohibited by law —
          SDDFS may not be available to residents of certain states or
          jurisdictions where paid-entry fantasy contests are restricted.
        </p>
      </RuleSection>

      <RuleSection title="Not Affiliated">
        <p>
          StockDraft and SDDFS are not affiliated with, endorsed by, or
          sponsored by the NYSE, Nasdaq, S&amp;P Dow Jones Indices, or any
          cryptocurrency exchange. Stock and crypto prices are used for
          scoring purposes only.
        </p>
      </RuleSection>
    </>
  );
}

/** SDWFS_Weekly_Fantasy_Rules.docx — verbatim. */
export function SdwfsRulesContent() {
  return (
    <>
      <p className="font-bold text-lg" style={{ color: "#E8BE4A" }}>
        SDWFS — StockDraft Weekly Fantasy Sport
      </p>
      <p className="italic" style={{ color: "#A29A82" }}>
        Standalone weekly contest, sibling of SDDFS, separate from season
        leagues.
      </p>

      <RuleSection title="Overview">
        <p>
          SDWFS is the weekly sibling of SDDFS, separate from your season
          leagues. Build a 12-pick lineup once entry opens, lock it in
          Monday morning, and see where you land when the market closes
          that Friday afternoon.
        </p>
        <RuleCallout>
          <p className="font-bold" style={{ color: "#E8BE4A" }}>
            SDWFS vs. the rest of StockDraft
          </p>
          <p className="mt-1.5">
            SDWFS is single-shot: once your lineup locks, there&rsquo;s no bench
            and no free agency to fix a bad pick — unlike SDPL/SDAI&rsquo;s
            season-long format, where a bad stock can be benched or swapped
            out in the next free agency window. Both formats are still pure
            market skill and luck — no injuries in either. The Sports Sim
            leagues (SDFL, SDHL, SDBA, SDLB) add a separate, unrelated luck
            layer on top of the market: real-player injuries, bye weeks, and
            weather can sideline your stock regardless of how it&rsquo;s trading
            — so winning those leagues takes even more luck than picking
            stocks alone. Among the four Sports Sim leagues, SDFL shares the
            same injury/bye/weather system as SDHL, SDBA, and SDLB, but
            differs in roster split (7 stocks + 3 crypto vs. 5 stocks + 5
            crypto) and matchup cadence (weekly vs. daily/series).
          </p>
        </RuleCallout>
      </RuleSection>

      <RuleSection title="Building Your Lineup">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>12 picks total — one stock or crypto from each of the 11 GICS sectors, plus one Crypto pick</li>
          <li>Picks are not exclusive — any number of players can roster the same stock or coin. It&rsquo;s not first-come-first-served.</li>
          <li>One entry per contest, one contest per buy-in tier per week</li>
          <li>Entry opens Monday 10:00 AM for next week&rsquo;s contest (or Monday morning if there&rsquo;s no prior contest)</li>
        </ul>
      </RuleSection>

      <RuleSection title="Contest Tiers">
        <DocTable
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
      </RuleSection>

      <RuleSection title="Lock, Scoring & Payouts">
        <ul className="list-disc list-outside ml-5 space-y-1.5">
          <li>Lineups lock at 9:30 AM ET Monday (market open) — make any last-minute swaps before then in the Free Agents panel on your entry&rsquo;s page</li>
          <li>Scored at 4:00 PM ET Friday (market close) on each pick&rsquo;s cumulative Monday-open-to-Friday-close % change, summed across all 12 picks — highest total score wins</li>
          <li>Top 3 finishers split 50% / 30% / 20% of a prize pool equal to 90% of all buy-ins collected</li>
          <li>Ties split the pooled share evenly across every tied entry, even when a tie straddles the paid places</li>
        </ul>
        <p>
          Track your live standings and projected payout anytime from My
          Teams — scores update throughout the week as the market moves, not
          just once at Friday&rsquo;s close.
        </p>
      </RuleSection>

      <RuleSection title="Games of Skill, Not Chance">
        <p>
          SDWFS is a game of skill. Outcomes are determined by each
          entrant&rsquo;s research, analysis, and selection of stocks and crypto
          — not random chance. This is the same legal basis on which daily
          fantasy sports operate in most U.S. states.
        </p>
      </RuleSection>

      <RuleSection title="Eligibility">
        <p>
          Entrants must be 18 years or older. Void where prohibited by law —
          SDWFS may not be available to residents of certain states or
          jurisdictions where paid-entry fantasy contests are restricted.
        </p>
      </RuleSection>

      <RuleSection title="Not Affiliated">
        <p>
          StockDraft and SDWFS are not affiliated with, endorsed by, or
          sponsored by the NYSE, Nasdaq, S&amp;P Dow Jones Indices, or any
          cryptocurrency exchange. Stock and crypto prices are used for
          scoring purposes only.
        </p>
      </RuleSection>
    </>
  );
}
