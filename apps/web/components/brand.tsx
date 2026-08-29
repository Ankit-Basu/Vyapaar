import { cn } from "@/lib/utils";

/**
 * The mark: a rupee inside a shield.
 *
 * The old one was a ₹ glyph on a gradient square — the same rounded-square-with
 * a-letter every dashboard has. This says what the product is in one shape:
 * money that is guarded. The notch cut into the shield's shoulder is the human
 * gate, the one place the boundary deliberately opens.
 *
 * Drawn rather than typeset, so it holds up at 20px in a rail and at 40px in a
 * header, and inherits the theme through `currentColor` on the ground.
 */
export function Mark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center rounded-[30%] shadow-lg",
        className,
      )}
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(150deg, var(--color-brand-400), var(--color-brand-500) 45%, var(--color-violet-500))",
        boxShadow:
          "inset 0 1px 0 0 rgba(255,255,255,0.35), 0 6px 18px -6px color-mix(in srgb, var(--color-brand-500) 55%, transparent)",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        {/* The shield, with the gate notched out of its upper right shoulder. */}
        <path
          d="M12 2.6 4.9 5.4v6.1c0 4.4 3 8.1 7.1 9.4 4.1-1.3 7.1-5 7.1-9.4V8.9"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        {/* The rupee, struck into the middle of the guarded area. */}
        <path
          d="M9.4 7.6h5.2M9.4 10h5.2M13 7.6c1.2 0 2 .9 2 2s-.8 2.4-2.6 2.4H9.4l4.1 4.4"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Mark plus name, for the rail and the landing nav. */
export function Wordmark({
  size = 36,
  subtitle = "Control room",
  className,
}: {
  size?: number;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <Mark size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] leading-tight font-semibold tracking-tight text-mute-100">
          AgentMandi
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] leading-tight text-mute-500">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
