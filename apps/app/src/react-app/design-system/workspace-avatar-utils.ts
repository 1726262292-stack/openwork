/** Bright solid markers for dark sidebars — hashed per workspace, no gradients. */
const PLANE_COLORS = [
  "#F06172",
  "#E07A9A",
  "#E8B04A",
  "#4DB88A",
  "#6B8CFF",
  "#F08A52",
  "#C784B8",
  "#3DB8BA",
  "#9B84E8",
  "#5BB8D9",
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
