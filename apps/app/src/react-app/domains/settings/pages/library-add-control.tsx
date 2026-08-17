/** @jsxImportSource react */
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "../../../../i18n";
import type { LibraryAddKind } from "../library";

export function libraryAddKindLabel(kind: LibraryAddKind) {
  switch (kind) {
    case "skill":
      return t("extensions.add_skill");
    case "command":
      return t("extensions.add_command");
    case "agent":
      return t("extensions.add_agent");
    case "mcp":
      return t("extensions.add_mcp");
    case "plugin":
      return t("extensions.add_plugin");
    case "connection":
      return t("extensions.add_connection");
  }
}

export function LibraryAddControl(props: {
  kinds: LibraryAddKind[];
  onSelect: (kind: LibraryAddKind) => void;
  size?: "xs" | "sm" | "default";
  variant?: "default" | "outline";
}) {
  const kinds = props.kinds;
  if (kinds.length === 0) return null;
  const size = props.size ?? "default";
  const variant = props.variant ?? "default";

  const onlyKind = kinds[0];
  if (kinds.length === 1 && onlyKind) {
    return (
      <Button variant={variant} size={size} className="shrink-0 rounded-lg" onClick={() => props.onSelect(onlyKind)}>
        <Plus size={16} />
        {libraryAddKindLabel(onlyKind)}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button variant={variant} size={size} className="shrink-0 gap-1 rounded-lg">
            <Plus size={16} />
            {t("common.add")}
            <ChevronDown size={14} />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-48">
        {kinds.map((kind) => (
          <DropdownMenuItem key={kind} onClick={() => props.onSelect(kind)}>
            {libraryAddKindLabel(kind)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
