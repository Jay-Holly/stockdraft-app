import { DfsShell } from "@/components/dfs/DfsShell";
import { FreeAgentPanel } from "@/components/dfs/FreeAgentPanel";
import { getMyDfsEntries } from "@/lib/dfs/my-teams";

export default async function DfsFreeAgentsPage() {
  const entries = await getMyDfsEntries();
  const openEntries = entries.filter((e) => e.contestStatus === "open");

  return (
    <DfsShell title="SDDFS — Free Agents">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Free Agents</h1>
          <p className="text-muted text-sm">
            Swap a stock in one of your active lineups before it locks.
          </p>
        </div>

        <FreeAgentPanel entries={openEntries} />
      </div>
    </DfsShell>
  );
}
