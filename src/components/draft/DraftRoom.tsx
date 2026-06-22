"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCryptoQuotes } from "@/hooks/useCryptoQuotes";
import { useDraftPool } from "@/hooks/useDraftPool";
import { useLiveDraftFeed } from "@/hooks/useLiveDraftFeed";
import { usePoolQuotes } from "@/hooks/usePoolQuotes";
import { CRYPTO_SYMBOLS } from "@/lib/market/symbols";
import { getTop100PoolSymbols } from "@/lib/market/draft-pool";
import { getDuplicateRosterError, isCryptoSymbol } from "@/lib/draft/engine";
import {
  fetchJsonWithTimeout,
  formatFetchError,
} from "@/lib/fetch-client";
import type { Draft, DraftFeedEvent, DraftState } from "@/lib/draft/types";
import type { DraftChatMessage } from "@/lib/draft/chat-types";
import type { Profile } from "@/lib/types";
import type { MarketQuote } from "@/lib/market/types";
import { ConfirmPickModal } from "./ConfirmPickModal";
import { DraftBoardTabs } from "./DraftBoardTabs";
import { DraftChatBox } from "./DraftChatBox";
import { LiveDraftTicker, type LiveDraftFeedSyncStatus } from "./LiveDraftTicker";
import { DraftRoundSelector } from "./DraftRoundSelector";
import { OnClockBanner } from "./OnClockBanner";
import { SalaryCapBar } from "./SalaryCapBar";
import { StockPool } from "./StockPool";
import type { BotDraftBoard } from "@/lib/league/ai-league";

