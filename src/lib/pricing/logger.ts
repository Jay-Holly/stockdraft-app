import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";
import { isUsMarketOpen, getNyDateString } from "@/lib/market/hours";
import { fetchFinnhubFullQuote, fetchAlpacaSnapshots } from "@/lib/pricing/providers";
import { fetchCoinGeckoPrices, successesOf } from "@/lib/pricing/providers";
import { fetchDailyOpenClose } from "@/lib/market/twelve-data";
import {
  startSweep,
  finishSweep,
  existingAnchors,
  writeObservations,
  updateSweepProgress,
  orderByStaleness,
  type Observation,
} from "@/lib/pricing/log-store";

/**
 * The logger.
 *
 * The only code allowed to call a market data provider for scoring purposes.
 * Stocks: Alpaca is primary (one batch call prices the whole pool — verified
 * against the live API 2026-08-29, 502 symbols, 351ms), Finnhub is the
 * fallback for whatever Alpaca doesn't return, and Twelve Data is the third
 * line — only for whatever both of those miss, and only for the day's open
 * or close, not routine samples. That scoping is deliberate, not partial
 * coverage: Twelve Data's free tier is 800 calls/day, so it cannot carry
 * volume, and its proven strength (see src/lib/market/twelve-data.ts,
 * restored from main) is recovering a specific day's open/close from minute
 * bars after the fact — exactly what a settlement anchor needs, not what a
 * live tick needs. Equities only, enforced inside that module — never crypto
 * (RAIN resolved to a different token at 2.3x off on 2026-08-12; do not
 * re-litigate).
 * Crypto: CoinGecko.
 * Everything else — every contest, every leaderboard, every page — reads
 * `price_log` and never calls a provider directly. That boundary is the
 * entire point of today's rebuild; see SCORING_REBUILD_HANDOFF_2026-08-28.md.
 *
 * One run = one sweep. A sweep:
 *   1. Reads the symbol universe (draft_pool + crypto_pool) via the service
 *      client — the user-scoped client silently returns zero rows in a
 *      cron context (RLS scopes it to a session that doesn't exist), which
 *      is the exact bug documented in crypto-pool/server.ts. Never repeat it
 *      here.
 *   2. Fetches every symbol, paced under the provider's rate limit (handled
 *      inside providers.ts's shared limiter).
 *   3. Writes one `sample` observation per symbol, success or failure — a
 *      failure is never converted into a number.
 *   4. Backfills a missing `open` anchor for any stock that doesn't have one
 *      yet today, using the `o` field every quote already carries — no
 *      separate "opening sweep" required.
 *   5. Writes a `close` anchor for any stock that doesn't have one yet,
 *      once the market is no longer open (the close is only real once
 *      trading has stopped).
 *   6. Crypto never closes, so its `open`/`close` anchors are wall-clock
 *      snapshots at 9:30 AM and 4:00 PM ET rather than a market event —
 *      captured whichever sweep happens to be running in that minute.
 */

const OPEN_ANCHOR_WINDOW = { startMin: 9 * 60 + 25, endMin: 9 * 60 + 40 };
const CLOSE_ANCHOR_WINDOW = { startMin: 15 * 60 + 55, endMin: 16 * 60 + 10 };

function nyMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function inWindow(date: Date, w: { startMin: number; endMin: number }): boolean {
  const m = nyMinutesOfDay(date);
  return m >= w.startMin && m <= w.endMin;
}

export type SweepResult = {
  sweepId: number;
  status: "complete" | "partial" | "failed" | "frozen";
  symbolsRequested: number;
  symbolsOk: number;
  symbolsFailed: number;
  apiCalls: number;
  durationMs: number;
};

async function readStockUniverse(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("draft_pool").select("symbol");
  if (error) {
    console.error(`[logger] failed to read draft_pool: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => String(r.symbol).toUpperCase());
}

async function readCryptoUniverse(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("crypto_pool").select("symbol");
  if (error) {
    console.error(`[logger] failed to read crypto_pool: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r) => String(r.symbol).toUpperCase());
}

