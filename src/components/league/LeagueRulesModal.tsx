"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export function LeagueRulesModal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const modal = (
    <div className="draft-modal-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border-2"
        style={{
          background: "#17140D",
          borderColor: "#8A6D00",
          padding: "1.5rem",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="league-rules-title"
      >
        <div
          className="flex items-start justify-between gap-3 pb-3 mb-4"
          style={{ borderBottom: "1px solid #2C2717" }}
        >
          <div>
            <p
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "#D4A72C" }}
            >
              StockDraft — League Rules
            </p>
            <h3
              id="league-rules-title"
              className="text-xl font-bold mt-0.5"
              style={{ color: "#ECE7D9" }}
            >
              {title}
            </h3>
            {subtitle && (
              <p className="text-sm italic mt-0.5" style={{ color: "#A29A82" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules"
            className="shrink-0 rounded-full w-8 h-8 flex items-center justify-center text-xl leading-none transition-colors"
            style={{ color: "#A29A82" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ECE7D9";
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#A29A82";
              e.currentTarget.style.background = "transparent";
            }}
          >
            &times;
          </button>
        </div>

        <div className="text-sm leading-relaxed" style={{ color: "#ECE7D9" }}>
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function RuleSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h4
        className="text-base font-bold mb-1.5"
        style={{ color: "#E8BE4A" }}
      >
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
      <hr
        className="mt-4"
        style={{ border: "none", borderTop: "1px solid #2C2717" }}
      />
    </section>
  );
}

export function RuleCallout({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg p-3 my-3 text-sm"
      style={{
        background: "#241F11",
        border: "1px solid #8A6D00",
        color: "#ECE7D9",
      }}
    >
      {children}
    </div>
  );
}

export function RuleFact({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-block font-mono font-bold text-xs px-1.5 py-0.5 rounded"
      style={{ background: "#322A14", color: "#E8BE4A" }}
    >
      {children}
    </span>
  );
}
