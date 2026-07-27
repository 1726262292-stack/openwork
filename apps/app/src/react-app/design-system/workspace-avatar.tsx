/** @jsxImportSource react */

import {
  workspaceAvatarColor,
  workspaceAvatarInitials,
} from "./workspace-avatar-utils";

export type WorkspaceAvatarProps = {
  workspaceId: string;
  label: string;
  /** Optional custom picture; falls back to initials + color when absent. */
  imageUrl?: string | null;
  /** CSS size class, e.g. "size-4". Defaults to "size-4". */
  sizeClass?: string;
};

export { workspaceAvatarColor, workspaceAvatarInitials };

export function WorkspaceAvatar({
  workspaceId,
  label,
  imageUrl,
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
      style={{ backgroundColor: workspaceAvatarColor(workspaceId) }}
      role="presentation"
      aria-hidden="true"
      data-workspace-avatar=""
      title={label}
    >
      {workspaceAvatarInitials(label)}
    </span>
  );
}
