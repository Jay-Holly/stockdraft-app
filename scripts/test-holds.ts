import { recordHold, resolveHold, listOpenHolds, listRecentlyResolvedHolds } from "../src/lib/holds/store";
let fails = 0;
const check = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) fails++; };

async function main() {
  const id = `selftest-${Date.now()}`;

  console.log("\n[1] a refusal opens a hold");
  await recordHold({ kind: "contest-lock", subjectType: "sddfs_contest", subjectId: id,
    reason: "Contest will not lock: no opening price for 2 symbol(s).", detail: { missingSymbols: ["AAA", "BBB"] } });
  let open = await listOpenHolds();
  let mine = open.find((h) => h.subjectId === id);
  check("hold is open", !!mine);
  check("occurrences = 1", mine?.occurrences === 1);

  console.log("\n[2] the SAME refusal repeating does not spam — it updates");
  for (let i = 0; i < 4; i++) {
    await recordHold({ kind: "contest-lock", subjectType: "sddfs_contest", subjectId: id,
      reason: "Contest will not lock: no opening price for 1 symbol(s).", detail: { missingSymbols: ["AAA"] } });
  }
  open = await listOpenHolds();
  const dupes = open.filter((h) => h.subjectId === id);
  mine = dupes[0];
  check("still exactly one row", dupes.length === 1, `${dupes.length} rows`);
  check("occurrences now 5", mine?.occurrences === 5, String(mine?.occurrences));
  check("reason refreshed to the current one", (mine?.reason ?? "").includes("1 symbol"), mine?.reason);

  console.log("\n[3] success closes it");
  await resolveHold("contest-lock", "sddfs_contest", id, "locked with a full set of opening prices");
  open = await listOpenHolds();
  check("no longer open", !open.some((h) => h.subjectId === id));
  const done = await listRecentlyResolvedHolds(25);
  const rec = done.find((h) => h.subjectId === id);
  check("kept as a resolved record", !!rec);
  check("records why", rec?.resolution?.includes("full set") === true, rec?.resolution ?? "");

  console.log("\n[4] resolving something not held is harmless");
  await resolveHold("contest-lock", "sddfs_contest", "does-not-exist");
  check("no throw", true);

  console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} FAILURE(S)`}`);
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
