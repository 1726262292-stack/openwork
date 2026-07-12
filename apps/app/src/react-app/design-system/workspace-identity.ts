export const WORKSPACE_IDENTITY_PALETTE = Object.freeze([
  "#499D81",
  "#3F7F96",
  "#4F6FAE",
  "#685DA8",
  "#855AA0",
  "#A25482",
  "#B65365",
  "#B9634D",
  "#B57935",
  "#96833B",
  "#708541",
  "#4F8557",
  "#556F82",
  "#8A6255",
]);

export function workspaceIdentityColor(workspaceId: string) {
  return WORKSPACE_IDENTITY_PALETTE[workspaceIdentityIndex(workspaceId)];
}

export function workspaceIdentityIndex(workspaceId: string) {
  let hash = 2166136261;

  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % WORKSPACE_IDENTITY_PALETTE.length;
}
