/** @jsxImportSource react */
import { cn } from "@/lib/utils";
import { workspaceIdentityColor } from "./workspace-identity";

export type WorkspaceIconProps = {
  workspaceId: string;
  /** CSS size class, e.g. "size-4", "size-5.5". Defaults to "size-4". */
  sizeClass?: string;
};

export function WorkspaceIcon({ workspaceId, sizeClass = "size-4" }: WorkspaceIconProps) {
  const color = workspaceIdentityColor(workspaceId);

  return (
    <span
      className={cn("block shrink-0 rounded-full", sizeClass)}
      style={{ backgroundColor: color }}
      data-openwork-workspace-icon="true"
      data-workspace-id={workspaceId}
      data-workspace-color={color}
      role="presentation"
      aria-hidden="true"
    />
  );
}
