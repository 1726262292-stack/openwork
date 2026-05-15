/** @jsxImportSource react */

export type PolicyRowProps = {
  label: string;
  description: string;
  active: boolean;
};

export function PolicyRow({ label, description, active }: PolicyRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-100 dark:text-neutral-100">{label}</div>
        <div className="text-xs text-neutral-400 dark:text-neutral-400">{description}</div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
          active
            ? "bg-amber-900/40 text-amber-400 dark:bg-amber-900/40 dark:text-amber-400"
            : "bg-green-900/40 text-green-400 dark:bg-green-900/40 dark:text-green-400"
        }`}
      >
        {active ? "Restricted" : "Allowed"}
      </span>
    </div>
  );
}
