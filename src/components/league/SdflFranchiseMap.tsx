"use client";

import { useMemo, useState } from "react";
import {
  SDFL_DIVISION_SLOTS,
  slotKey,
  slotsEqual,
  type SdflConference,
  type SdflDivision,
  type SdflDivisionSlot,
} from "@/lib/league/sdfl-divisions";
import {
  mapRealTeamToDisplayLabel,
  mapSdflSlotToRealTeam,
} from "@/lib/sim/nfl-team-alignment";
import {
  NFL_TEAM_MAP_COORDS,
  SDFL_MAP_IMAGE_HEIGHT,
  SDFL_MAP_IMAGE_WIDTH,
} from "@/lib/league/nfl-team-map-coords";
import type { LeagueIdentityPayload } from "@/lib/league/team-identity";

const CONFERENCE_COLOR: Record<SdflConference, string> = {
  sdal: "#1a5fbf",
  sdnl: "#dc4444",
};

export function SdflFranchiseMap({
  payload,
  mySlotKey,
  claimingKey,
  previewColor,
  onClaimSlot,
}: {
  payload: LeagueIdentityPayload;
  mySlotKey: string | null;
  claimingKey: string | null;
  previewColor?: string | null;
  onClaimSlot: (slot: SdflDivisionSlot) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const openSlotKeys = useMemo(
    () => new Set(payload.openSlots.map(slotKey)),
    [payload.openSlots]
  );

  const claimedByKey = useMemo(
    () => new Map(payload.claimedSlots.map((entry) => [slotKey(entry), entry])),
    [payload.claimedSlots]
  );

  const markers = useMemo(
    () =>
      SDFL_DIVISION_SLOTS.map((slot) => {
        const key = slotKey(slot);
        const team = mapSdflSlotToRealTeam(
          slot.conference,
          slot.division,
          slot.divisionSlot
        );
        const label = team ? mapRealTeamToDisplayLabel(team) : null;
        const coords = label ? NFL_TEAM_MAP_COORDS[label] : null;
        return { slot, key, team: label, coords };
      }).filter(
        (marker): marker is typeof marker & { coords: { x: number; y: number } } =>
          marker.coords !== null
      ),
    []
  );

  const hovered = hoveredKey
    ? markers.find((m) => m.key === hoveredKey) ?? null
    : null;
  const hoveredClaim = hovered ? claimedByKey.get(hovered.key) : null;

  return (
    <div className="sdfl-map-wrap">
      <svg
        viewBox={`0 0 ${SDFL_MAP_IMAGE_WIDTH} ${SDFL_MAP_IMAGE_HEIGHT}`}
        className="sdfl-map-svg"
        role="group"
        aria-label="SDFL franchise map — claim an open division slot"
      >
        <image
          href="/images/league/sdfl-map.png"
          x="0"
          y="0"
          width={SDFL_MAP_IMAGE_WIDTH}
          height={SDFL_MAP_IMAGE_HEIGHT}
        />

        {markers.map(({ slot, key, team, coords }) => {
          const isOpen = openSlotKeys.has(key);
          const isMine = mySlotKey === key;
          const claimed = claimedByKey.get(key);
          const isClaiming = claimingKey === key;
          const disabled = !isOpen && !isMine;
          const color = CONFERENCE_COLOR[slot.conference];
          // The background art already draws each team's colored dot.
          // Claiming a slot masks that dot out (it "disappears") rather
          // than redrawing a colored circle on top of it.
          const isTaken = Boolean(claimed) || isClaiming;

          return (
            <g
              key={key}
              transform={`translate(${coords.x}, ${coords.y})`}
              className={[
                "sdfl-map-marker",
                isMine ? "sdfl-map-marker--mine" : "",
                isClaiming ? "sdfl-map-marker--claiming" : "",
                disabled && !claimed ? "sdfl-map-marker--disabled" : "",
              ].join(" ")}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey((cur) => (cur === key ? null : cur))}
              onClick={() => {
                if ((isOpen || isMine) && !isClaiming) onClaimSlot(slot);
              }}
              role="button"
              tabIndex={disabled && !isMine ? -1 : 0}
              aria-label={`${team} slot — ${claimed ? claimed.displayName ?? "claimed" : "open"}`}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && (isOpen || isMine) && !isClaiming) {
                  e.preventDefault();
                  onClaimSlot(slot);
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
          <p className="sdfl-map-tooltip__team">{hovered.team}</p>
          <p className="sdfl-map-tooltip__status">
            {hoveredClaim
              ? `${hoveredClaim.displayName ?? "Claimed"}${hoveredClaim.identityComplete ? "" : " (setting up)"}`
              : "Open — tap to claim"}
          </p>
        </div>
      )}

      <div className="sdfl-map-legend">
        <span className="sdfl-map-legend__item">
          <span className="sdfl-map-legend__dot" style={{ background: CONFERENCE_COLOR.sdal }} />
          SDAL
        </span>
        <span className="sdfl-map-legend__item">
          <span className="sdfl-map-legend__dot" style={{ background: CONFERENCE_COLOR.sdnl }} />
          SDNL
        </span>
        <span className="sdfl-map-legend__item sdfl-map-legend__item--muted">
          <span className="sdfl-map-legend__dot" style={{ background: "#000000", border: "1px solid #666" }} />
          Claimed (marker hidden)
        </span>
      </div>
    </div>
  );
}

export function isSlotClaimed(
  payload: LeagueIdentityPayload,
  slot: SdflDivisionSlot
): boolean {
  return payload.claimedSlots.some((entry) => slotsEqual(entry, slot));
}

export type { SdflDivision };
