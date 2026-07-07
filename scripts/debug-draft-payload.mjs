#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const leagueId = process.argv[2] ?? "687bc17b-9154-46f6-abb9-1aa820855df1";
const userId = process.argv[3] ?? "54ad37e7-0317-42e1-a149-94f79f73f78a";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const { data: state } = await supabase
  .from("league_draft_state")
  .select("*")
  .eq("league_id", leagueId)
  .single();

const { data: profile } = await supabase
  .from("profiles")
  .select("id, team_name, username")
  .eq("id", userId)
  .single();

const { data: draft } = await supabase
  .from("drafts")
  .select("*")
  .eq("league_id", leagueId)
  .eq("user_id", userId)
  .maybeSingle();

const { data: picks } = await supabase
  .from("draft_picks")
  .select("symbol, round_number, pick_type")
  .eq("draft_id", draft?.id ?? "00000000-0000-0000-0000-000000000000");

const pickIndex = state?.current_pick_index ?? 0;
const order = state?.draft_order ?? [];
const expectedOnClock = order[pickIndex % order.length] ?? null;

console.log(
  JSON.stringify(
    {
      profile,
      draftState: {
        on_clock_user_id: state?.on_clock_user_id,
        current_pick_index: state?.current_pick_index,
        global_pick_number: state?.global_pick_number,
        pick_deadline_at: state?.pick_deadline_at,
        draft_order: order,
      },
      expectedOnClockUserId: expectedOnClock,
      isMyTurn: state?.on_clock_user_id === userId,
      authUidMatchesMember: profile?.id === userId,
      draftRow: draft,
      picks,
      uiPickLabel: (state?.global_pick_number ?? 0) + 1,
    },
    null,
    2
  )
);
