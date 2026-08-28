"use client";

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/* =================================================================== room === */

/**
 * The lit room every other material is seen inside.
 *
 * One key light from the upper left, one weak cool bounce from the lower
 * right. That single direction is what the specular edge on every pane is
 * consistent with — the previous four-blob aurora had no light direction at
 * all, which is why the surfaces in front of it read as coloured rectangles
 * rather than as glass.
 */
export function Studio() {
  return (
    <>
      <div className="studio-room" aria-hidden>
        <div className="studio-key" />
      </div>
      <div className="studio-grain" aria-hidden />
    </>
  );
}

/* ================================================================== glass === */

/**
 * A pane of glass.
 *
 * `depth` is elevation, not decoration: 1 for chrome that sits almost on the
 * ground, 2 for content panes, 3 for things that float above everything.
 * Higher depth means more blur, a brighter top edge and a longer shadow —
 * which is what elevation actually looks like under a fixed light.
 */
export function Glass({
  depth = 2,
  refract = true,
  className,
  children,
  style,
  as: Tag = "div",
}: {
  depth?: 1 | 2 | 3;
  /** The inner refraction hairline. Off for very small surfaces, where it reads as a smudge. */
  refract?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  as?: "div" | "section" | "header" | "aside" | "li";
}) {
  return (
    <Tag
      className={cn(
        depth === 1 && "st-glass st-glass-1",
        depth === 2 && "st-glass",
        depth === 3 && "st-glass st-glass-3",
        refract && "st-refract",
        className,
      )}
      style={style}
    >
      {children}
    </Tag>
  );
}

/* ================================================================== metal === */

/**
 * Struck platinum, for money and for the one primary action.
 *
 * Text on metal is the canvas colour, not the heading colour. Measured against
 * the mid tone, `#F5F6F8` is 1.76:1 and the canvas is 10.30:1 — white on metal
 * is unreadable, so the component does not offer it.
 */
export function Metal({
  as = "span",
  className,
  children,
  ...rest
}: {
  as?: "span" | "button" | "a" | "div";
  className?: string;
  children?: ReactNode;
} & Record<string, unknown>) {
  const Tag = as as "span";
  return (
    <Tag className={cn("st-metal st-focus", className)} {...rest}>
      {/* Above the specular sweep, which is a sibling pseudo-element. */}
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </Tag>
  );
}

/** Money, struck rather than printed. Tabular so columns of it align. */
export function Money({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("st-metal-text st-numeric", className)}>{children}</span>;
}

/* ============================================================== controls === */

const STATUS = {
  pass: { hue: "var(--color-st-pass)", label: "passed" },
  gate: { hue: "var(--color-st-gate)", label: "held for a human" },
  deny: { hue: "var(--color-st-deny)", label: "denied" },
  live: { hue: "var(--color-st-accent)", label: "live" },
  idle: { hue: "var(--color-st-caption)", label: "idle" },
} as const;

export type StatusKind = keyof typeof STATUS;

/**
 * A status pill.
 *
 * The three meaning-bearing hues are fixed across everything — no theme, mode
 * or preference re-tints them, because a denial that looks different depending
 * on a display setting is a denial that lies.
 */
export function StatusPill({
  kind,
  children,
  pulse = false,
  className,
}: {
  kind: StatusKind;
  children: ReactNode;
  /** For genuinely live state only. */
  pulse?: boolean;
  className?: string;
}) {
  const { hue, label } = STATUS[kind];
  return (
    <span
      className={cn(
        "st-glass-1 st-numeric inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem]",
        className,
      )}
      style={{
        borderColor: `color-mix(in srgb, ${hue} 36%, transparent)`,
        color: hue,
      }}
    >
      <span className="relative grid size-1.5 place-items-center">
        {pulse && (
          <span
            className="absolute size-1.5 animate-ping rounded-full"
            style={{ background: hue }}
          />
        )}
        <span className="relative size-1.5 rounded-full" style={{ background: hue }} />
      </span>
      {children}
      <span className="sr-only"> — {label}</span>
    </span>
  );
}

/** A glass button. The primary action uses `<Metal>` instead. */
export function GlassButton({
  className,
  children,
  ...rest
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "st-glass st-glass-1 st-focus inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[0.8125rem] font-medium text-st-heading transition-[background-color,border-color] hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GlassInput({ className, ...rest }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "st-glass st-glass-1 st-focus h-10 rounded-xl px-3.5 text-[0.8125rem] text-st-heading placeholder:text-st-caption",
        className,
      )}
      {...rest}
    />
  );
}
