"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useSpecularSheen } from "@/components/glass/glass";

/* ================================================================= button === */

const glassButton = cva(
  "u-focus-ring glass-specular-edge relative inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[transform,background-color,border-color] duration-200 ease-[var(--ease-glass)] disabled:pointer-events-none disabled:opacity-45 active:translate-y-0",
  {
    variants: {
      variant: {
        /*
         * The one bright surface on a page. Solid rather than glass on purpose:
         * the primary action should read as the thing in front of the glass,
         * not another pane among panes.
         */
        primary:
          "bg-accent text-canvas shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--color-accent)_60%,transparent)] hover:-translate-y-px hover:bg-accent-hover",
        /* Default interactive glass. */
        glass:
          "glass-surface glass-d1 glass-sheen text-heading hover:-translate-y-px hover:border-[var(--glass-edge-strong)]",
        /* For destructive or negative actions; the hue is the meaning. */
        denied:
          "border border-[color-mix(in_srgb,var(--color-denied)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-denied)_12%,transparent)] text-denied-text hover:bg-[color-mix(in_srgb,var(--color-denied)_20%,transparent)]",
        approve:
          "border border-[color-mix(in_srgb,var(--color-approve)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-approve)_12%,transparent)] text-approve-text hover:bg-[color-mix(in_srgb,var(--color-approve)_20%,transparent)]",
        ghost: "text-body hover:bg-white/[0.06] hover:text-heading",
      },
      size: {
        sm: "h-8 px-3 text-[0.75rem]",
        md: "h-10 px-4 text-[0.8125rem]",
        lg: "h-12 px-6 text-[0.875rem]",
      },
    },
    defaultVariants: { variant: "glass", size: "md" },
  },
);

export function GlassButton({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof glassButton>) {
  const { ref, sheenProps } = useSpecularSheen<HTMLButtonElement>();
  const tracksPointer = variant === "glass" || variant == null;

  return (
    <button
      ref={tracksPointer ? ref : undefined}
      className={cn(glassButton({ variant, size }), className)}
      {...(tracksPointer ? sheenProps : {})}
      {...props}
    />
  );
}

/* =================================================================== pill === */

export type Status = "approve" | "gated" | "denied" | "skipped" | "neutral";

const STATUS_HUE: Record<Status, string> = {
  approve: "var(--color-approve)",
  gated: "var(--color-gated)",
  denied: "var(--color-denied)",
  skipped: "var(--color-skipped)",
  neutral: "var(--color-accent)",
};

const STATUS_TEXT: Record<Status, string> = {
  approve: "text-approve-text",
  gated: "text-gated-text",
  denied: "text-denied-text",
  skipped: "text-skipped-text",
  neutral: "text-accent-text",
};

/**
 * A status pill.
 *
 * The dot is the status, the word is the status, and the tint is the status —
 * three redundant encodings, because colour alone fails anyone who cannot
 * distinguish these hues. `role="status"` and the label make it legible to a
 * screen reader too.
 */
export function GlassPill({
  status = "neutral",
  pulse = false,
  children,
  className,
  label,
}: {
  status?: Status;
  /** For live states only — a pulsing dot should mean something is happening. */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const hue = STATUS_HUE[status];

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "glass-specular-edge inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide",
        STATUS_TEXT[status],
        className,
      )}
      style={{
        borderColor: `color-mix(in srgb, ${hue} 34%, transparent)`,
        background: `color-mix(in srgb, ${hue} 12%, transparent)`,
        boxShadow: `inset 0 1px 0 0 var(--glass-specular)`,
      }}
    >
      <span className="relative grid size-1.5 shrink-0 place-items-center">
        {pulse && (
          <span
            className="absolute size-1.5 animate-ping rounded-full opacity-60"
            style={{ background: hue }}
          />
        )}
        <span className="relative size-1.5 rounded-full" style={{ background: hue }} />
      </span>
      {children}
    </span>
  );
}

/* ================================================================== input === */

/**
 * A glass input.
 *
 * The field itself is a solid dark well rather than another blurred pane:
 * text you are actively typing should not sit on a moving backdrop, and a
 * nested blur here would cost a compositing layer to make the value harder to
 * read.
 */
export function GlassInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "u-focus-ring h-10 w-full rounded-xl border border-[var(--glass-edge)] bg-[color-mix(in_srgb,var(--color-canvas)_70%,transparent)] px-3.5 text-[0.8125rem] text-heading",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-colors duration-200",
        "placeholder:text-caption hover:border-[var(--glass-edge-strong)]",
        "focus:border-[color-mix(in_srgb,var(--color-accent)_70%,transparent)] focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/* ============================================================== segmented === */

/** Glass segmented control — the shape the audit-trail filters will take. */
export function GlassSegmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "glass-surface glass-d0 glass-specular-edge inline-flex gap-0.5 rounded-xl p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "u-focus-ring rounded-lg px-3 py-1.5 text-[0.75rem] font-medium transition-colors duration-200",
              active
                ? "bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] text-heading shadow-[inset_0_1px_0_0_var(--glass-specular)]"
                : "text-caption hover:bg-white/[0.05] hover:text-body",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
