/**
 * The pricing contract.
 *
 * Two rules are enforced here by the type system rather than by discipline,
 * because discipline is what failed the last four times:
 *
 *   1. A price is never separated from the moment it was taken. No shape in
 *      this file carries a number without an `asOf` beside it.
 *   2. "I don't know" is a value the caller has to handle, not a number it can
 *      accidentally do arithmetic on. Every lookup is a discriminated union,
 *      so a missing price cannot be summed, averaged, or written as a baseline
 *      without the compiler objecting first.
 *
 * Every incident this system has had was the same mistake underneath: a failed
 * read became a plausible number somewhere below the layer that could have
 * caught it. $0 baselines scoring a week as -100%. A junk $0.15 open on an $86
 * stock scoring +57,320%. A months-old bundled snapshot served as a live quote,
 * so two people looking at one contest at one moment saw different totals. A
 * rate-limited call quietly falling back to a stale row.
 *
 * None of those were careless. Each one was a reasonable fallback written by
 * someone trying to stop a league breaking over one late symbol. The flaw was
 * always the same: the fallback returned something indistinguishable from a
 * real answer, so nothing retried it and nothing logged it. These types remove
 * the option.
 */

/** Where a price came from. Recorded so a wrong number can be traced later. */
export type PriceSource = "finnhub" | "coingecko" | "store";

/**
 * A real, current-enough price for one symbol.
 *
 * Construction is guarded (see `makePrice`): a Price cannot exist with a
 * non-positive or non-finite value, so `price > 0` checks downstream become
 * redundant rather than load-bearing.
 */
export type Price = {
  readonly symbol: string;
  /** USD. Always finite and > 0 — enforced at construction. */
  readonly price: number;
  /** Percent change on the day. 0 is a legitimate value here, unlike `price`. */
  readonly changePercent: number;
  /** When this price was observed at its source — never when it was read. */
  readonly asOf: Date;
  readonly source: PriceSource;
};

/**
 * Why a price is missing.
 *
 * Kept specific because the right response differs per case: `too-stale` and
 * `rate-limited` are worth retrying in a minute, `no-quote` on a delisted
 * ticker never is, and `not-attempted` means the budget ran out and the symbol
 * was never actually asked about — which is not the same as it being
 * unavailable, and previously got logged as though it were.
 */
export type PriceFailure =
  | "no-quote"
  | "too-stale"
  | "rate-limited"
  | "provider-error"
  | "frozen"
  | "not-attempted";

/** A price that could not be produced, and why. Never carries a number. */
export type PriceUnavailable = {
  readonly symbol: string;
  readonly reason: PriceFailure;
  /** Log-ready, already names the symbol. */
  readonly detail: string;
};

/** The only thing a price lookup can return. */
export type PriceLookup =
  | ({ readonly status: "ok" } & Price)
  | ({ readonly status: "unavailable" } & PriceUnavailable);

/**
 * How old a price may be before the caller would rather have nothing at all.
 *
 * This is the parameter the old system was missing entirely. It had one shared
 * quote path serving products with opposite needs — a day-trading simulator
 * that needs prices by the second and a season league that needs two prices a
 * day — and no way for either to say which it was. So the path was tuned for
 * neither: the lock/close path enforced 35 minutes, and the live trading path
 * enforced nothing at all, which is exactly backwards.
 *
 * Every caller now states its own requirement, and the requirement travels with
 * the request instead of living as a constant next to the fetcher.
 */
export const Freshness = {
  /**
   * Day Trader: trades execute against this, and a stale price here is not
   * just wrong, it is exploitable — a stock that moves after the last refresh
   * could otherwise be bought at the old price until the table caught up.
   */
  LIVE: 60_000,
  /** DFS lock and close. Tight enough that a full-day move isn't distorted. */
  LOCK: 5 * 60_000,
  /** Roster screens and standings — current enough to look right, cheap. */
  INTRADAY: 30 * 60_000,
  /** Season leagues between snapshots. Two prices a day is the real need. */
  DAILY: 24 * 60 * 60_000,
} as const;

export type FreshnessMs = number;

