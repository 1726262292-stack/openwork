/** Muted plane colors — hashed per workspace, no gradients. */
const PLANE_COLORS = [
  "#D94A5B",
  "#B85F7A",
  "#C79245",
  "#5B8A72",
  "#5B6FA8",
  "#C27A4A",
  "#9B6B8A",
  "#4A8B8C",
  "#7A6BA8",
  "#6B8FA3",
] as const;

export function workspaceAvatarInitials(label: string) {
  const parts = label
    .trim()
    .split(/[\s/_.-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const single = parts[0] ?? "";
    return single.slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}

export function workspaceAvatarColor(workspaceId: string) {
  const seed = workspaceId.trim() || "openwork";
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return PLANE_COLORS[(hash >>> 0) % PLANE_COLORS.length] ?? PLANE_COLORS[0];
}
