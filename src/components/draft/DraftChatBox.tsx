"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftChatMessage } from "@/lib/draft/chat-types";
import { useLiveDraftChat } from "@/hooks/useLiveDraftChat";
import { BOT_BY_ID } from "@/lib/league/bots";

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DraftChatBox({
  leagueId,
  initialMessages = [],
  myUserId,
  disabled = false,
}: {
  leagueId: string | null | undefined;
  initialMessages?: DraftChatMessage[];
  myUserId: string;
  disabled?: boolean;
}) {
  const [messages, setMessages] = useState<DraftChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  const appendMessage = useCallback((message: DraftChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const connection = useLiveDraftChat(leagueId, messages, appendMessage);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!leagueId || disabled || sending) return;

    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/draft/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, message: text }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: DraftChatMessage;
      };

      if (!res.ok) {
        setError(data.error ?? "Could not send message");
        return;
      }

      if (data.message) {
        appendMessage(data.message);
      }
      setDraft("");
      stickToBottomRef.current = true;
    } catch {
      setError("Network error — could not send message.");
    } finally {
      setSending(false);
    }
  }

  const statusLabel =
    connection === "connected"
      ? "Live"
      : connection === "connecting"
        ? "Connecting"
        : connection === "error"
          ? "Offline"
          : "Reconnecting";

  return (
    <section className="live-draft-chat" aria-label="Draft room chat">
      <div className="live-draft-chat__header">
        <h2 className="live-draft-chat__title">Draft Chat</h2>
        <span
          className={`live-draft-chat__status live-draft-chat__status--${connection === "connected" ? "live" : "degraded"}`}
        >
          {statusLabel}
        </span>
      </div>

      <div
        className="live-draft-chat__list"
        ref={listRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <p className="live-draft-chat__empty">
            Say something to the room — AI managers will chime in when the draft
            heats up.
          </p>
        ) : (
          messages.map((message) => {
            const isMine =
              message.message_type === "human" && message.user_id === myUserId;
            const isBot = message.message_type === "bot_reaction";
            const botProfile = message.user_id
              ? BOT_BY_ID.get(message.user_id)
              : undefined;

            return (
              <div
                key={message.id}
                className={`live-draft-chat__message ${
                  isMine ? "live-draft-chat__message--mine" : ""
                } ${isBot ? "live-draft-chat__message--bot" : ""}`}
              >
                <div className="live-draft-chat__meta">
                  <span className="live-draft-chat__author">
                    {message.author_name}
                    {isBot && botProfile ? (
                      <span className="live-draft-chat__bot-tag">AI</span>
                    ) : null}
                  </span>
                  <time
                    className="live-draft-chat__time"
                    dateTime={message.created_at}
                  >
                    {formatChatTime(message.created_at)}
                  </time>
                </div>
                <p className="live-draft-chat__body">{message.body}</p>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="live-draft-chat__error">{error}</p>}

      <form className="live-draft-chat__composer" onSubmit={handleSubmit}>
        <input
          type="text"
          className="live-draft-chat__input"
          placeholder={disabled ? "Chat closed" : "Message the draft room…"}
          value={draft}
          maxLength={500}
          disabled={disabled || sending || !leagueId}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="live-draft-chat__send"
          disabled={disabled || sending || !leagueId || !draft.trim()}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
