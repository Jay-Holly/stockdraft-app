import type { IrResolutionState } from "@/lib/sim/types";

type Props = {
  resolution: IrResolutionState | null | undefined;
};

export function RosterIrBanner({ resolution }: Props) {
  if (!resolution?.required || !resolution.message) return null;

  return (
    <div
      className="season-calendar-banner season-calendar-banner--ir"
      role="status"
    >
      <p className="season-calendar-banner__title">IR resolution required</p>
      <p className="season-calendar-banner__detail">{resolution.message}</p>
    </div>
  );
}
