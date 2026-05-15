/** @jsxImportSource react */

export type ThreeStateValue = "unset" | "show" | "hide";

export type ThreeStateSelectProps = {
  label: string;
  description: string;
  value: ThreeStateValue;
  onChange: (value: ThreeStateValue) => void;
  disabled?: boolean;
};

export function ThreeStateSelect({
  label,
  description,
  value,
  onChange,
  disabled,
}: ThreeStateSelectProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-100 dark:text-neutral-100">{label}</div>
        <div className="text-xs text-neutral-400 dark:text-neutral-400">{description}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ThreeStateValue)}
        disabled={disabled}
        className={`shrink-0 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <option value="unset">User decides</option>
        <option value="show">Always show</option>
        <option value="hide">Always hide</option>
      </select>
    </div>
  );
}
