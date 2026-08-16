"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenTooltip } from "../../_components/ui/tooltip";
import type { FlowStatusTone } from "./library-status";

/**
 * Shared geometry. Icon flow shows three full rows; row flow is capped to the
 * same visual height so every overview card stops at the same place.
 */
export const ICON_TILE_PX = 75;
export const ICON_GAP_PX = 10;
export const ICON_ROWS = 3;
export const ICON_FLOW_MAX_HEIGHT = ICON_TILE_PX * ICON_ROWS + ICON_GAP_PX * (ICON_ROWS - 1);

export const ROW_HEIGHT_PX = 15;
export const ROW_GAP_PX = 5;
/** Chosen so the row flow lands as close as possible under the icon flow's height. */
export const ROW_COUNT = 12;
export const ROW_FLOW_MAX_HEIGHT = ROW_HEIGHT_PX * ROW_COUNT + ROW_GAP_PX * (ROW_COUNT - 1);

const statusDotClasses: Record<FlowStatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-blue-500",
};

/**
 * Clamps a flow to a pixel height and reveals the rest behind "Show more".
 *
 * The overflow is measured rather than predicted: wrapping depends on the
 * container width, so counting items would guess wrong at some breakpoint.
 */
function FlowClamp({
  collapsedMaxHeight,
  itemCount,
  children,
}: {
  collapsedMaxHeight: number;
  itemCount: number;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => setOverflowing(node.scrollHeight > collapsedMaxHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsedMaxHeight, itemCount]);

  return (
    <>
      <div
        ref={contentRef}
        data-library-flow-content=""
        data-library-flow-expanded={expanded ? "" : undefined}
        style={expanded ? undefined : { maxHeight: collapsedMaxHeight }}
        className={expanded ? "" : "overflow-hidden"}
      >
        {children}
      </div>
      {overflowing || expanded ? (
        <button
          type="button"
          data-library-show-more=""
          onClick={() => setExpanded((current) => !current)}
          className="mt-3 text-[12px] font-medium text-gray-500 hover:text-gray-900"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

export type IconFlowItem = {
  key: string;
  /** Tooltip headline. */
  name: string;
  /** Tooltip second line. */
  statusLabel: string;
  tone: FlowStatusTone;
  iconUrl?: string;
  simpleIconSlug?: string;
  serviceUrl?: string | null;
  /** Rendered over a faded icon. Used by models. */
  overlayLabel?: string;
  /** Makes the whole tile a link. */
  href?: string;
};

function IconTile({ item }: { item: IconFlowItem }) {
  const overlaid = item.overlayLabel !== undefined;

  return (
    <DenTooltip label={item.name} detail={item.statusLabel} href={item.href}>
      <span
        data-library-icon=""
        data-library-item-key={item.key}
        className="relative block"
        style={{ height: ICON_TILE_PX, width: ICON_TILE_PX }}
      >
        <DenBrandMark
          name={item.name}
          iconUrl={item.iconUrl}
          simpleIconSlug={item.simpleIconSlug}
          serviceUrl={item.serviceUrl}
          className={`h-full w-full rounded-[14px] ${overlaid ? "opacity-20" : ""}`}
          imageClassName={overlaid ? "h-10 w-10" : "h-9 w-9"}
        />
        {overlaid ? (
          <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-[10px] font-semibold leading-[12px] text-gray-900">
            <span className="line-clamp-3">{item.overlayLabel}</span>
          </span>
        ) : null}
        <span
          aria-hidden
          data-library-status={item.tone}
          className={`absolute -right-[3px] -top-[3px] h-[13px] w-[13px] rounded-full border-2 border-white ${statusDotClasses[item.tone]}`}
        />
      </span>
    </DenTooltip>
  );
}

export function IconFlow({ items }: { items: IconFlowItem[] }) {
  return (
    <FlowClamp collapsedMaxHeight={ICON_FLOW_MAX_HEIGHT} itemCount={items.length}>
      <div data-library-icon-flow="" className="flex flex-wrap" style={{ gap: ICON_GAP_PX }}>
        {items.map((item) => <IconTile key={item.key} item={item} />)}
      </div>
    </FlowClamp>
  );
}

export type RowFlowBadge = {
  label: string;
  count: number;
};

export type RowFlowItem = {
  key: string;
  name: string;
  badges?: RowFlowBadge[];
  href?: string;
};

function RowFlowLine({ item }: { item: RowFlowItem }) {
  const content = (
    <>
      <span className="min-w-0 truncate text-[11.5px] leading-[15px] text-gray-700">{item.name}</span>
      {item.badges?.length ? (
        <span className="flex shrink-0 items-center gap-1">
          {item.badges.map((badge) => (
            <span
              key={badge.label}
              data-library-row-badge={badge.label}
              className="rounded-[4px] bg-gray-100 px-1 text-[9px] font-medium leading-[13px] text-gray-500"
            >
              {badge.count} {badge.label}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      data-library-row=""
      data-library-item-key={item.key}
      className="flex items-center justify-between gap-2"
      style={{ height: ROW_HEIGHT_PX }}
    >
      {item.href ? (
        <a href={item.href} className="flex min-w-0 flex-1 items-center justify-between gap-2 hover:underline">
          {content}
        </a>
      ) : content}
    </div>
  );
}

export function RowFlow({ items }: { items: RowFlowItem[] }) {
  return (
    <FlowClamp collapsedMaxHeight={ROW_FLOW_MAX_HEIGHT} itemCount={items.length}>
      <div data-library-row-flow="" className="flex flex-col" style={{ gap: ROW_GAP_PX }}>
        {items.map((item) => <RowFlowLine key={item.key} item={item} />)}
      </div>
    </FlowClamp>
  );
}
