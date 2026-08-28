"use client";

/** Small presentational primitives, in the shadcn/ui idiom (cva + a `cn` merge). */

import { cva, type VariantProps } from "class-variance-authority";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/** The status vocabulary every panel shares. */
export type Tone = "pass" | "gate" | "fail" | "skip" | "info" | "neutral";

/**
 * Raw colour per tone, for the SVG strokes and inline gradients that a Tailwind
 * utility class cannot reach.
 */
export const TONE_COLOR: Record<Tone, string> = {
  pass: "var(--color-pass-500)",
  gate: "var(--color-gate-500)",
  fail: "var(--color-fail-500)",
  skip: "var(--color-skip-500)",
  info: "var(--color-brand-500)",
  neutral: "var(--color-mute-400)",
};

export const TONE_TEXT: Record<Tone, string> = {
  pass: "text-pass-500",
  gate: "text-gate-500",
  fail: "text-fail-500",
  skip: "text-skip-500",
  info: "text-brand-400",
  neutral: "text-mute-100",
};

/* ------------------------------------------------------------------ panel --- */

export function Panel({
  title,
  subtitle,
  icon,
  accent = "info",
  actions,
  toolbar,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  accent?: Tone;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "glass-surface glass-d2 panel panel-accent flex min-h-0 flex-col rounded-2xl border border-white/[0.08] shadow-xl backdrop-blur-xl transition-all duration-300",
        className,
      )}
      style={{ "--accent": TONE_COLOR[accent] } as CSSProperties}
    >
      {(title || actions) && (
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span
                className={cn(
                  "mt-0.5 grid size-6.5 shrink-0 place-items-center rounded-lg shadow-sm",
                  TONE_TEXT[accent],
                )}
                style={{
                  background: `color-mix(in srgb, ${TONE_COLOR[accent]} 18%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${TONE_COLOR[accent]} 30%, transparent)`,
                }}
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold tracking-tight text-mute-100">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-0.5 text-[11px] leading-snug text-mute-500">{subtitle}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {toolbar && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.04] bg-white/[0.01] px-4 py-2.5">
          {toolbar}
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- button --- */

const buttonStyles = cva(
  "lift inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 hover:brightness-110 active:scale-[0.98]",
        approve: "bg-pass-500 text-ink-950 shadow-lg shadow-pass-500/25 hover:brightness-110 active:scale-[0.98]",
        reject: "border border-fail-500/60 bg-fail-bg/40 text-fail-500 hover:border-fail-500 hover:bg-fail-bg/80 active:scale-[0.98]",
        ghost:
          "border border-white/10 bg-white/[0.03] text-mute-300 hover:border-white/25 hover:bg-white/[0.08] hover:text-mute-100 active:scale-[0.98]",
        subtle: "bg-white/[0.06] text-mute-200 hover:bg-white/[0.12] active:scale-[0.98]",
      },
      size: {
        sm: "h-7.5 px-3 text-[12px]",
        md: "h-9.5 px-4 text-[13px]",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonStyles>) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

/* ------------------------------------------------------------------ badge --- */

const badgeStyles = cva(
  "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase border",
  {
    variants: {
      tone: {
        pass: "bg-pass-bg/60 border-pass-500/30 text-pass-500 shadow-sm shadow-pass-500/10",
        gate: "bg-gate-bg/60 border-gate-500/30 text-gate-500 shadow-sm shadow-gate-500/10",
        fail: "bg-fail-bg/60 border-fail-500/30 text-fail-500 shadow-sm shadow-fail-500/10",
        skip: "bg-skip-bg/60 border-skip-500/30 text-skip-500",
        info: "bg-brand-glow/60 border-brand-400/30 text-brand-400 shadow-sm shadow-brand-500/10",
        neutral: "bg-white/[0.05] border-white/10 text-mute-300",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

/** Map the domain vocabularies onto the four status colours. */
export function toneForStatus(status: string): Tone {
  switch (status.toLowerCase()) {
    case "pass":
    case "paid":
    case "approved":
    case "auto_approve":
    case "settled":
      return "pass";
    case "gate":
    case "gated":
    case "gate_for_human":
    case "awaiting_human":
    case "awaiting_payment":
    case "pending":
      return "gate";
    case "fail":
    case "failed":
    case "denied":
    case "deny":
    case "error":
      return "fail";
    case "skipped":
    case "abandoned":
    case "expired":
      return "skip";
    default:
      return "neutral";
  }
}

/* --------------------------------------------------------------- count-up --- */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether a tween should be skipped and the end state rendered directly.
 *
 * Two reasons to skip, both subscribed rather than read once:
 *
 * - the visitor asked for reduced motion, and can change that mid-session;
 * - the page is not visible, which suspends `requestAnimationFrame` entirely.
 *   Without this branch a figure that changed while the tab was in the
 *   background would sit at its old value until the tab came forward — the
 *   number would be wrong, not merely un-animated.
 *
 * `false` is the server snapshot. The markup is identical either way; this only
 * gates whether a number is animated on its way to a value it renders anyway.
 */
function useSkipAnimation(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", notify);
      document.addEventListener("visibilitychange", notify);
      return () => {
        query.removeEventListener("change", notify);
        document.removeEventListener("visibilitychange", notify);
      };
    },
    () => window.matchMedia(REDUCED_MOTION).matches || document.hidden,
    () => false,
  );
}

/**
 * A number that eases to its new value instead of jumping to it.
 *
 * Not decoration: on a screen where several figures update from a push stream,
 * a value that moves is a value you notice moving. When the tween is skipped the
 * value is simply rendered.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  duration = 650,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const skip = useSkipAnimation();
  const [display, setDisplay] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    // Kept current either way, so resuming — the tab comes forward, or the
    // preference is turned off — tweens from where the number actually is
    // rather than from a stale one.
    if (skip) {
      current.current = value;
      return;
    }

    const start = current.current;
    if (start === value) return;

    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = start + (value - start) * eased;
      // Kept in a ref as well, so an update mid-flight resumes from where the
      // last one actually got to rather than snapping back.
      current.current = progress < 1 ? next : value;
      setDisplay(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, skip]);

  return <span className={className}>{format(skip ? value : display)}</span>;
}

/* -------------------------------------------------------------- sparkline --- */

/**
 * A bare sparkline: no axes, no labels, just the shape of the last N buckets.
 *
 * `preserveAspectRatio="none"` lets one 100x28 viewBox stretch to whatever width
 * the tile ends up at, so the component never has to measure anything — and
 * `vector-effect` keeps the stroke 1.5px through that stretch.
 */
export function Spark({
  points,
  tone = "info",
  className,
  height = 26,
}: {
  points: number[];
  tone?: Tone;
  className?: string;
  height?: number;
}) {
  const color = TONE_COLOR[tone];
  const gradientId = useId();

  /*
   * An all-zero series is the common case on a quiet dashboard, and plotting it
   * literally draws a full-width bar along the baseline — which reads as a
   * meter pinned at 100%, the opposite of "nothing happened". Flat nothing gets
   * a dashed rule instead.
   */
  const quiet = points.length < 2 || points.every((value) => value === 0);
  if (quiet) {
    return (
      <svg
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
        className={cn("w-full", className)}
        style={{ height }}
        aria-hidden
      >
        <line
          x1="0"
          y1="25"
          x2="100"
          y2="25"
          stroke="rgba(255,255,255,0.13)"
          strokeWidth="1"
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const y = (value: number) => 25 - (value / max) * 23;
  const line = points.map((value, i) => `${i * step},${y(value)}`).join(" ");

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,28 ${line} 100,28`} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------- ring --- */

/** A radial dial. `value` is 0–1. */
export function Ring({
  value,
  size = 44,
  stroke = 4,
  tone = "pass",
  children,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="ring-progress"
        />
      </svg>
      {children && <span className="absolute inset-0 grid place-items-center">{children}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ segment bar --- */

export type Segment = { value: number; tone: Tone; label: string };

/**
 * A stacked proportional bar. Zero-value segments collapse entirely rather than
 * leaving a one-pixel sliver that reads as "there is one of these".
 */
export function SegmentBar({
  segments,
  className,
  height = 6,
}: {
  segments: Segment[];
  className?: string;
  height?: number;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div
      className={cn("flex overflow-hidden rounded-full bg-white/[0.07]", className)}
      style={{ height }}
    >
      {total > 0 &&
        segments.map((segment) => (
          <div
            key={segment.label}
            className="bar-fill h-full"
            title={`${segment.label}: ${segment.value}`}
            style={{
              width: `${(segment.value / total) * 100}%`,
              background: TONE_COLOR[segment.tone],
            }}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------- misc --- */

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-mute-500">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-[15px] font-semibold", TONE_TEXT[tone])}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-mute-500">{hint}</div>}
    </div>
  );
}

/** A dot that breathes, for the one or two things on screen that are genuinely live. */
export function LiveDot({ tone = "pass", active = true }: { tone?: Tone; active?: boolean }) {
  return (
    <span className="relative grid size-1.5 shrink-0 place-items-center">
      {active && (
        <span
          className="animate-ping-ring absolute size-1.5 rounded-full"
          style={{ background: TONE_COLOR[tone] }}
        />
      )}
      <span className="relative size-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
    </span>
  );
}

export function EmptyState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2.5 px-6 text-center">
      {icon && (
        <span className="grid size-9 place-items-center rounded-xl bg-white/[0.04] text-mute-500">
          {icon}
        </span>
      )}
      <p className="max-w-[36ch] text-[13px] leading-relaxed text-mute-500">{children}</p>
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn("font-mono text-[11px] text-mute-400", className)}>{children}</code>;
}
