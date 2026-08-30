import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  textClassName?: string;
}

/**
 * The Vyapaar mark: a rupee held between two brackets.
 *
 * The product's whole argument in one glyph. Brackets read as *bounds* to anyone
 * who has seen a line of code or of maths, and there are deliberately two,
 * because both sides of this counter are bounded — the buyer by a signed mandate,
 * the merchant by a margin floor. The rupee sits between them because money only
 * ever moves inside the guardrails. There is no path around either bracket.
 *
 * The left bracket is drawn heavier. The buy side is the one that has to hold
 * against an untrusted agent, and the asymmetry stops the mark reading as a
 * plain symmetrical container.
 *
 * The rupee is the real U+20B9 glyph rather than a hand-traced path. Tracing it
 * was tried: every version legible at 80px collapsed into a backslash or a blob
 * by 16px, which is the one size a mark genuinely has to survive. A font that
 * ships ₹ has already solved that problem, and every system font has shipped it
 * for over a decade. The stack ends in `sans-serif` so there is no single point
 * of failure.
 */
export function VyapaarLogo({
  className = "",
  size = 32,
  showText = true,
  textClassName = "",
}: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      <div
        className="relative shrink-0 flex items-center justify-center transition-transform duration-300 hover:scale-105"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_2px_10px_rgba(255,183,123,0.3)]"
          role="img"
          aria-label="Vyapaar"
        >
          <defs>
            <linearGradient id="vyapaarMetal" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffd0a8" />
              <stop offset="50%" stopColor="#ffb77b" />
              <stop offset="100%" stopColor="#b16d2e" />
            </linearGradient>
          </defs>

          {/* Left bound — the buyer's mandate. Heavier: it holds against an untrusted agent. */}
          <path
            d="M11.5 6.5 H6.5 V29.5 H11.5"
            stroke="url(#vyapaarMetal)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Right bound — the merchant's margin floor. */}
          <path
            d="M24.5 6.5 H29.5 V29.5 H24.5"
            stroke="url(#vyapaarMetal)"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.75"
          />

          {/* The money, inside the bounds. */}
          <text
            x="18"
            y="25.6"
            textAnchor="middle"
            fontFamily='"Space Grotesk", "Segoe UI", system-ui, -apple-system, sans-serif'
            fontWeight="700"
            fontSize="21"
            fill="url(#vyapaarMetal)"
          >
            &#8377;
          </text>
        </svg>
      </div>

      {showText && <Wordtype className={textClassName} />}
    </div>
  );
}

/** The name itself. Split so the stress lands on the second half, as in speech. */
export function Wordtype({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-mono text-base font-bold tracking-[0.14em] text-[#e5e2e3] transition-colors ${className}`}
    >
      VYA<span className="text-[#ffb77b]">PAAR</span>
    </span>
  );
}

export default VyapaarLogo;
