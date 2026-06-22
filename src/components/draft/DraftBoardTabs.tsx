"use client";

import { useMemo, useState } from "react";
import type { BotDraftBoard } from "@/lib/league/ai-league";
import { DraftBoard } from "./DraftBoard";

type BoardTab = {
  id: string;
  label: string;
  avatarColor?: string;
  subtitle?: string;
  picks: BotDraftBoard["picks"];
  summary: BotDraftBoard["summary"];
  currentRound: number;
  isMine: boolean;
};

export function DraftBoardTabs({
  teamName,
  myPicks,
  mySummary,
  myCurrentRound,
  botDraftBoards,
  onUndo,
  onReset,
  busy,
}: {
  teamName: string;
  myPicks: BotDraftBoard["picks"];
  mySummary: BotDraftBoard["summary"];
  myCurrentRound: number;
  botDraftBoards: BotDraftBoard[];
  onUndo: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const tabs = useMemo<BoardTab[]>(() => {
    const mine: BoardTab = {
      id: "mine",
      label: teamName,
      picks: myPicks,
      summary: mySummary,
      currentRound: myCurrentRound,
      isMine: true,
    };

    const bots: BoardTab[] = botDraftBoards.map((bot) => ({
      id: bot.id,
      label: bot.name,
      avatarColor: bot.avatarColor,
      subtitle:
        bot.personality === "human"
          ? "Live opponent"
          : bot.personality === "analyst"
            ? "Highest market-cap each round"
            : bot.personality === "gambler"
              ? "Lower-cap picks outside Top 100"
              : "Full $200K BTC early, then mid-cap stocks",
      picks: bot.picks,
      summary: bot.summary,
      currentRound: bot.currentRound,
      isMine: false,
    }));

    return [mine, ...bots];
  }, [
    botDraftBoards,
    myCurrentRound,
    myPicks,
    mySummary,
    teamName,
  ]);

  const [activeTabId, setActiveTabId] = useState("mine");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (botDraftBoards.length === 0) {
    return (
      <DraftBoard
        teamName={teamName}
        picks={myPicks}
        summary={mySummary}
        currentRound={myCurrentRound}
        onUndo={onUndo}
        onReset={onReset}
        busy={busy}
      />
    );
  }

  return (
    <div className="draft-board-stack">
      <div className="draft-board-tab-bar" role="tablist" aria-label="Draft boards">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            className={`draft-board-tab ${activeTabId === tab.id ? "draft-board-tab--active" : ""}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.avatarColor && (
              <span
                className="draft-bot-board-dot"
                data-color={tab.avatarColor}
              />
            )}
            <span className="draft-board-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <DraftBoard
        key={activeTabId}
        teamName={activeTab.isMine ? teamName : activeTab.label}
        picks={activeTab.picks}
        summary={activeTab.summary}
        currentRound={activeTab.currentRound}
        onUndo={onUndo}
        onReset={onReset}
        busy={busy}
        showActions={activeTab.isMine}
        subtitle={activeTab.subtitle}
        emptyMessage={
          !activeTab.isMine && activeTab.picks.length === 0
            ? "No picks loaded for this manager yet."
            : undefined
        }
      />

      {botDraftBoards.length > 0 && (
        <p className="draft-board-tab-hint">
          Switch tabs to compare your board with each AI manager&apos;s picks.
        </p>
      )}
    </div>
  );
}
