"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import type { Connection } from "@/lib/use-audit-stream";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand";
import { LiveDot, TONE_COLOR, type Tone } from "@/components/ui";

export type ViewId =
  | "overview"
  | "agent"
  | "intents"
  | "mandates"
  | "audit"
  | "scenarios";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  count?: number | null;
  tone?: Tone;
  /** Draws attention while something is genuinely waiting on a person. */
  urgent?: boolean;
};

export type NavGroup = { heading: string; items: NavItem[] };

/**
 * The rail.
 *
 * Grouped rather than a flat list, because the six sections are not peers: two
 * are ways of looking at the whole room, three are stages a rupee passes
 * through, and one is a test harness. The headings say so.
 *
 * Counts live on the rows so that focusing one section never means going blind
 * to the others — that was the whole risk in trading the everything-at-once
 * grid for one view at a time.
 */
export function DashboardNav({
  groups,
  active,
  connection,
  merchant,
  onSelect,
  onReset,
  resetting,
  resetDisabled,
}: {
  groups: NavGroup[];
  active: ViewId;
  connection: Connection;
  merchant: string;
  onSelect: (id: ViewId) => void;
  onReset: () => void;
  resetting: boolean;
  resetDisabled: boolean;
}) {
  return (
    <aside className="glass-surface glass-d3 flex shrink-0 flex-col gap-1 rounded-2xl border border-white/[0.08] p-3 shadow-xl backdrop-blur-2xl lg:w-[16rem]">
      <Link
        href="/"
        className="mb-3 rounded-xl px-1.5 py-1 transition-colors hover:bg-white/[0.04]"
        title="Back to the overview page"
      >
        <Wordmark />
      </Link>

      <nav aria-label="Control room sections" className="flex flex-1 flex-col gap-1">
        {groups.map((group) => (
          <div key={group.heading} className="mb-2">
            <p className="mb-1.5 px-2 text-[10px] leading-none font-medium tracking-[0.16em] text-mute-500 uppercase">
              {group.heading}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <Row key={item.id} item={item} active={active} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Reset is destructive — it wipes the trail — so it sits apart from
          navigation rather than among it. */}
      <button
        type="button"
        onClick={onReset}
        disabled={resetDisabled}
        className="mb-2 flex items-center gap-2.5 rounded-xl border border-fail-500/25 bg-fail-bg/40 px-3 py-2.5 text-left text-[12px] font-medium text-fail-500 transition-colors hover:border-fail-500/50 hover:bg-fail-bg/70 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <RotateCcw size={13} className={resetting ? "animate-spin" : undefined} />
        Reset demo
        <span className="ml-auto text-[10px] text-fail-500/70">clears trail</span>
      </button>

      {/* Who this room belongs to, and whether it is actually hearing anything. */}
      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-semibold"
          style={{
            background: "color-mix(in srgb, var(--color-brand-500) 18%, transparent)",
            color: "var(--color-brand-300)",
          }}
        >
          {merchant.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-tight font-medium text-mute-200">
            {merchant}
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] leading-tight text-mute-500">
            <LiveDot
              tone={connection === "live" ? "pass" : connection === "offline" ? "fail" : "gate"}
              active={connection === "live"}
            />
            {connection === "live" ? "streaming" : connection}
          </span>
        </span>
        <Link
          href="/"
          className="shrink-0 rounded-md p-1 text-mute-500 transition-colors hover:text-mute-200"
          aria-label="Back to the overview page"
        >
          <ExternalLink size={13} />
        </Link>
      </div>
    </aside>
  );
}

function Row({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: ViewId;
  onSelect: (id: ViewId) => void;
}) {
  const selected = item.id === active;
  const hue = TONE_COLOR[item.tone ?? "info"];

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        selected
          ? "bg-white/[0.07] text-mute-100"
          : "text-mute-400 hover:bg-white/[0.04] hover:text-mute-200",
      )}
    >
      {selected && (
        <span
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ background: "var(--color-brand-500)" }}
          aria-hidden
        />
      )}
      <item.icon
        size={15}
        className={cn("shrink-0", selected ? "text-brand-300" : "text-mute-500")}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.label}</span>

      {item.count !== null && item.count !== undefined && (
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            item.urgent && "animate-pulse-dot",
          )}
          style={
            item.urgent
              ? { background: `color-mix(in srgb, ${hue} 24%, transparent)`, color: hue }
              : { background: "rgba(255,255,255,0.06)", color: "var(--color-mute-400)" }
          }
        >
          {item.count}
        </span>
      )}
    </button>
  );
}
