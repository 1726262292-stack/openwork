/** Strong solid markers for dark sidebars — hashed per workspace, no gradients. */
const PLANE_COLORS = [
  "#E23B4C",
  "#D44A7A",
  "#D9921A",
  "#1F9A62",
  "#3B6AE0",
  "#E06A28",
  "#A84FA0",
  "#1A9A9C",
  "#6B4FD4",
  "#2A8FBF",
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
