import type { DraftFeedEvent } from "@/lib/draft/types";
import { CRYPTO_POOL } from "@/lib/draft/types";
import type { BotPersonality } from "@/lib/league/bots";
import { BOT_BY_ID } from "@/lib/league/bots";
import type { LeagueBotMember } from "@/lib/league/league-bots";

export type BotReactionDraft = {
  userId: string;
  authorName: string;
  body: string;
  reactionKey: string;
  draftEventId: string;
};

function pickOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pushbackRoundEstimate(roundNumber: number, skipsRemaining: number): number {
  return Math.min(15, roundNumber + skipsRemaining + 1);
}

const CRYPTO_KING_FULL_POOL: string[] = [
  "Going all in. See you in round {returnRound}.",
  "Full send. Pushback is just a speed bump.",
  "The pool is empty. My portfolio is not.",
  "$200K into {symbol}. WAGMI.",
];

const ANALYST_MEGACAP: string[] = [
  "Predictable. Reliable. Mine.",
  "Highest market cap on the board. As expected.",
  "The data doesn't lie — {symbol} was the correct pick.",
  "Efficient markets, efficient draft.",
];

const GAMBLER_REACTIONS: Record<string, string[]> = {
  crypto_full_pool: [
    "Love the chaos. I'll be here when it blows up.",
    "All in? Respect. I'm still taking lottery tickets.",
  ],
  pushback_skip: [
    "{team} just bought a timeout. I'll take the extra stock.",
    "Pushback for {team}? More volatility for the rest of us.",
  ],
  analyst_pick: [
    "Safe pick. Someone has to boring-draft.",
    "{team} took the megacap again. Yawn — give me mid-cap fireworks.",
  ],
};

const CONTRARIAN_REACTIONS: Record<string, string[]> = {
  pushback_skip: [
    "Everyone zigged with crypto. {team} zagged into a skip.",
    "Pushback pain for {team}. The crowd never learns.",
  ],
  analyst_pick: [
    "Of course {team} took the biggest name. I'll fade the consensus.",
  ],
};

const VALUE_HUNTER_REACTIONS: Record<string, string[]> = {
  pushback_skip: ["{team} paid the pushback tax. I'll be shopping the dip."],
  stock_pick: ["Nice price on {symbol}. Hope {team} got a discount."],
};

const MOMENTUM_REACTIONS: Record<string, string[]> = {
  stock_pick: ["{symbol} is running — {team} is riding the wave."],
  pushback_skip: ["Skipping a round? Momentum waits for no one."],
};

const DIVERSIFIER_REACTIONS: Record<string, string[]> = {
  stock_pick: ["Another sector on the board. Balance matters."],
};

const SLEEPER_REACTIONS: Record<string, string[]> = {
  analyst_pick: ["Megacap again? I'll be in the mid-cap shadows."],
  stock_pick: ["Hidden gem or obvious pick? Time will tell."],
};

const BENCH_HOARDER_REACTIONS: Record<string, string[]> = {
  bench_pick: ["Bench stash growing. Starters can wait."],
};

const DAY_TRADER_REACTIONS: Record<string, string[]> = {
  crypto_pick: ["Nice fill. I'll be swapping mine all season anyway."],
  auto_pick: ["Timer ran out? Always have a backup plan."],
};

const SECTOR_LOYALIST_REACTIONS: Record<string, string[]> = {
  stock_pick: ["Stay in your lane, {team}. My sector is coming."],
};

const HOMER_REACTIONS: Record<string, string[]> = {
  stock_pick: ["Local pride draft? I respect the homer energy."],
};

const PUSHER_SELF: Partial<Record<BotPersonality, string[]>> = {
  crypto_king: [
    "Worth it. See you when I un-skip.",
    "Pushback accepted. Crypto first, stocks later.",
  ],
  gambler: ["Skipped a round? I'll make up for it with chaos."],
  analyst: ["An unfortunate but calculated delay."],
};

const OBSERVER_BY_PERSONALITY: Partial<
  Record<
    BotPersonality,
    (ctx: {
      event: DraftFeedEvent;
      teamName: string;
      symbol: string;
    }) => string | null
  >
