/** Small presentational primitives, in the shadcn/ui idiom (cva + a `cn` merge). */

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-xl border border-ink-700 bg-ink-900/70 backdrop-blur",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold tracking-wide text-mute-100">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-mute-500">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
  {
    variants: {
      variant: {
        primary: "bg-brand-500 text-ink-950 hover:bg-brand-400",
        approve: "bg-pass-500 text-ink-950 hover:brightness-110",
        reject: "border border-fail-500/60 text-fail-500 hover:bg-fail-bg",
        ghost: "border border-ink-600 text-mute-300 hover:border-ink-500 hover:text-mute-100",
        subtle: "bg-ink-700 text-mute-200 hover:bg-ink-600",
      },
      size: {
        sm: "h-7 px-2.5 text-[11.5px]",
        md: "h-9 px-3.5 text-[13px]",
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

const badgeStyles = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider",
  {
    variants: {
      tone: {
        pass: "bg-pass-bg text-pass-500",
        gate: "bg-gate-bg text-gate-500",
        fail: "bg-fail-bg text-fail-500",
        skip: "bg-skip-bg text-skip-500",
        info: "bg-brand-glow text-brand-400",
        neutral: "bg-ink-700 text-mute-400",
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
export function toneForStatus(
  status: string,
): "pass" | "gate" | "fail" | "skip" | "info" | "neutral" {
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

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "pass" | "fail" | "gate" | "neutral";
}) {
  const valueTone = {
    pass: "text-pass-500",
    fail: "text-fail-500",
    gate: "text-gate-500",
    neutral: "text-mute-100",
  }[tone];
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-mute-500">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-[15px] font-semibold", valueTone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-mute-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center px-6 text-center text-[12.5px] leading-relaxed text-mute-500">
      {children}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn("font-mono text-[11px] text-mute-400", className)}>{children}</code>
  );
}
