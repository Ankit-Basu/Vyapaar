import { cn } from "@/lib/utils";
import { VyapaarLogo, Wordtype } from "@/components/logo";

export function Mark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <VyapaarLogo size={size} showText={false} className={className} />
  );
}

/** Mark plus name, for the rail and header. */
export function Wordmark({
  size = 32,
  subtitle = "Control room",
  className,
}: {
  size?: number;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <VyapaarLogo size={size} showText={false} />
      <span className="min-w-0">
        <Wordtype className="!text-[14px] block truncate leading-tight tracking-[0.12em]" />
        {subtitle && (
          <span className="block truncate font-mono text-[10px] leading-tight text-mute-500 uppercase tracking-wider mt-0.5">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}

export default Wordmark;
