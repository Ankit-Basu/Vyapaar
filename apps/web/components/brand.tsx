import { cn } from "@/lib/utils";
import { AgentMandiLogo } from "@/components/logo";

export function Mark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <AgentMandiLogo size={size} showText={false} className={className} />
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
      <AgentMandiLogo size={size} showText={false} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] leading-tight font-mono font-bold tracking-[0.12em] text-[#e5e2e3]">
          AGENT<span className="text-[#ffb77b]">MANDI</span>
        </span>
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