const POOL_QUOTE_BATCH = 80;
const POLL_STALE_MS = 10000;
const DRAFT_LOAD_TIMEOUT_MS = 45_000;

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
  const [botDraftBoards, setBotDraftBoards] = useState<BotDraftBoard[]>([]);

  const readOnly = initialDraft?.status === "complete";
  const liveDraft = state?.liveDraft ?? null;
  const isLiveDraft = Boolean(liveDraft);
  const liveInProgress = liveDraft?.status === "in_progress";
  const canPick =
    !readOnly && (!isLiveDraft || liveDraft?.isMyTurn === true);

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
    () => new Set(state?.myStockSymbols ?? []),
    [state?.myStockSymbols]
  );

  const skipRecoveryAttempts = useRef(0);
  const loadDraftInFlight = useRef<Promise<void> | null>(null);
  const lastPollOkAt = useRef(Date.now());
  const activeLeagueIdRef = useRef<string | null>(null);
  const [pollStale, setPollStale] = useState(false);

  const mergeDraftFeed = useCallback(
    (
      existing: DraftFeedEvent[],
      incoming: DraftFeedEvent[]
    ): DraftFeedEvent[] => {
      const byId = new Map<string, DraftFeedEvent>();
      for (const event of existing) byId.set(event.id, event);
      for (const event of incoming) byId.set(event.id, event);
      return [...byId.values()].sort(
        (a, b) => a.global_pick_number - b.global_pick_number
      );
    },
    []
  );

  const mergeDraftChat = useCallback(
    (
      existing: DraftChatMessage[],
      incoming: DraftChatMessage[]
    ): DraftChatMessage[] => {
      const byId = new Map<string, DraftChatMessage>();
      for (const message of existing) byId.set(message.id, message);
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    },
    []
  );

  const applyDraftPayload = useCallback(
    (data: Record<string, unknown>) => {
      setState((prev) => {
        const incoming = data as DraftState;
        const incomingFeed = incoming.draftFeed ?? [];
        const draftFeed = prev?.draftFeed?.length
          ? mergeDraftFeed(prev.draftFeed, incomingFeed)
          : incomingFeed;

        const incomingChat = incoming.draftChat ?? [];
        const draftChat = prev?.draftChat?.length
          ? mergeDraftChat(prev.draftChat, incomingChat)
          : incomingChat;

        if (incoming.leagueId) {
          activeLeagueIdRef.current = incoming.leagueId;
        }

        return { ...incoming, draftFeed, draftChat };
      });
      setBotDraftBoards(
        Array.isArray(data.botDraftBoards)
          ? (data.botDraftBoards as BotDraftBoard[])
          : []
      );
    },
    [mergeDraftFeed, mergeDraftChat]
  );

  const loadDraft = useCallback(async () => {
    if (loadDraftInFlight.current) {
      return loadDraftInFlight.current;
    }

    const run = (async () => {
      setError(null);
      try {
        const leagueQuery = activeLeagueIdRef.current
          ? `?leagueId=${encodeURIComponent(activeLeagueIdRef.current)}`
          : "";
        const { res, data } = await fetchJsonWithTimeout<Record<string, unknown>>(
          `/api/draft${leagueQuery}`,
          {
            cache: "no-store",
            timeoutMs: DRAFT_LOAD_TIMEOUT_MS,
            label: "Draft load",
          }
        );

        if (!res.ok) {
          if (data.draft && data.turn) {
            applyDraftPayload(data);
            lastPollOkAt.current = Date.now();
            setPollStale(false);
          }
          const apiError =
            typeof data.error === "string" ? data.error : "Could not load draft";
          setError(`Draft API HTTP ${res.status}: ${apiError}`);
          return;
        }

        applyDraftPayload(data);
        lastPollOkAt.current = Date.now();
        setPollStale(false);

        if (
          !data.liveDraft &&
          data.turn &&
          typeof data.turn === "object" &&
          (data.turn as { type?: string }).type === "pushback_skip" &&
          data.draft &&
          typeof data.draft === "object" &&
          (data.draft as { status?: string }).status !== "complete"
        ) {
          if (skipRecoveryAttempts.current < 3) {
            skipRecoveryAttempts.current += 1;
            window.setTimeout(() => {
              void loadDraft();
            }, 400);
            return;
          }
          setError(
            "Pushback skip could not auto-advance. Try refreshing again or undo your last crypto pick."
          );
        } else {
          skipRecoveryAttempts.current = 0;
        }

        if (
          data.liveDraft &&
          typeof data.liveDraft === "object" &&
          (data.liveDraft as { status?: string }).status === "complete"
        ) {
          window.setTimeout(() => router.replace("/dashboard"), 2500);
        } else if (
          data.complete ||
          (data.draft &&
            typeof data.draft === "object" &&
            (data.draft as { status?: string }).status === "complete")
        ) {
          if (!data.liveDraft) {
            router.replace("/dashboard");
          }
        }
      } catch (err) {
        setError(formatFetchError(err, "Could not load draft"));
      } finally {
        setLoading(false);
      }
    })();

    loadDraftInFlight.current = run;
    try {
      await run;
    } finally {
      loadDraftInFlight.current = null;
    }
  }, [applyDraftPayload, router]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!liveInProgress) return;
    const id = window.setInterval(() => {
      void loadDraft();
    }, 2500);
    return () => window.clearInterval(id);
  }, [liveInProgress, loadDraft]);

  useEffect(() => {
    if (!liveInProgress) {
      setPollStale(false);
      return;
    }

    const id = window.setInterval(() => {
      setPollStale(Date.now() - lastPollOkAt.current > POLL_STALE_MS);
    }, 2000);

    return () => window.clearInterval(id);
  }, [liveInProgress]);

  const appendFeedEvent = useCallback((event: DraftFeedEvent) => {
    lastPollOkAt.current = Date.now();
    setPollStale(false);
    setState((prev) => {
      if (!prev) return prev;
      const existing = prev.draftFeed ?? [];
      if (existing.some((e) => e.id === event.id)) return prev;
      return { ...prev, draftFeed: [...existing, event] };
    });
  }, []);

  const triggerDraftPoll = useCallback(() => {
    void loadDraft();
  }, [loadDraft]);

  const feedConnection = useLiveDraftFeed(
    state?.leagueId,
    state?.draftFeed ?? [],
    appendFeedEvent,
    { onDisconnected: triggerDraftPoll }
  );

  const feedSyncStatus = useMemo((): LiveDraftFeedSyncStatus => {
    if (!liveInProgress) return "live";
    if (feedConnection === "connected" && !pollStale) return "live";
    if (!pollStale) return "reconnecting";
    if (feedConnection === "connected") return "polling";
    return "offline";
  }, [feedConnection, liveInProgress, pollStale]);

  const feedSyncDetail = useMemo(() => {
    if (!liveInProgress || feedSyncStatus === "live") return null;
    if (feedSyncStatus === "reconnecting") {
      return "Live feed reconnecting — picks still load via polling.";
    }
    if (feedSyncStatus === "polling") {
      return "Draft polling is slow — waiting for the next refresh.";
    }
    return "Live feed offline — refresh the page if picks stop appearing.";
  }, [feedSyncStatus, liveInProgress]);

  const handleToggleSafetyPick = useCallback(async (symbol: string) => {
    setError(null);
    const res = await fetch("/api/draft/safety-pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not update safety queue");
      return;
    }
    setState((prev) =>
      prev
        ? {
            ...prev,
            safetyPickQueue: data.safetyPickQueue ?? [],
            safetyPickSymbol: data.safetyPickSymbol ?? null,
          }
        : prev
    );
  }, []);

  const submitPick = useCallback(
    async (
      symbol: string,
      quote: MarketQuote,
      allocation?: number,
      isSearchPick = false
    ) => {
      if (readOnly || busy || !canPick) return;

      const upper = symbol.toUpperCase();
      const duplicateError = state
        ? getDuplicateRosterError(
            upper,
            state.picks,
            isCryptoSymbol(upper) ? "crypto" : "stock"
          )
        : null;
      if (duplicateError) {
        setError(duplicateError);
        return;
      }

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
            leagueId: state?.leagueId,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          complete?: boolean;
          liveClock?: {
            onClockUserId?: string | null;
            expectedOnClockUserId?: string | null;
          };
        };

        if (!res.ok) {
          const clockHint =
            data.liveClock?.onClockUserId &&
            data.liveClock.onClockUserId !== profile.id
              ? " The live draft clock has moved — wait for your turn or refresh."
              : "";
          setError((data.error ?? `Pick failed (${res.status})`) + clockHint);
          await loadDraft();
          return;
        }

        setPendingSymbol(null);
        setPendingQuote(null);
        setPendingSearchPick(false);

        await loadDraft();

        if (data.complete) {
          window.setTimeout(() => router.replace("/dashboard"), 2500);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Pick failed — check your connection and try again."
        );
      } finally {
        setBusy(false);
        setDraftingSymbol(null);
      }
    },
    [busy, canPick, loadDraft, profile.id, readOnly, router, state]
  );

  function handleDraft(
    symbol: string,
    quote: MarketQuote,
    isSearchPick = false
  ) {
    if (readOnly || busy || !canPick) return;

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
    if (liveInProgress) return;
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
    if (liveInProgress) return;
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

  const leagueTeamName = state.teamName ?? profile.team_name;

  return (
    <div className="draft-room space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Draft Room — 2026 Season</h1>
          <p className="text-muted text-sm mt-0.5">
            {isLiveDraft && !liveDraft?.isMyTurn
              ? `Watching live draft · ${state.turn.label}`
              : state.turn.label}
          </p>
        </div>
        <span
          className={
            state.turn.type === "complete" || liveDraft?.status === "complete"
              ? "draft-phase-pill draft-phase-pill--done"
              : "draft-phase-pill"
          }
        >
          {isLiveDraft
            ? `Pick ${Math.min(liveDraft!.globalPickNumber + 1, liveDraft!.totalPickSlots)} / ${liveDraft!.totalPickSlots}`
            : `Round ${state.draft.current_round} / 15`}
        </span>
      </div>

      {liveDraft && (
        <OnClockBanner
          liveDraft={liveDraft}
          myTeamName={leagueTeamName}
          onTimerExpired={() => void loadDraft()}
        />
      )}

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

      {liveDraft?.status === "complete" && (
        <div
          className="draft-pushback-banner"
          style={{
            borderColor: "rgba(52,211,153,0.35)",
            background: "rgba(16,185,129,0.08)",
            color: "#6ee7b7",
          }}
        >
          Live draft complete — matchups are being scheduled. Redirecting to
          dashboard…
        </div>
      )}

      {!readOnly && !isLiveDraft && state.turn.type === "pushback_skip" && (
        <div className="draft-pushback-banner">
          Round skipped — crypto pushback penalty. Processing skip
          {state.draft.pushback_skips_remaining > 1
            ? ` (${state.draft.pushback_skips_remaining} queued)…`
            : "…"}
        </div>
      )}

      {!readOnly &&
        !isLiveDraft &&
        state.draft.pushback_skips_remaining > 0 &&
        state.turn.type !== "pushback_skip" && (
          <div className="draft-pushback-banner">
            Pushback — {state.draft.pushback_skips_remaining} delayed turn
            {state.draft.pushback_skips_remaining > 1 ? "s" : ""} remaining
            (you still get all 10 stock picks)
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

      <div className="draft-layout draft-layout--live">
        <div className="draft-layout-main">
          <StockPool
            poolStocks={poolStocks}
            poolLoading={poolLoading}
            pushbackSkipsRemaining={state.draft.pushback_skips_remaining}
            quotes={quotes}
            turn={state.turn}
            buyerCounts={state.buyerCounts}
            leagueOffBoard={leagueOffBoard}
            myDrafted={myDrafted}
            onDraft={handleDraft}
            draftingSymbol={draftingSymbol}
            quotesLoading={poolQuotesLoading}
            busy={busy}
            canPick={canPick}
            safetyPickQueue={state.safetyPickQueue ?? []}
            onToggleSafetyPick={
              isLiveDraft && liveInProgress ? handleToggleSafetyPick : undefined
            }
          />
          <DraftBoardTabs
            teamName={leagueTeamName}
            myPicks={state.picks}
            mySummary={state.summary}
            myCurrentRound={state.draft.current_round}
            botDraftBoards={botDraftBoards}
            onUndo={handleUndo}
            onReset={handleReset}
            busy={busy || readOnly || liveInProgress}
          />
        </div>

        {isLiveDraft && (
          <div className="live-draft-sidebar">
            <LiveDraftTicker
              feed={state.draftFeed ?? []}
              status={liveDraft?.status}
              syncStatus={feedSyncStatus}
              syncDetail={feedSyncDetail}
            />
            <DraftRoundSelector
              feed={state.draftFeed ?? []}
              liveDraft={liveDraft}
              compact
            />
            <DraftChatBox
              leagueId={state.leagueId}
              initialMessages={state.draftChat ?? []}
              myUserId={profile.id}
              disabled={liveDraft?.status === "complete"}
            />
          </div>
        )}
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
