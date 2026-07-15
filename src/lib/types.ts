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

export function getAvatarHex(colorId: string): string {
  return AVATAR_COLORS.find((c) => c.id === colorId)?.hex ?? "#0a3d8f";
}
