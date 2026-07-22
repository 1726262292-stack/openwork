/** @jsxImportSource react */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pickDirectory, chatsRootSet, type ChatsConfig } from "@/app/lib/desktop";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

type LocationChoice = "default" | "custom";

type ChangeLocationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "global" | "chat";
  config: ChatsConfig;
  onSaved: (config: ChatsConfig) => void;
  onUseSpecificFolder?: (path: string) => Promise<void>;
};

export type { ChatsConfig };

export function ChangeLocationDialog(props: ChangeLocationDialogProps) {
  const [choice, setChoice] = useState<LocationChoice>("default");
  const [customPath, setCustomPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setChoice(props.mode === "global" && !props.config.isDefault ? "custom" : "default");
    setCustomPath(props.mode === "global" && !props.config.isDefault ? props.config.root : "");
    setError(null);
  }, [props.config.isDefault, props.config.root, props.mode, props.open]);

  const browse = async () => {
    const picked = await pickDirectory({
      title: props.mode === "global"
        ? t("change_location.browse_global_title")
        : t("change_location.browse_chat_title"),
    });
    if (typeof picked === "string") {
      setChoice("custom");
      setCustomPath(picked);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (props.mode === "global") {
        const config = await chatsRootSet(choice === "default" ? null : customPath.trim());
        props.onSaved(config);
      } else if (choice === "custom") {
        const path = customPath.trim();
        if (!props.onUseSpecificFolder) throw new Error(t("change_location.specific_folder_unavailable"));
        await props.onUseSpecificFolder(path);
      }
      props.onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("change_location.save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const customDisabled = busy || (choice === "custom" && !customPath.trim());

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.mode === "global"
              ? t("change_location.global_title")
              : t("change_location.chat_title")}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "global"
              ? t("change_location.global_desc")
              : t("change_location.chat_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            className={cn(
              "w-full rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50",
              choice === "default" ? "border-ring ring-2 ring-ring/25" : "border-border",
            )}
            onClick={() => setChoice("default")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{t("change_location.default_location")}</div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t("change_location.recommended")}
              </span>
            </div>
            <div className="mt-1 text-sm text-foreground">{props.config.displayRoot}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("change_location.default_copy")}
            </div>
          </button>

          <div
            className={cn(
              "rounded-xl border bg-card p-4 transition-colors",
              choice === "custom" ? "border-ring ring-2 ring-ring/25" : "border-border",
            )}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setChoice("custom")}
            >
              <div className="font-medium">{t("change_location.custom_folder")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("change_location.custom_copy")}
              </div>
            </button>
            <div className="mt-3 flex gap-2">
              <input
                aria-label={t("change_location.path_label")}
                data-testid="change-location-path"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                value={customPath}
                onFocus={() => setChoice("custom")}
                onChange={(event) => setCustomPath(event.currentTarget.value)}
                placeholder={t("change_location.path_placeholder")}
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void browse()}
                disabled={busy}
              >
                {t("change_location.browse")}
              </Button>
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={customDisabled}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