> = {
  gambler: (ctx) => {
    if (ctx.event.pick_type === "skip") {
      return fillTemplate(pickOne(GAMBLER_REACTIONS.pushback_skip), ctx);
    }
    if (
      ctx.event.pick_type === "crypto" &&
      ctx.event.budget_spent >= CRYPTO_POOL - 1000
    ) {
      return pickOne(GAMBLER_REACTIONS.crypto_full_pool);
    }
    if (BOT_BY_ID.get(ctx.event.user_id)?.personality === "analyst") {
      return fillTemplate(pickOne(GAMBLER_REACTIONS.analyst_pick), ctx);
    }
    return null;
  },
  contrarian: (ctx) => {
    if (ctx.event.pick_type === "skip") {
      return fillTemplate(pickOne(CONTRARIAN_REACTIONS.pushback_skip), ctx);
    }
    if (BOT_BY_ID.get(ctx.event.user_id)?.personality === "analyst") {
      return fillTemplate(pickOne(CONTRARIAN_REACTIONS.analyst_pick), ctx);
    }
    return null;
  },
  value_hunter: (ctx) => {
    if (ctx.event.pick_type === "skip") {
      return fillTemplate(pickOne(VALUE_HUNTER_REACTIONS.pushback_skip), ctx);
    }
    if (ctx.event.pick_type === "stock") {
      return fillTemplate(pickOne(VALUE_HUNTER_REACTIONS.stock_pick), ctx);
    }
    return null;
  },
  momentum_chaser: (ctx) => {
    if (ctx.event.pick_type === "skip") {
      return pickOne(MOMENTUM_REACTIONS.pushback_skip);
    }
    if (ctx.event.pick_type === "stock") {
      return fillTemplate(pickOne(MOMENTUM_REACTIONS.stock_pick), ctx);
    }
    return null;
  },
  diversifier: (ctx) => {
    if (ctx.event.pick_type === "stock" || ctx.event.pick_type === "bench") {
      return pickOne(DIVERSIFIER_REACTIONS.stock_pick);
    }
    return null;
  },
  sleeper: (ctx) => {
    if (BOT_BY_ID.get(ctx.event.user_id)?.personality === "analyst") {
      return pickOne(SLEEPER_REACTIONS.analyst_pick);
    }
    if (ctx.event.pick_type === "stock") {
      return pickOne(SLEEPER_REACTIONS.stock_pick);
    }
    return null;
  },
  bench_hoarder: (ctx) => {
    if (ctx.event.pick_type === "bench") {
      return pickOne(BENCH_HOARDER_REACTIONS.bench_pick);
    }
    return null;
  },
  day_trader: (ctx) => {
    if (ctx.event.is_auto_pick) {
      return pickOne(DAY_TRADER_REACTIONS.auto_pick);
    }
    if (ctx.event.pick_type === "crypto") {
      return pickOne(DAY_TRADER_REACTIONS.crypto_pick);
    }
    return null;
  },
  sector_loyalist: (ctx) => {
    if (ctx.event.pick_type === "stock") {
      return fillTemplate(pickOne(SECTOR_LOYALIST_REACTIONS.stock_pick), ctx);
    }
    return null;
  },
  homer: (ctx) => {
    if (ctx.event.pick_type === "stock") {
      return pickOne(HOMER_REACTIONS.stock_pick);
    }
    return null;
  },
};

function fillTemplate(
  template: string,
  ctx: { teamName: string; symbol: string; returnRound?: number }
): string {
  return template
    .replace(/\{team\}/g, ctx.teamName)
    .replace(/\{symbol\}/g, ctx.symbol)
    .replace(/\{returnRound\}/g, String(ctx.returnRound ?? "?"));
}

function getPickerPersonality(
  event: DraftFeedEvent,
  leagueBots: LeagueBotMember[]
): BotPersonality | null {
  const bot = leagueBots.find((b) => b.id === event.user_id);
  if (bot) return bot.personality;
  return BOT_BY_ID.get(event.user_id)?.personality ?? null;
}

