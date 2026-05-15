/** @jsxImportSource react */

export type ToggleRowProps = {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  locked?: boolean;
  lockedHint?: string;
  nested?: boolean;
};

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  locked,
  lockedHint,
  nested,
}: ToggleRowProps) {
  return (
    <div className={`flex items-center justify-between gap-4 ${nested ? "ml-6" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-neutral-100 dark:text-neutral-100">{label}</div>
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:bg-neutral-800 dark:text-neutral-400">
              Managed
            </span>
          ) : null}
        </div>
        <div className="text-xs text-neutral-400 dark:text-neutral-400">{description}</div>
        {locked && lockedHint ? (
          <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-500">{lockedHint}</div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={locked}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${checked ? "bg-neutral-100 dark:bg-neutral-100" : "bg-neutral-700 dark:bg-neutral-700"}`}
        onClick={() => !locked && onChange(!checked)}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-neutral-900 dark:bg-neutral-900 transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}
