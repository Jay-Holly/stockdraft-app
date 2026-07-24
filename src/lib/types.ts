export type Profile = {
  id: string;
  username: string;
  team_name: string;
  avatar_color: string;
  created_at: string;
  email?: string | null;
  day_trader_joined_at?: string | null;
  is_admin?: boolean;
};

export const AVATAR_COLORS = [
  { id: "blue", label: "Blue", hex: "#0a3d8f" },
  { id: "gold", label: "Gold", hex: "#d0ab48" },
  { id: "green", label: "Green", hex: "#10b981" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "purple", label: "Purple", hex: "#8b5cf6" },
  { id: "orange", label: "Orange", hex: "#f97316" },
] as const;

export type AvatarColorId = (typeof AVATAR_COLORS)[number]["id"];

export function getAvatarHex(_colorId: string): string {
  // Avatars are a single universal brand color everywhere now — no more
  // per-user color choice. Argument kept for call-site compatibility.
  return "#14213f";
}
