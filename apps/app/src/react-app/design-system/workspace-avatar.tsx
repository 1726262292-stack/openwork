/** @jsxImportSource react */

import {
  resolveWorkspaceAvatarColor,
  workspaceAvatarColor,
  workspaceAvatarInitials,
} from "./workspace-avatar-utils";

export type WorkspaceAvatarProps = {
  workspaceId: string;
  label: string;
  /** Optional custom picture; falls back to initials + color when absent. */
  imageUrl?: string | null;
  /** Optional preferred solid color; falls back to hashed autoset color. */
  color?: string | null;
  /** CSS size class, e.g. "size-4". Defaults to "size-4". */
  sizeClass?: string;
};

export { workspaceAvatarColor, workspaceAvatarInitials, resolveWorkspaceAvatarColor };

export function WorkspaceAvatar({
  workspaceId,
  label,
  imageUrl,
  color,
  sizeClass = "size-4",
}: WorkspaceAvatarProps) {
  const trimmedUrl = imageUrl?.trim() ?? "";
  if (trimmedUrl) {
    return (
      <img
        src={trimmedUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-[5px] object-cover`}
        draggable={false}
        data-workspace-avatar=""
      />
    );
  }

  return (
    <span
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold leading-none text-white`}
      style={{ backgroundColor: resolveWorkspaceAvatarColor(workspaceId, color) }}
      role="presentation"
      aria-hidden="true"
      data-workspace-avatar=""
      title={label}
    >
      {workspaceAvatarInitials(label)}
    </span>
  );
}
