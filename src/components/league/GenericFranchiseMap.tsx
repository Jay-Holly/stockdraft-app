"use client";

import { useMemo, useState } from "react";
import type { GenericMapClaim, GenericMapMarker } from "@/lib/league/generic-team-map";

const MAP_IMAGE_WIDTH = 1536;
const MAP_IMAGE_HEIGHT = 1024;

const COLOR_HEX: Record<"red" | "blue", string> = {
  red: "#dc4444",
  blue: "#1a5fbf",
};

export function GenericFranchiseMap({
  imagePath,
  markers,
  claims,
  mySlotKey,
  claimingKey,
  previewColor,
  onClaimSlot,
}: {
  imagePath: string;
  markers: GenericMapMarker[];
  claims: GenericMapClaim[];
  mySlotKey: string | null;
  claimingKey: string | null;
  previewColor?: string | null;
  onClaimSlot: (slotKey: string) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const claimedByKey = useMemo(
    () => new Map(claims.map((claim) => [claim.slotKey, claim])),
    [claims]
  );

  const hovered = hoveredKey
    ? markers.find((m) => m.key === hoveredKey) ?? null
    : null;
  const hoveredClaim = hovered ? claimedByKey.get(hovered.key) : null;

  return (
    <div className="sdfl-map-wrap">
      <svg
        viewBox={`0 0 ${MAP_IMAGE_WIDTH} ${MAP_IMAGE_HEIGHT}`}
        className="sdfl-map-svg"
        role="group"
        aria-label="Franchise map — claim an open team"
      >
        <image
          href={imagePath}
          x="0"
          y="0"
          width={MAP_IMAGE_WIDTH}
          height={MAP_IMAGE_HEIGHT}
        />

        {markers.map((marker) => {
          const key = marker.key;
          const claimed = claimedByKey.get(key);
          const isMine = mySlotKey === key;
          const isClaiming = claimingKey === key;
          const isOpen = !claimed;
          const disabled = !isOpen && !isMine;
          const color = COLOR_HEX[marker.color];
          const isTaken = Boolean(claimed) || isClaiming;

          return (
            <g
              key={key}
              transform={`translate(${marker.x}, ${marker.y})`}
              className={[
                "sdfl-map-marker",
                isMine ? "sdfl-map-marker--mine" : "",
                isClaiming ? "sdfl-map-marker--claiming" : "",
                disabled && !claimed ? "sdfl-map-marker--disabled" : "",
              ].join(" ")}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey((cur) => (cur === key ? null : cur))}
              onClick={() => {
                if ((isOpen || isMine) && !isClaiming) onClaimSlot(key);
              }}
              role="button"
              tabIndex={disabled && !isMine ? -1 : 0}
              aria-label={`${marker.city} — ${claimed ? claimed.displayName ?? "claimed" : "open"}`}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && (isOpen || isMine) && !isClaiming) {
                  e.preventDefault();
                  onClaimSlot(key);
                }
              }}
            >
              {!isTaken && (
                <circle
                  r="14"
                  className="sdfl-map-marker__pulse"
                  style={{ stroke: color }}
                />
              )}
              {/* Invisible hit target so the whole dot area is clickable */}
              <circle r="11" fill="transparent" />
              {isTaken && (
                <circle
                  r="11"
                  className="sdfl-map-marker__mask"
                  fill={isMine && previewColor ? previewColor : "#000000"}
                  stroke={isMine ? color : "none"}
                  strokeWidth={isMine ? 2 : 0}
                />
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="sdfl-map-tooltip">
          <p className="sdfl-map-tooltip__team">{hovered.city}</p>
          <p className="sdfl-map-tooltip__status">
            {hoveredClaim
              ? `${hoveredClaim.displayName ?? "Claimed"}`
              : "Open — tap to claim"}
          </p>
        </div>
      )}

      <div className="sdfl-map-legend">
        <span className="sdfl-map-legend__item">
          <span className="sdfl-map-legend__dot" style={{ background: COLOR_HEX.red }} />
          Conference A
        </span>
        <span className="sdfl-map-legend__item">
          <span className="sdfl-map-legend__dot" style={{ background: COLOR_HEX.blue }} />
          Conference B
        </span>
        <span className="sdfl-map-legend__item sdfl-map-legend__item--muted">
          <span
            className="sdfl-map-legend__dot"
            style={{ background: "#000000", border: "1px solid #666" }}
          />
          Claimed (marker hidden)
        </span>
      </div>
    </div>
  );
}
