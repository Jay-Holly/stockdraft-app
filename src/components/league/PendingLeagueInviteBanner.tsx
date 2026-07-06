import type { PendingHumanLeagueInvite } from "@/lib/league/human-league";

export function PendingLeagueInviteBanner({
  invites,
}: {
  invites: PendingHumanLeagueInvite[];
}) {
  if (invites.length === 0) return null;

  return (
    <div className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 space-y-2">
      {invites.map((invite) => (
        <p key={invite.leagueId} className="text-sm text-gold">
          You have a pending invite to{" "}
          <span className="font-semibold text-white">{invite.leagueName}</span>
          {invite.commissionerTeam ? (
            <>
              {" "}
              from{" "}
              <span className="font-medium text-white">
                {invite.commissionerTeam}
              </span>
            </>
          ) : null}
          .{" "}
          <a
            href={`/leagues/join/${invite.inviteToken}`}
            className="font-semibold underline underline-offset-2 hover:text-white transition-colors"
          >
            Join league
          </a>
        </p>
      ))}
    </div>
  );
}