/**
 * Builds a Price, or returns null if the inputs can't support one.
 *
 * The single place a Price comes into existence, so the "always positive,
 * always finite, always timestamped" guarantee holds everywhere by
 * construction rather than by every caller remembering to check.
 */
export function makePrice(input: {
  symbol: string;
  price: number;
  changePercent?: number;
  asOf: Date;
  source: PriceSource;
}): Price | null {
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const asOf = input.asOf;
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) return null;

  const changePercent = Number(input.changePercent ?? 0);

  return {
    symbol: input.symbol.trim().toUpperCase(),
    price,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    asOf,
    source: input.source,
  };
}

export function unavailable(
  symbol: string,
  reason: PriceFailure,
  detail?: string
): { status: "unavailable" } & PriceUnavailable {
  const upper = symbol.trim().toUpperCase();
  return {
    status: "unavailable",
    symbol: upper,
    reason,
    detail: detail ?? `${upper}: ${reason}`,
  };
}

export function available(price: Price): { status: "ok" } & Price {
  return { status: "ok", ...price };
}

/** True when the price is within `maxAgeMs` of `now`. */
export function isFreshEnough(
  price: Price,
  maxAgeMs: FreshnessMs,
  now: Date = new Date()
): boolean {
  const age = now.getTime() - price.asOf.getTime();
  // A negative age means a clock skew between us and the source; treat it as
  // fresh rather than as an error, but never as older than it claims to be.
  return age <= maxAgeMs;
}

/**
 * The result of a batch lookup.
 *
 * Deliberately not a bare Map. Callers reach for `.priceOf()` and get
 * `number | null`, which forces the missing case into view at the point of use;
 * `.missing()` gives the failures back as a list so a caller can log exactly
 * which symbols it could not price, by name, instead of discovering later that
 * a total was quietly computed over a subset.
 */
export class PriceBook {
  private readonly entries: ReadonlyMap<string, PriceLookup>;
  readonly asked: readonly string[];

  constructor(entries: Map<string, PriceLookup>, asked: readonly string[]) {
    this.entries = entries;
    this.asked = asked;
  }

  lookup(symbol: string): PriceLookup {
    const key = symbol.trim().toUpperCase();
    return (
      this.entries.get(key) ??
      unavailable(key, "not-attempted", `${key}: never requested`)
    );
  }

  /** The price, or null if unavailable. The main accessor. */
  priceOf(symbol: string): number | null {
    const found = this.lookup(symbol);
    return found.status === "ok" ? found.price : null;
  }

  /** The full Price record, or null — when the caller needs `asOf` too. */
  priceRecord(symbol: string): Price | null {
    const found = this.lookup(symbol);
    return found.status === "ok" ? found : null;
  }

  has(symbol: string): boolean {
    return this.lookup(symbol).status === "ok";
  }

  /** Every symbol that could not be priced, with its reason. */
  missing(): PriceUnavailable[] {
    const out: PriceUnavailable[] = [];
    for (const symbol of this.asked) {
      const found = this.lookup(symbol);
      if (found.status === "unavailable") out.push(found);
    }
    return out;
  }

  get complete(): boolean {
    return this.missing().length === 0;
  }

  get resolvedCount(): number {
    return this.asked.length - this.missing().length;
  }

  /**
   * One log line naming every symbol that failed and why, or null when the
   * book is complete. Callers log this rather than composing their own, so a
   * partial result is never reported as a success — which is how three days of
   * contests once sat open without an error anywhere.
   */
  describeGaps(): string | null {
    const gaps = this.missing();
    if (gaps.length === 0) return null;

    const byReason = new Map<PriceFailure, string[]>();
    for (const gap of gaps) {
      const list = byReason.get(gap.reason) ?? [];
      list.push(gap.symbol);
      byReason.set(gap.reason, list);
    }

    const parts = [...byReason.entries()].map(
      ([reason, symbols]) => `${reason}: ${symbols.sort().join(", ")}`
    );

    return `${gaps.length} of ${this.asked.length} symbol(s) unpriced — ${parts.join(" | ")}`;
  }
}
