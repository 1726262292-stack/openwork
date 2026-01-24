import { Show } from "solid-js";
import { AlertTriangle, RefreshCcw } from "lucide-solid";

import Button from "./button";

export type ReloadWorkspaceToastProps = {
  open: boolean;
  title: string;
  description: string;
  warning: string;
  blockedReason?: string | null;
  error?: string | null;
  reloadLabel: string;
  dismissLabel: string;
  busy?: boolean;
  canReload: boolean;
  onReload: () => void;
  onDismiss: () => void;
};

export default function ReloadWorkspaceToast(props: ReloadWorkspaceToastProps) {
  return (
    <Show when={props.open}>
      <div class="fixed top-6 right-6 z-50 w-[min(420px,calc(100vw-2rem))]">
        <div class="rounded-2xl border border-gray-6/70 bg-gray-1/95 p-4 shadow-xl backdrop-blur animate-in fade-in slide-in-from-top-11 duration-200">
          <div class="flex items-start gap-3">
            <div class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-amber-7/30 bg-amber-7/10 text-amber-11">
              <RefreshCcw size={16} />
            </div>
            <div class="flex-1 space-y-2">
              <div>
                <div class="text-sm font-semibold text-gray-12">{props.title}</div>
                <div class="text-xs text-gray-10">{props.description}</div>
              </div>
              <div class="text-xs text-gray-10">{props.warning}</div>
              <Show when={props.blockedReason}>
                <div class="flex items-start gap-2 rounded-lg border border-amber-7/30 bg-amber-7/10 px-3 py-2 text-xs text-amber-11">
                  <AlertTriangle size={14} class="mt-0.5 shrink-0" />
                  <span>{props.blockedReason}</span>
                </div>
              </Show>
              <Show when={props.error}>
                <div class="rounded-lg border border-red-7/30 bg-red-7/10 px-3 py-2 text-xs text-red-11">
                  {props.error}
                </div>
              </Show>
            </div>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              class="h-8 px-3 text-xs"
              onClick={() => props.onDismiss()}
              disabled={props.busy}
            >
              {props.dismissLabel}
            </Button>
            <Button
              variant="secondary"
              class="h-8 px-3 text-xs"
              onClick={() => props.onReload()}
              disabled={!props.canReload}
            >
              {props.reloadLabel}
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
