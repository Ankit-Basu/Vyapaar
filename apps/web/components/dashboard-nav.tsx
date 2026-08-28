"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import type { Connection } from "@/lib/use-audit-stream";
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
  /** What *happens* at this stage, in the product's own voice. */
  hint: string;
  /** Live count. `tone` colours it when it needs attention. */
  count?: number | null;
  tone?: Tone;
  /** Draws attention while something is genuinely waiting on a person. */
  urgent?: boolean;
};

/**
 * The rail.
 *
 * Not a list of pages. The four middle entries are the actual stages a rupee
 * passes through — consent is granted, the agent shops, the guardrails decide,
 * the trail records — drawn as one connected line with a node per stage. It is
 * the same chain metaphor the audit feed uses, applied to navigation, and it
 * carries the same travelling highlight while the stream is live.
 *
 * The counts matter as much as the links: focusing one section should never
 * mean going blind to the others.
 */
export function DashboardNav({
  items,
  active,
  connection,
  onSelect,
}: {
  items: NavItem[];
  active: ViewId;
  connection: Connection;
  onSelect: (id: ViewId) => void;
}) {
  const overview = items.find((i) => i.id === "overview");
  const scenarios = items.find((i) => i.id === "scenarios");
  // Ordered the way money actually moves, not the way the panels are laid out.
  const flow = (["mandates", "agent", "intents", "audit"] as const)
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is NavItem => Boolean(i));

  return (
    <nav
      aria-label="Control room sections"
      className="glass-surface glass-d3 flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl border border-white/[0.08] p-2.5 shadow-xl backdrop-blur-2xl lg:w-[16.5rem] lg:flex-col lg:overflow-visible"
    >
      <Link
        href="/"
        title="Back to the overview page"
        className="group mb-2 hidden items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.05] lg:flex"
      >
        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-[15px] font-bold text-white shadow-lg shadow-brand-500/30">
          <span className="transition-opacity group-hover:opacity-0">₹</span>
          <ArrowLeft
            size={14}
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] leading-tight font-semibold tracking-tight text-mute-100">
            AgentMandi
          </span>
          <span className="block truncate text-[10px] leading-tight tracking-[0.16em] text-mute-500 uppercase">
            control room
          </span>
        </span>
      </Link>

      {overview && <Row item={overview} active={active} onSelect={onSelect} />}

      <p className="mt-3 mb-1.5 hidden px-2 text-[9px] leading-none tracking-[0.18em] text-mute-500 uppercase lg:block">
        The path of a rupee
      </p>

      {/* The flow. One rail, four nodes, drawn once for the whole group. */}
      <div className="relative flex flex-row gap-1 lg:flex-col">
        <span
          className="pointer-events-none absolute top-4 bottom-4 left-[26px] hidden w-px bg-white/[0.09] lg:block"
          aria-hidden
        />
        {connection === "live" && (
          <span
            className="chain-flow pointer-events-none absolute top-4 bottom-4 left-[26px] hidden w-px opacity-70 lg:block"
            aria-hidden
          />
        )}
        {flow.map((item) => (
          <Row key={item.id} item={item} active={active} onSelect={onSelect} onFlow />
        ))}
      </div>

      <span className="mx-2 my-2 hidden h-px bg-white/[0.07] lg:block" aria-hidden />

      {scenarios && <Row item={scenarios} active={active} onSelect={onSelect} />}
    </nav>
  );
}

function Row({
  item,
  active,
  onSelect,
  onFlow = false,
}: {
  item: NavItem;
  active: ViewId;
  onSelect: (id: ViewId) => void;
  /** Sits on the pipeline rail, so it draws a node instead of a plain icon tile. */
  onFlow?: boolean;
}) {
  const selected = item.id === active;
  const hue = TONE_COLOR[item.tone ?? "info"];

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "group relative flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        selected ? "bg-white/[0.08] text-mute-100" : "text-mute-400 hover:bg-white/[0.04] hover:text-mute-200",
      )}
    >
      <span
        className={cn(
          "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition-colors",
          selected ? "border-transparent" : "border-white/[0.08]",
          // A node on the rail has to be opaque or the line shows through it.
          onFlow && "bg-ink-950",
        )}
        style={
          selected
            ? {
                background: "color-mix(in srgb, var(--color-brand-500) 22%, var(--color-ink-950))",
                color: "var(--color-brand-300)",
                boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-brand-500) 14%, transparent)",
              }
            : undefined
        }
      >
        <item.icon size={14} />
      </span>

      {/* One label in the DOM, not one per breakpoint: two copies hidden by CSS
          make a screen reader announce every row twice. */}
      <span className="min-w-0 lg:flex-1">
        <span className="block truncate text-[12px] leading-tight font-medium">{item.label}</span>
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
              ? { background: `color-mix(in srgb, ${hue} 22%, transparent)`, color: hue }
              : { background: "rgba(255,255,255,0.06)", color: "var(--color-mute-400)" }
          }
        >
          {item.count}
        </span>
      )}
    </button>
  );
}
