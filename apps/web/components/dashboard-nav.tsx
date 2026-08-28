"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { TONE_COLOR, type Tone } from "@/components/ui";

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
  /** One-line answer to "what is in here", shown on the wide rail. */
  hint: string;
  /** Live count. `tone` colours it when it needs attention. */
  count?: number | null;
  tone?: Tone;
  /** Draws attention while something is genuinely waiting on a person. */
  urgent?: boolean;
};

/**
 * The control room's rail.
 *
 * Five panels competing for one screen was the density problem; this trades
 * that for one view at a time. The rail is not only navigation, though — each
 * row carries the live count for its section, so choosing a view never means
 * losing sight of what is happening in the others. That is the whole reason a
 * sidebar is worth its width here rather than a row of tabs.
 */
export function DashboardNav({
  items,
  active,
  onSelect,
}: {
  items: NavItem[];
  active: ViewId;
  onSelect: (id: ViewId) => void;
}) {
  return (
    <nav
      aria-label="Control room sections"
      className="glass-surface glass-d3 flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl border border-white/[0.08] p-2 shadow-xl backdrop-blur-2xl lg:w-[15.5rem] lg:flex-col lg:overflow-visible"
    >
      <Link
        href="/"
        title="Back to the overview page"
        className="group mb-1 hidden items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.05] lg:flex"
      >
        <span className="relative grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-[14px] font-bold text-white shadow-lg shadow-brand-500/30">
          <span className="transition-opacity group-hover:opacity-0">₹</span>
          <ArrowLeft
            size={14}
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-tight font-semibold tracking-tight text-mute-100">
            AgentMandi
          </span>
          <span className="block truncate text-[10px] leading-tight tracking-[0.12em] text-mute-500 uppercase">
            control room
          </span>
        </span>
      </Link>

      <span className="mx-1 mb-1 hidden h-px bg-white/[0.07] lg:block" aria-hidden />

      {items.map((item) => {
        const selected = item.id === active;
        const hue = TONE_COLOR[item.tone ?? "info"];
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "group relative flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
              selected
                ? "bg-white/[0.08] text-mute-100"
                : "text-mute-400 hover:bg-white/[0.04] hover:text-mute-200",
            )}
          >
            {/* The selected rail marker, rather than a full coloured fill. */}
            <span
              className={cn(
                "absolute top-1/2 left-0 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity lg:block",
                selected ? "opacity-100" : "opacity-0",
              )}
              style={{ background: "var(--color-brand-500)" }}
              aria-hidden
            />
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-lg border transition-colors",
                selected ? "border-transparent" : "border-white/[0.07]",
              )}
              style={
                selected
                  ? {
                      background: "color-mix(in srgb, var(--color-brand-500) 20%, transparent)",
                      color: "var(--color-brand-300)",
                    }
                  : undefined
              }
            >
              <item.icon size={13} />
            </span>

            {/* One label in the DOM, not one per breakpoint: rendering a second
                copy and hiding it with CSS makes a screen reader read the row
                twice. Only the hint drops away on a collapsed rail. */}
            <span className="min-w-0 lg:flex-1">
              <span className="block truncate text-[12px] leading-tight font-medium">
                {item.label}
              </span>
              <span className="hidden truncate text-[10px] leading-tight text-mute-500 lg:block">
                {item.hint}
              </span>
            </span>

            {item.count !== null && item.count !== undefined && (
              <span
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                  item.urgent && "animate-pulse-dot",
                )}
                style={
                  item.urgent
                    ? {
                        background: `color-mix(in srgb, ${hue} 22%, transparent)`,
                        color: hue,
                      }
                    : { background: "rgba(255,255,255,0.06)", color: "var(--color-mute-400)" }
                }
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