export async function runSweep(options: {
  triggeredBy: "cron" | "manual";
  triggeredByUser?: string;
  /** Test/dry-run hook: cap how many stock symbols this sweep touches. */
  limitStocks?: number;
  /**
   * Restrict the sweep to exactly these symbols — the admin page's
   * "re-fetch this one" button. Takes priority over `limitStocks`.
   */
  onlySymbols?: readonly string[];
}): Promise<SweepResult> {
  const started = Date.now();
  const now = new Date();
  const sessionDate = getNyDateString(now);

  /**
   * The cron route caps a single invocation at 300s (Vercel's own limit, see
   * `maxDuration` in the route). This sweep must finish and self-report well
   * inside that, not get killed by the platform mid-loop — a killed process
   * never calls finishSweep, which is exactly how sweep #8 (2026-08-29) got
   * stuck reporting "running" forever until someone found it by hand.
   *
   * 260s leaves ~40s of margin for whatever runs after the deadline check —
   * the crypto call, the Twelve Data call, final bookkeeping — none of which
   * themselves watch this clock, so they need room already banked for them.
   */
  const sweepHardDeadline = started + 260_000;

  if (isPricingFrozen()) {
    const sweepId = await startSweep({
      kind: "sample",
      assetClass: "all",
      symbolsRequested: 0,
      triggeredBy: options.triggeredBy,
      triggeredByUser: options.triggeredByUser,
    });
    await finishSweep(sweepId, {
      ok: 0,
      failed: 0,
      apiCalls: 0,
      error: "pricing is frozen (src/lib/market/pricing-freeze.ts) — no provider calls made",
    });
    return {
      sweepId,
      status: "frozen",
      symbolsRequested: 0,
      symbolsOk: 0,
      symbolsFailed: 0,
      apiCalls: 0,
      durationMs: Date.now() - started,
    };
  }

  const [stockUniverse, cryptoUniverse] = await Promise.all([
    readStockUniverse(),
    readCryptoUniverse(),
  ]);

  const wanted = options.onlySymbols
    ? new Set(options.onlySymbols.map((s) => s.trim().toUpperCase()))
    : null;

  let stocks = wanted ? stockUniverse.filter((s) => wanted.has(s)) : stockUniverse;
  let crypto = wanted ? cryptoUniverse.filter((s) => wanted.has(s)) : cryptoUniverse;

  if (!wanted && options.limitStocks) {
    stocks = stocks.slice(0, options.limitStocks);
  }

  const symbolsRequested = stocks.length + crypto.length;
  const sweepId = await startSweep({
    kind: "sample",
    assetClass: "all",
    symbolsRequested,
    triggeredBy: options.triggeredBy,
    triggeredByUser: options.triggeredByUser,
  });

  let apiCalls = 0;
  let ok = 0;
  let failed = 0;

  // Progress is written to the DB roughly twice a second, not on every
  // symbol — a stock sweep against 553 symbols already spends ~1.2s per
  // provider call on rate-limit pacing, so a DB round-trip per symbol adds
  // real time for no benefit an admin page polling every 1-2s could see.
  let lastProgressWrite = 0;
  async function reportProgress(force = false) {
    const now = Date.now();
    if (!force && now - lastProgressWrite < 500) return;
    lastProgressWrite = now;
    await updateSweepProgress(sweepId, { ok, failed, apiCalls });
  }

  // --- Stocks: Alpaca first, one batch call for everyone. ---
  const marketOpen = isUsMarketOpen(now);
  const wantOpenAnchor = inWindow(now, OPEN_ANCHOR_WINDOW) || marketOpen;
  const wantCloseAnchor = !marketOpen;

  const [haveOpen, haveClose] = await Promise.all([
    wantOpenAnchor ? existingAnchors(sessionDate, "open") : Promise.resolve(new Set<string>()),
    wantCloseAnchor ? existingAnchors(sessionDate, "close") : Promise.resolve(new Set<string>()),
  ]);

  let sweepRejected = 0;

  /** Shared by both providers — a symbol's quote becomes the same three log rows either way. */
  async function writeStockQuote(
    symbol: string,
    q: { price: number; changePercent: number; dayOpen: number | null; dayHigh: number | null; dayLow: number | null; asOf: Date },
    source: "alpaca" | "finnhub"
  ): Promise<void> {
    const rows: Observation[] = [
      {
        symbol,
        assetClass: "stock",
        kind: "sample",
        sessionDate,
        price: q.price,
        changePercent: q.changePercent,
        dayHigh: q.dayHigh ?? undefined,
        dayLow: q.dayLow ?? undefined,
        asOf: q.asOf,
        source,
        sweepId,
      },
    ];

    if (wantOpenAnchor && !haveOpen.has(symbol) && q.dayOpen) {
      rows.push({
        symbol,
        assetClass: "stock",
        kind: "open",
        sessionDate,
        price: q.dayOpen,
        dayHigh: q.dayHigh ?? undefined,
        dayLow: q.dayLow ?? undefined,
        // The open is only true at market open, not at whatever second this
        // sweep happened to run — even when captured on a later backfill.
        asOf: nySessionMoment(sessionDate, 9, 30),
        source,
        sweepId,
      });
      haveOpen.add(symbol);
    }

    if (wantCloseAnchor && !haveClose.has(symbol)) {
      rows.push({
        symbol,
        assetClass: "stock",
        kind: "close",
        sessionDate,
        price: q.price,
        dayHigh: q.dayHigh ?? undefined,
        dayLow: q.dayLow ?? undefined,
        asOf: nySessionMoment(sessionDate, 16, 0),
        source,
        sweepId,
      });
      haveClose.add(symbol);
    }

    const { rejected } = await writeObservations(rows);
    sweepRejected += rejected;
  }

  const stillNeeded: string[] = [];

  if (stocks.length > 0) {
    const alpacaResults = await fetchAlpacaSnapshots(stocks);
    apiCalls++;

    for (const symbol of stocks) {
      const result = alpacaResults.get(symbol);
      if (result?.status === "ok") {
        ok++;
        await writeStockQuote(symbol, result.quote, "alpaca");
      } else {
        // Not written as a failure yet — Alpaca missing it isn't the final
        // answer, only Finnhub coming up empty too is. Logged as a failure
        // here would double-count a symbol Finnhub goes on to resolve.
        stillNeeded.push(symbol);
      }
    }
    await reportProgress(true);
  }

  // --- Finnhub: fallback, per-symbol, only for whatever Alpaca missed. ---
  // In steady state this list should be short — one bad batch response, not
  // the whole pool. If Alpaca is genuinely down, though, this is the ENTIRE
  // pool, one symbol per call, ~10 minutes — well past what a single cron
  // invocation is allowed to run (SWEEP_HARD_DEADLINE_MS below). Rather than
  // let the platform kill the process mid-loop and leave the sweep stuck at
  // "running" forever (see sweep #8, 2026-08-29 — cleaned up by hand because
  // nothing else would have), this loop watches its own clock, stops itself
  // with time to spare, and marks whatever it didn't reach as `not-attempted`
  // — an honest "ran out of budget", never silently dropped.
  //
  // Stalest-first ordering is what makes that safe to do repeatedly: a
  // deadline cutting this run off after (say) symbol 250 means the NEXT
  // sweep — which re-sorts by staleness again — picks up symbols 251 onward
  // first, not symbol 1 again. An extended outage degrades into steadily
  // widening coverage across repeated runs instead of the same alphabetical
  // prefix getting refreshed over and over while the rest goes stale.
  const stillFailed: string[] = [];
  const notAttempted: string[] = [];

  if (stillNeeded.length > 0) {
    const orderedByStaleness = await orderByStaleness(stillNeeded);

    for (let i = 0; i < orderedByStaleness.length; i++) {
      if (Date.now() >= sweepHardDeadline) {
        // Everything from here on is exactly what didn't get a turn this
        // run — the next sweep re-sorts by staleness and picks these up
        // first, since they're now the most-overdue symbols in the pool.
        notAttempted.push(...orderedByStaleness.slice(i));
        break;
      }

      const symbol = orderedByStaleness[i];
      const result = await fetchFinnhubFullQuote(symbol);
      apiCalls++;

      if (result.status !== "ok") {
        stillFailed.push(symbol);
      } else {
        ok++;
        await writeStockQuote(symbol, result.quote, "finnhub");
      }

      await reportProgress();
    }
    await reportProgress(true);

    if (notAttempted.length > 0) {
      failed += notAttempted.length;
      const rows: Observation[] = notAttempted.map((symbol) => ({
        symbol,
        assetClass: "stock",
        kind: "sample",
        sessionDate,
        failureReason: "not-attempted",
        source: "finnhub",
        sweepId,
      }));
      const { rejected } = await writeObservations(rows);
      sweepRejected += rejected;
      console.error(
        `[logger] sweep ${sweepId}: hit its time budget with ${notAttempted.length} symbol(s) still unattempted — picked up first by the next sweep`
      );
    }
  }

  // --- Twelve Data: third line, only for what both live sources missed. ---
  // Not a "give me a current price" call — it recovers the day's open/close
  // from minute-bar history, which is what a settlement anchor actually
  // needs. See the module docstring for why this isn't used for routine
  // sampling. One batched call for the whole remaining list.
  if (stillFailed.length > 0) {
    const recovered = await fetchDailyOpenClose(stillFailed, sessionDate);
    apiCalls++;

    for (const symbol of stillFailed) {
      const bar = recovered[symbol];
      const openPrice = bar?.open ?? null;
      const closePrice = bar?.close ?? null;

      if (openPrice === null && closePrice === null) {
        failed++;
        const { rejected } = await writeObservations([
          {
            symbol,
            assetClass: "stock",
            kind: "sample",
            sessionDate,
            failureReason: "no-quote",
            source: "twelvedata",
            sweepId,
          },
        ]);
        sweepRejected += rejected;
        continue;
      }

      ok++;
      const rows: Observation[] = [];

      // Whichever of open/close is available becomes the sample too — this
      // symbol has no live tick from any provider today, but a real recorded
      // price beats "never logged," and it's labeled twelvedata, not implied
      // to be current.
      const samplePrice = closePrice ?? openPrice!;
      rows.push({
        symbol,
        assetClass: "stock",
        kind: "sample",
        sessionDate,
        price: samplePrice,
        source: "twelvedata",
        sweepId,
        asOf: closePrice !== null ? nySessionMoment(sessionDate, 16, 0) : nySessionMoment(sessionDate, 9, 30),
      });

      if (wantOpenAnchor && !haveOpen.has(symbol) && openPrice !== null) {
        rows.push({
          symbol,
          assetClass: "stock",
          kind: "open",
          sessionDate,
          price: openPrice,
          asOf: nySessionMoment(sessionDate, 9, 30),
          source: "twelvedata",
          sweepId,
        });
        haveOpen.add(symbol);
      }

      if (wantCloseAnchor && !haveClose.has(symbol) && closePrice !== null) {
        rows.push({
          symbol,
          assetClass: "stock",
          kind: "close",
          sessionDate,
          price: closePrice,
          asOf: nySessionMoment(sessionDate, 16, 0),
          source: "twelvedata",
          sweepId,
        });
        haveClose.add(symbol);
      }

      const { rejected } = await writeObservations(rows);
      sweepRejected += rejected;
    }
    await reportProgress(true);
  }

  // --- Crypto: one CoinGecko call for the whole pool. ---
  if (crypto.length > 0) {
    const fetched = await fetchCoinGeckoPrices(crypto);
    apiCalls++;

    const wantCryptoOpen = inWindow(now, OPEN_ANCHOR_WINDOW);
    const wantCryptoClose = inWindow(now, CLOSE_ANCHOR_WINDOW);
    const [haveCryptoOpen, haveCryptoClose] = await Promise.all([
      wantCryptoOpen ? existingAnchors(sessionDate, "open") : Promise.resolve(new Set<string>()),
      wantCryptoClose ? existingAnchors(sessionDate, "close") : Promise.resolve(new Set<string>()),
    ]);

    const cryptoObservations: Observation[] = [];

    for (const symbol of crypto) {
      const lookup = fetched.get(symbol);
      if (!lookup || lookup.status !== "ok") {
        failed++;
        cryptoObservations.push({
          symbol,
          assetClass: "crypto",
          kind: "sample",
          sessionDate,
          failureReason: lookup?.status === "unavailable" ? lookup.reason : "provider-error",
          source: "coingecko",
          sweepId,
        });
        continue;
      }

      ok++;
      cryptoObservations.push({
        symbol,
        assetClass: "crypto",
        kind: "sample",
        sessionDate,
        price: lookup.price,
        changePercent: lookup.changePercent,
        asOf: lookup.asOf,
        source: "coingecko",
        sweepId,
      });

      if (wantCryptoOpen && !haveCryptoOpen.has(symbol)) {
        cryptoObservations.push({
          symbol,
          assetClass: "crypto",
          kind: "open",
          sessionDate,
          price: lookup.price,
          asOf: nySessionMoment(sessionDate, 9, 30),
          source: "coingecko",
          sweepId,
        });
        haveCryptoOpen.add(symbol);
      }
      if (wantCryptoClose && !haveCryptoClose.has(symbol)) {
        cryptoObservations.push({
          symbol,
          assetClass: "crypto",
          kind: "close",
          sessionDate,
          price: lookup.price,
          asOf: nySessionMoment(sessionDate, 16, 0),
          source: "coingecko",
          sweepId,
        });
        haveCryptoClose.add(symbol);
      }
    }

    // Crypto is one API call for the whole pool, so there's no per-symbol
    // pacing to interleave with — write it as a single batch and report once.
    const { rejected } = await writeObservations(cryptoObservations);
    sweepRejected += rejected;
    await reportProgress(true);
  }

  if (sweepRejected > 0) {
    console.error(`[logger] sweep ${sweepId}: ${sweepRejected} observation(s) rejected on write`);
  }

  await finishSweep(sweepId, { ok, failed, apiCalls });

  return {
    sweepId,
    status: failed === 0 ? "complete" : "partial",
    symbolsRequested,
    symbolsOk: ok,
    symbolsFailed: failed,
    apiCalls,
    durationMs: Date.now() - started,
  };
}

/** The wall-clock instant of hour:minute ET on a given NY calendar day. */
function nySessionMoment(sessionDate: string, hour: number, minute: number): Date {
  // sessionDate is already the NY calendar day (YYYY-MM-DD). Build the UTC
  // instant that corresponds to hour:minute ET on that day by probing the
  // offset via Intl, since ET's UTC offset shifts with daylight saving.
  const naive = new Date(`${sessionDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const nyOffsetMinutes = getNyUtcOffsetMinutes(naive);
  return new Date(naive.getTime() - nyOffsetMinutes * 60_000);
}

function getNyUtcOffsetMinutes(approx: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(approx);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = tzName.match(/GMT([+-]\d+)/);
  return match ? Number(match[1]) * 60 : -300;
}
