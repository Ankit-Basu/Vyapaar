"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The mandate, as a pressed seal.
 *
 * Consent happens exactly once and then binds every purchase after it, so it
 * should leave a physical artifact rather than a status string. The scope is
 * struck into the metal: caps, budget, categories, expiry — the four bounds the
 * server actually enforces.
 *
 * Three states, and they are the whole tamper story told without prose:
 *
 * - `signed`   — struck, with a glint travelling across it
 * - `unsigned` — the die is there, nothing pressed into it yet
 * - `broken`   — the cap was edited and re-signed with the wrong key, so
 *                verification fails before a single bound is even consulted.
 *                The seal desaturates and cracks.
 */
export function Seal({
  state = "signed",
  size = 208,
  scope = SCOPE,
  className,
}: {
  state?: "signed" | "unsigned" | "broken";
  size?: number;
  scope?: readonly string[];
  className?: string;
}) {
  const id = useId();
  const ringText = "AGENTMANDI · MANDATE · HS256 · ";

  return (
    <div
      className={cn("relative shrink-0", state === "broken" && "st-seal--broken", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        state === "broken"
          ? "Mandate seal, broken: the signature no longer verifies"
          : state === "unsigned"
            ? "Mandate seal, not yet signed"
            : `Mandate seal, signed. Scope: ${scope.join("; ")}`
      }
    >
      <div className="st-seal absolute inset-0">
        {/* The rim legend, following the circumference. */}
        <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <path
              id={`${id}-ring`}
              d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"
              fill="none"
            />
          </defs>
          <text
            className="st-numeric"
            fill="rgba(11,12,16,0.55)"
            fontSize="9.5"
            letterSpacing="2.6"
          >
            <textPath href={`#${id}-ring`}>{ringText.repeat(2)}</textPath>
          </text>
        </svg>

        {/* The well the scope is struck into. */}
        <div className="st-seal-well absolute inset-[17%] flex flex-col items-center justify-center gap-[3%] px-[9%] text-center">
          {state === "unsigned" ? (
            <span
              className="st-numeric text-[0.6rem] tracking-[0.18em] uppercase"
              style={{ color: "rgba(11,12,16,0.5)" }}
            >
              unsigned
            </span>
          ) : (
            <>
              <span
                className="st-numeric text-[0.5rem] tracking-[0.2em] uppercase"
                style={{ color: "rgba(11,12,16,0.5)" }}
              >
                {state === "broken" ? "void" : "signed"}
              </span>
              {scope.map((line) => (
                <span
                  key={line}
                  className="st-numeric text-[0.6rem] leading-tight font-semibold"
                  style={{ color: "rgba(11,12,16,0.82)" }}
                >
                  {line}
                </span>
              ))}
            </>
          )}
        </div>

        {/* The crack, drawn over the metal rather than filtered into it. */}
        {state === "broken" && (
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden>
            <path
              d="M96 6 L108 62 L84 92 L114 118 L92 152 L106 194"
              fill="none"
              stroke="rgba(11,12,16,0.62)"
              strokeWidth="3.5"
              strokeLinejoin="round"
            />
            <path
              d="M96 6 L108 62 L84 92 L114 118 L92 152 L106 194"
              fill="none"
              stroke="rgba(255,255,255,0.34)"
              strokeWidth="1.1"
              strokeLinejoin="round"
              transform="translate(1.5,1.5)"
            />
          </svg>
        )}
      </div>

      {/* The glint only belongs on a seal that actually verifies. */}
      {state === "signed" && (
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          aria-hidden
        >
          <span className="st-seal-glint absolute inset-y-[-30%] left-0 w-[28%]" />
        </span>
      )}
    </div>
  );
}

const SCOPE = [
  "₹3,000 / purchase",
  "₹10,000 budget",
  "electronics · office",
  "24 hours",
] as const;
