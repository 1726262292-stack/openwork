"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

export type DenTooltipProps = {
  /** Primary line. Rendered semi-bold. */
  label: string;
  /** Optional second line, e.g. a status. */
  detail?: string;
  /** Makes the trigger a link. Keeps one focusable element, not two. */
  href?: string;
  children: ReactNode;
  className?: string;
};

/**
 * DenTooltip
 *
 * Den's first tooltip. Deliberately state-driven rather than a CSS `:hover`
 * reveal: pointer and keyboard both open it, and it can be exercised without a
 * real mouse. No dependency — Den ships no popover library.
 *
 * The trigger is focusable so the tooltip is reachable by keyboard, and the
 * content is wired through `aria-describedby` rather than a `title`, so screen
 * readers announce it once instead of twice.
 */
export function DenTooltip({ label, detail, href, children, className = "" }: DenTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerClassName = "inline-flex rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-blue-300";

  return (
    <span
      className={`relative inline-flex ${className}`}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {href ? (
        <Link href={href} aria-describedby={tooltipId} className={triggerClassName}>
          {children}
        </Link>
      ) : (
        <span tabIndex={0} aria-describedby={tooltipId} className={triggerClassName}>
          {children}
        </span>
      )}
      <span
        id={tooltipId}
        role="tooltip"
        data-den-tooltip=""
        data-open={open ? "" : undefined}
        hidden={!open}
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-gray-900 px-2 py-1.5 text-left"
      >
        <span className="block text-[11px] font-semibold leading-[14px] text-white">{label}</span>
        {detail ? <span className="block text-[11px] leading-[14px] text-gray-300">{detail}</span> : null}
      </span>
    </span>
  );
}
