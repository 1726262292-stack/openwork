/** @jsxImportSource react */
import { useState } from "react";
import { ChevronRight, Puzzle, Settings2, Zap, FolderLock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SettingsPaneTab = "extensions" | "providers" | "permissions";

export type SettingsPaneProps = {
  activeTab: SettingsPaneTab;
  onTabChange: (tab: SettingsPaneTab) => void;
  onClose: () => void;
  onOpenFullSettings: (path: string) => void;
  extensionsSlot?: React.ReactNode;
  providersSlot?: React.ReactNode;
  permissionsSlot?: React.ReactNode;
};

const tabs: Array<{ id: SettingsPaneTab; label: string; icon: typeof Puzzle }> = [
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "providers", label: "AI Providers", icon: Zap },
  { id: "permissions", label: "Permissions", icon: FolderLock },
];

export function SettingsPane(props: SettingsPaneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2 size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Settings</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => props.onOpenFullSettings(`/settings/${props.activeTab === "providers" ? "ai" : props.activeTab}`)}
          >
            Open full
            <ChevronRight size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={props.onClose} aria-label="Close settings">
            <X size={16} />
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                props.activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => props.onTabChange(tab.id)}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {props.activeTab === "extensions" ? props.extensionsSlot : null}
        {props.activeTab === "providers" ? props.providersSlot : null}
        {props.activeTab === "permissions" ? props.permissionsSlot : null}
      </div>
    </div>
  );
}
