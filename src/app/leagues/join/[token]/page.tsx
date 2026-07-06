import { getLeagueInvitePreview } from "@/lib/league/human-league";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export default async function JoinLeaguePage({ params }: PageProps) {
  const { token } = await params;
  const preview = await getLeagueInvitePreview(token);

  if (!preview) {
    return <div>preview is null for token: {token}</div>;
  }

  return (
    <div>
      League: {preview.leagueName} — Status: {preview.status}
    </div>
  );
}
