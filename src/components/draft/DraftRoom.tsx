"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import { useDraftPool } from "@/hooks/useDraftPool";
import { usePoolQuotes } from "@/hooks/usePoolQuotes";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import { getTop100PoolSymbols } from "@/lib/market/draft-pool";
import { getMyDraftedSymbols, isCryptoSymbol } from "@/lib/draft/engine";
import type { Draft, DraftState } from "@/lib/draft/types";
import type { Profile } from "@/lib/types";
import type { MarketQuote } from "@/lib/market/types";
import { ConfirmPickModal } from "./ConfirmPickModal";
import { DraftBoard } from "./DraftBoard";
import { SalaryCapBar } from "./SalaryCapBar";
import { StockPool } from "./StockPool";

const POOL_QUOTE_BATCH = 80;

export function DraftRoom({
  profile,
  initialDraft = null,
}: {
  profile: Profile;
  initialDraft?: Draft | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftingSymbol, setDraftingSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<MarketQuote | null>(null);
  const [pendingSearchPick, setPendingSearchPick] = useState(false);

  const readOnly = initialDraft?.status === "complete";

  const { stocks: poolStocks, loading: poolLoading, error: poolError } =
    useDraftPool();

  const poolSymbols = useMemo(() => {
    const top100 = getTop100PoolSymbols(poolStocks);
    const batch = poolStocks.slice(0, POOL_QUOTE_BATCH).map((s) => s.symbol);
    return [...new Set([...top100, ...batch, ...CRYPTO_SYMBOLS])];
  }, [poolStocks]);

  const { orderedQuotes: poolQuotes, loading: poolQuotesLoading } =
    usePoolQuotes(poolSymbols);
  const { orderedQuotes: cryptoQuotes } = useCryptoQuotes();

  const quotes = useMemo(() => {
    const map = new Map<string, MarketQuote>();
    for (const q of [...poolQuotes, ...cryptoQuotes]) {
      map.set(q.symbol, q);
    }
    return [...map.values()];
  }, [poolQuotes, cryptoQuotes]);

  const leagueOffBoard = useMemo(
    () => new Set(state?.leagueOffBoard ?? []),
    [state?.leagueOffBoard]
  );

  const myDrafted = useMemo(
    () => new Set(state ? getMyDraftedSymbols(state.picks) : []),
    [state]
  );

  const loadDraft = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/draft");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load draft");
      setLoading(false);
      return;
    }
    setState(data as DraftState);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  const submitPick = useCallback(
    async (
      symbol: string,
      quote: MarketQuote,
      allocation?: number,
      isSearchPick = false
    ) => {
      if (readOnly || busy) return;

      setBusy(true);
      setDraftingSymbol(symbol);
      setError(null);

      try {
        const res = await fetch("/api/draft/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            allocation,
            price: quote.price,
            isSearchPick,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Pick failed");
          return;
        }

        setState(data as DraftState);
        setPendingSymbol(null);
        setPendingQuote(null);
        setPendingSearchPick(false);

        if (data.complete || data.draft?.status === "complete") {
          router.replace("/dashboard");
        }
      } catch {
        setError("Pick failed — check your connection and try again.");
      } finally {
        setBusy(false);
        setDraftingSymbol(null);
      }
    },
    [busy, readOnly, router]
  );

  function handleDraft(
    symbol: string,
    quote: MarketQuote,
    isSearchPick = false
  ) {
    if (readOnly || busy) return;

    if (isCryptoSymbol(symbol)) {
      setPendingSymbol(symbol);
      setPendingQuote(quote);
      setPendingSearchPick(false);
      return;
    }

    void submitPick(symbol, quote, undefined, isSearchPick);
  }

  async function confirmCryptoPick(allocation?: number) {
    if (!pendingSymbol || !pendingQuote) return;
    await submitPick(
      pendingSymbol,
      pendingQuote,
      allocation,
      pendingSearchPick
    );
  }

  async function handleUndo() {
    if (!confirm("Undo your last pick?")) return;
    setBusy(true);
    const res = await fetch("/api/draft/undo", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Undo failed");
      return;
    }
    setState(data as DraftState);
  }

  async function handleReset() {
    if (!confirm("Reset your entire draft board?")) return;
    setBusy(true);
    const res = await fetch("/api/draft/reset", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Reset failed");
      return;
    }
    setState(data as DraftState);
  }

  if (loading) {
    return (
      <p className="text-muted text-sm py-12 text-center">Loading draft room…</p>
    );
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error ??
          "Could not load draft. Run Supabase migrations 002_draft, 003_leagues, and 004_draft_pool."}
      </div>
    );
  }

  return (
    <div className="draft-room space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Draft Room — 2026 Season</h1>
          <p className="text-muted text-sm mt-0.5">{state.turn.label}</p>
        </div>
        <span
          className={
            state.turn.type === "complete"
              ? "draft-phase-pill draft-phase-pill--done"
              : "draft-phase-pill"
          }
        >
          Round {state.draft.current_round} / 15
        </span>
      </div>

      {readOnly && (
        <div
          className="draft-pushback-banner"
          style={{
            borderColor: "rgba(52,211,153,0.35)",
            background: "rgba(16,185,129,0.08)",
            color: "#6ee7b7",
          }}
        >
          Draft complete — review your board below or return to the dashboard.
        </div>
      )}

      {!readOnly && state.draft.pushback_skips_remaining > 0 && (
        <div className="draft-pushback-banner">
          Pushback active — {state.draft.pushback_skips_remaining} stock turn
          {state.draft.pushback_skips_remaining > 1 ? "s" : ""} will be skipped
        </div>
      )}

      {poolError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {poolError}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <SalaryCapBar
        summary={state.summary}
        currentRound={state.draft.current_round}
        picks={state.picks}
      />

      <div className="draft-layout">
        <StockPool
          poolStocks={poolStocks}
          poolLoading={poolLoading}
          quotes={quotes}
          turn={state.turn}
          buyerCounts={state.buyerCounts}
          leagueOffBoard={leagueOffBoard}
          myDrafted={myDrafted}
          onDraft={handleDraft}
          draftingSymbol={draftingSymbol}
          quotesLoading={poolQuotesLoading}
          busy={busy}
        />
        <DraftBoard
          teamName={profile.team_name}
          picks={state.picks}
          summary={state.summary}
          currentRound={state.draft.current_round}
          onUndo={handleUndo}
          onReset={handleReset}
          busy={busy || readOnly}
        />
      </div>

      <p className="text-xs text-muted text-center">
        Live WebSocket prices stream only for stocks drafted on the platform — not
        the full pool.
      </p>

      <ConfirmPickModal
        open={!!pendingSymbol}
        symbol={pendingSymbol}
        quote={pendingQuote}
        turn={state.turn}
        buyerCounts={state.buyerCounts}
        cryptoRemaining={state.summary.cryptoRemaining}
        onConfirm={confirmCryptoPick}
        onClose={() => {
          if (busy) return;
          setPendingSymbol(null);
          setPendingQuote(null);
          setPendingSearchPick(false);
        }}
        busy={busy}
      />
    </div>
  );
}
