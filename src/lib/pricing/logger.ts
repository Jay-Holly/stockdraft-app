import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";
import { isUsMarketOpen, isUsTradingDay, getNyDateString } from "@/lib/market/hours";
import { fetchFinnhubFullQuote, fetchAlpacaSnapshots } from "@/lib/pricing/providers";
import { fetchCoinGeckoPrices } from "@/lib/pricing/providers";
import { fetchDailyOpenClose } from "@/lib/market/twelve-data";
import { broadcastPriceChanges, type PriceTick } from "@/lib/pricing/broadcast";
import { verifyAnchor } from "@/lib/pricing/verify";
import {
  startSweep,
  listUnverifiedAnchors,
  recordAnchorVerification,
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
  const crypto = wanted ? cryptoUniverse.filter((s) => wanted.has(s)) : cryptoUniverse;

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
  const tradingDay = isUsTradingDay(now);

  // Both anchors require a day the market actually traded.
  //
  // `wantCloseAnchor` used to be simply `!marketOpen`, which is true all
  // weekend and every weekday before 9:30. Two ways that went wrong, and the
  // second is the dangerous one:
  //
  //   - On a Saturday it wrote a full set of stock "close" anchors for a
  //     session that never happened, using Friday's stale quote.
  //   - On a Monday at 8 AM it wrote Monday's close anchor from a pre-market
  //     price. The anchor unique index then BLOCKS the real 4 PM close from
  //     ever landing, so the whole day would score against a stale number
  //     with nothing anywhere reporting a failure.
  //
  // Now a close may only be written from the close window onward (15:55 ET),
  // which still allows a later backfill on the same day if the 4 PM sweep is
  // missed, but never before the session has actually closed.
  const wantOpenAnchor = tradingDay && (inWindow(now, OPEN_ANCHOR_WINDOW) || marketOpen);
  const wantCloseAnchor =
    tradingDay && nyMinutesOfDay(now) >= CLOSE_ANCHOR_WINDOW.startMin;

  const [haveOpen, haveClose] = await Promise.all([
    wantOpenAnchor ? existingAnchors(sessionDate, "open") : Promise.resolve(new Set<string>()),
    wantCloseAnchor ? existingAnchors(sessionDate, "close") : Promise.resolve(new Set<string>()),
  ]);

  let sweepRejected = 0;

  // Everything this sweep actually wrote — which, under write-on-change, is
  // exactly what moved. Pushed to open browsers once at the end of the sweep
  // rather than per batch, so a page gets one update per sweep instead of
  // several partial ones.
  const changedTicks: PriceTick[] = [];

  /**
   * What the batch source (Alpaca) reported for each stock this sweep.
   *
   * Kept because it is the free second opinion: the one batch call already
   * returns every symbol's open, close, high and low, so corroborating an
   * anchor against it costs nothing. It is IEX-only data, which is why it is
   * the CHECK and not the anchor itself — the official open and close are set
   * by auctions on the primary exchange, which IEX does not run.
   */
  const batchValues = new Map<
    string,
    { dayOpen: number | null; price: number; dayHigh: number | null; dayLow: number | null }
  >();

  /** writeObservations, plus a note of what changed so it can be pushed. */
  async function writeAndTrack(observations: readonly Observation[]) {
    const result = await writeObservations(observations);
    changedTicks.push(...result.writtenTicks);
    return result;
  }

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

    // THE OPEN ANCHOR IS WRITTEN HERE, IMMEDIATELY, FROM THE BATCH SOURCE.
    //
    // Not from the consolidated source, and the reason is timing rather than
    // accuracy. Finnhub has no batch endpoint and allows 60 calls a minute, so
    // pricing 502 stocks through it takes the better part of ten minutes. At
    // 9:30 that is the wrong trade: contests lock on the open, and a baseline
    // that arrives ten minutes into the session is worse than one that is a
    // few hundredths of a percent off. Alpaca prices the entire pool in one
    // call, so the day starts on time.
    //
    // The open is still corroborated — just afterwards, by verifyOpenAnchors
    // below, which runs in the background once the session is under way and
    // nothing is waiting on it. Verification arriving late is fine. A baseline
    // arriving late is not.
    //
    // The close is the opposite case and is handled the opposite way: nothing
    // is waiting at 4 PM, so it is captured from the consolidated source
    // directly. See captureStockCloseAnchors.
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
        // Written fast, corroborated later. Recorded honestly as
        // single-sourced in the meantime rather than presumed correct.
        verifyStatus: "unverified",
      });
      haveOpen.add(symbol);
    }

    batchValues.set(symbol, {
      dayOpen: q.dayOpen,
      price: q.price,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
    });

    const { rejected } = await writeAndTrack(rows);
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
      const { rejected } = await writeAndTrack(rows);
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
        const { rejected } = await writeAndTrack([
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

      const { rejected } = await writeAndTrack(rows);
      sweepRejected += rejected;
    }
    await reportProgress(true);
  }

  // --- Stock CLOSE anchors: consolidated source, corroborated at capture. ---
  //
  // Samples above come from the batch source because it is one call and fast
  // enough to sample every minute. Anchors are different: they are the numbers
  // contests settle on, and the batch source is IEX-only — it does not run the
  // opening or closing auction that sets the official price. Measured against
  // consolidated closes the gap averages ~0.02% and reaches ~0.07%, which is
  // invisible on a screen and can still decide a close matchup.
  //
  // So each anchor is fetched from Finnhub (consolidated) and checked against
  // the batch value already in hand. Two independent sources, the same instant,
  // every symbol, at no extra API cost — the check that used to happen hours
  // later against a third source's limited budget now happens at capture, and
  // the third source is reserved for the cases where these two disagree.
  //
  // Finnhub has no batch endpoint and allows 60 calls a minute, so a full
  // anchor pass takes several minutes of wall clock. That is fine: it is
  // time-boxed like everything else here, symbols it does not reach keep their
  // anchor unwritten (never a guessed one), and the next sweep continues.
  async function captureStockCloseAnchors(): Promise<void> {
    if (!wantCloseAnchor) return;

    const targets = stocks.filter((symbol) => !haveClose.has(symbol));
    if (targets.length === 0) return;

    let captured = 0;

    for (const symbol of targets) {
      if (Date.now() >= sweepHardDeadline) {
        console.log(
          `[logger] anchor pass hit its time budget after ${captured} symbol(s); ` +
            `${targets.length - captured} still need an anchor and will be picked up by the next sweep`
        );
        break;
      }

      const fh = await fetchFinnhubFullQuote(symbol);
      apiCalls++;

      const batch = batchValues.get(symbol);
      const rows: Observation[] = [];

      /** Build one anchor: consolidated price first, batch value as the check. */
      const buildAnchor = (
        kind: "open" | "close",
        consolidated: number | null,
        batchValue: number | null,
        asOf: Date
      ): Observation | null => {
        const usingFallback = !(typeof consolidated === "number" && consolidated > 0);
        const price = usingFallback ? batchValue : consolidated;
        // No price from either source: write nothing. A missing anchor holds
        // the contest, which is the whole point — it is never filled in with
        // whatever number happened to be nearby.
        if (!(typeof price === "number" && price > 0)) return null;

        const secondary = usingFallback ? null : batchValue;
        const v = verifyAnchor(price, secondary, usingFallback);

        return {
          symbol,
          assetClass: "stock",
          kind,
          sessionDate,
          price,
          dayHigh: batch?.dayHigh ?? undefined,
          dayLow: batch?.dayLow ?? undefined,
          asOf,
          source: usingFallback ? "alpaca" : "finnhub",
          sweepId,
          verifiedPrice: secondary ?? undefined,
          verifiedSource: secondary != null ? "alpaca" : undefined,
          verifyDiffPct: v.diffPct,
          verifyStatus: v.status,
        };
      };

      if (!haveClose.has(symbol)) {
        const row = buildAnchor(
          "close",
          fh.status === "ok" ? fh.quote.price : null,
          batch?.price ?? null,
          nySessionMoment(sessionDate, 16, 0)
        );
        if (row) {
          rows.push(row);
          haveClose.add(symbol);
        }
      }

      if (rows.length > 0) {
        const { rejected } = await writeAndTrack(rows);
        sweepRejected += rejected;
        captured++;

        const divergent = rows.filter((r) => "verifyStatus" in r && r.verifyStatus === "divergent");
        for (const row of divergent) {
          if (!("price" in row)) continue;
          console.error(
            `[logger] anchor DISAGREEMENT ${symbol} ${row.kind} ${sessionDate}: ` +
              `consolidated ${row.price} vs batch ${row.verifiedPrice} ` +
              `(${row.verifyDiffPct?.toFixed(3)}%) — queued for a third source`
          );
        }
      }
    }
  }

  // --- Background corroboration of the open anchor. ---
  //
  // The open was written immediately from the batch source so the session
  // could start on time. This is the other half of that trade: once nothing is
  // waiting, the consolidated source is asked what it saw, and its answer is
  // recorded against the anchor.
  //
  // Deliberately last in the sweep and strictly time-boxed. It is the least
  // urgent thing the logger does — nobody is blocked on it, and it must never
  // be the reason a sample or a close anchor is late. Whatever it does not
  // reach stays queued and the next sweep continues, so 502 symbols get
  // corroborated over the course of the morning rather than all at once.
  //
  // A disagreement does NOT rewrite the anchor. Contests may already have
  // locked on it, and silently changing the number a contest was scored
  // against is precisely the kind of invisible edit this table exists to
  // prevent. It is recorded as divergent, logged loudly, and handed to the
  // third source; correcting it is a deliberate supersession, which keeps the
  // original visible forever.
  async function verifyOpenAnchors(): Promise<void> {
    if (!tradingDay) return;

    const pending = await listUnverifiedAnchors(sessionDate, "open", 200);
    if (pending.length === 0) return;

    let checked = 0;

    for (const anchor of pending) {
      if (Date.now() >= sweepHardDeadline) break;

      const fh = await fetchFinnhubFullQuote(anchor.symbol);
      apiCalls++;

      const consolidatedOpen = fh.status === "ok" ? fh.quote.dayOpen : null;
      const v = verifyAnchor(anchor.price, consolidatedOpen);

      // Nothing came back. Leave it queued rather than marking it checked —
      // "we asked and got no answer" is not verification.
      if (consolidatedOpen == null && v.status === "unverified") continue;

      await recordAnchorVerification(anchor.id, {
        verifiedPrice: consolidatedOpen,
        verifiedSource: consolidatedOpen != null ? "finnhub" : null,
        diffPct: v.diffPct,
        status: v.status,
      });
      checked++;

      if (v.status === "divergent") {
        console.error(
          `[logger] OPEN anchor disagreement ${anchor.symbol} ${sessionDate}: ` +
            `stored ${anchor.price} vs consolidated ${consolidatedOpen} ` +
            `(${v.diffPct?.toFixed(3)}%) — anchor unchanged, queued for a third source`
        );
      }
    }

    if (checked > 0) {
      console.log(`[logger] corroborated ${checked} open anchor(s) for ${sessionDate}`);
    }
  }

  await captureStockCloseAnchors();

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
    const { rejected } = await writeAndTrack(cryptoObservations);
    sweepRejected += rejected;
    await reportProgress(true);
  }

  if (sweepRejected > 0) {
    console.error(`[logger] sweep ${sweepId}: ${sweepRejected} observation(s) rejected on write`);
  }

  // Genuinely last, after crypto. This is the only work in the sweep nobody is
  // waiting on, so it gets whatever time budget is left over and never
  // competes with pricing for it.
  await verifyOpenAnchors();

  await finishSweep(sweepId, { ok, failed, apiCalls });

  // Push what moved to any open page. Deliberately after finishSweep: the log
  // is the record and the push is a convenience, so the sweep is complete and
  // durable before anything is sent. A failed push is logged inside
  // broadcastPriceChanges and never fails the sweep — clients poll as a
  // fallback, the same way DraftRoom already treats its realtime channels.
  if (changedTicks.length > 0) {
    await broadcastPriceChanges(changedTicks);
  }

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