export function generateBotReactionsForDraftEvent(
  event: DraftFeedEvent,
  leagueBots: LeagueBotMember[],
  options?: { pushbackSkipsRemaining?: number; stealth?: boolean }
): BotReactionDraft[] {
  if (options?.stealth) {
    if (Math.random() > 0.12 || leagueBots.length === 0) {
      return [];
    }

    const candidates = leagueBots.filter((bot) => bot.id !== event.user_id);
    if (candidates.length === 0) return [];

    const speaker = pickOne(candidates);
    const neutralLines = [
      "nice pick",
      "good luck",
      "solid",
      "lets go",
    ];

    return [
      {
        userId: speaker.id,
        authorName: speaker.displayName,
        body: pickOne(neutralLines),
        reactionKey: `${event.id}:stealth:${speaker.id}`,
        draftEventId: event.id,
      },
    ];
  }

  const reactions: BotReactionDraft[] = [];
  const pickerPersonality = getPickerPersonality(event, leagueBots);
  const pickerIsBot =
    leagueBots.some((bot) => bot.id === event.user_id) ||
    BOT_BY_ID.has(event.user_id);
  const templateCtx = {
    teamName: event.team_name,
    symbol: event.symbol,
    returnRound: pushbackRoundEstimate(
      event.round_number,
      options?.pushbackSkipsRemaining ?? 1
    ),
  };

  if (
    pickerPersonality === "crypto_king" &&
    event.pick_type === "crypto" &&
    event.budget_spent >= CRYPTO_POOL - 1000
  ) {
    reactions.push({
      userId: event.user_id,
      authorName: event.team_name,
      body: fillTemplate(pickOne(CRYPTO_KING_FULL_POOL), templateCtx),
      reactionKey: `${event.id}:picker:crypto_full`,
      draftEventId: event.id,
    });
  }

  if (
    pickerPersonality === "analyst" &&
    (event.pick_type === "stock" || event.pick_type === "bench")
  ) {
    reactions.push({
      userId: event.user_id,
      authorName: event.team_name,
      body: fillTemplate(pickOne(ANALYST_MEGACAP), templateCtx),
      reactionKey: `${event.id}:picker:analyst_megacap`,
      draftEventId: event.id,
    });
  }

  if (event.pick_type === "skip" && pickerIsBot && pickerPersonality) {
    const lines = PUSHER_SELF[pickerPersonality];
    if (lines) {
      reactions.push({
        userId: event.user_id,
        authorName: event.team_name,
        body: pickOne(lines),
        reactionKey: `${event.id}:picker:pushback_self`,
        draftEventId: event.id,
      });
    }
  }

  if (event.pick_type === "skip" && !pickerIsBot) {
    const speaker = leagueBots[0] ?? null;
    if (speaker) {
      reactions.push({
        userId: speaker.id,
        authorName: speaker.displayName,
        body: fillTemplate(
          pickOne([
            "Pushback got {team}. Enjoy the wait.",
            "{team} triggered pushback — that's a round off the board.",
            "Crypto tax collected from {team}.",
          ]),
          templateCtx
        ),
        reactionKey: `${event.id}:observer:human_pushback`,
        draftEventId: event.id,
      });
    }
  }

  const observerCandidates = leagueBots.filter((bot) => {
    if (bot.id === event.user_id) return false;
    if (reactions.some((r) => r.userId === bot.id)) return false;
    const fn = OBSERVER_BY_PERSONALITY[bot.personality];
    if (!fn) return false;
    return Boolean(fn({ event, ...templateCtx }));
  });

  const observerCount =
    event.pick_type === "skip" || event.budget_spent >= CRYPTO_POOL - 1000
      ? 2
      : 1;

  const shuffled = [...observerCandidates].sort(() => Math.random() - 0.5);
  for (const bot of shuffled.slice(0, observerCount)) {
    const fn = OBSERVER_BY_PERSONALITY[bot.personality]!;
    const body = fn({ event, ...templateCtx });
    if (!body) continue;
    reactions.push({
      userId: bot.id,
      authorName: bot.displayName,
      body,
      reactionKey: `${event.id}:observer:${bot.personality}`,
      draftEventId: event.id,
    });
  }

  return reactions;
}
