import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  textClassName?: string;
}

export function AgentMandiLogo({
  className = "",
  size = 32,
  showText = true,
  textClassName = "",
}: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Standalone Precision Cryptographic Rupee Shield */}
      <div
        className="relative shrink-0 flex items-center justify-center transition-transform duration-300 hover:scale-105"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_2px_10px_rgba(255,183,123,0.35)]"
        >
          <defs>
            {/* Primary Amber-Gold Metal Gradient */}
            <linearGradient id="amberGoldMetal" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffd0a8" />
              <stop offset="45%" stopColor="#ffb77b" />
              <stop offset="100%" stopColor="#b16d2e" />
            </linearGradient>

            {/* Left Facet Gradient */}
            <linearGradient id="shieldFacetLeft" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffb77b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#141416" stopOpacity="0.9" />
            </linearGradient>

            {/* Right Facet Gradient */}
            <linearGradient id="shieldFacetRight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffd0a8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#b16d2e" stopOpacity="0.18" />
            </linearGradient>
          </defs>

          {/* Left Facet of Shield */}
          <path
            d="M18 3 L5.5 8 V18.5 C5.5 26 11.5 31.5 18 33.5 V3 Z"
            fill="url(#shieldFacetLeft)"
          />

          {/* Right Facet of Shield */}
          <path
            d="M18 3 L30.5 8 V18.5 C30.5 26 24.5 31.5 18 33.5 V3 Z"
            fill="url(#shieldFacetRight)"
          />

          {/* Outer Shield Contour */}
          <path
            d="M18 3 L30.5 8 V18.5 C30.5 26 24.5 31.5 18 33.5 C11.5 31.5 5.5 26 5.5 18.5 V8 L18 3 Z"
            stroke="url(#amberGoldMetal)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Center Dividing Spine */}
          <path
            d="M18 3 V33.5"
            stroke="url(#amberGoldMetal)"
            strokeWidth="0.8"
            strokeOpacity="0.35"
          />

          {/* Official Indian Rupee (₹) Symbol Elements */}
          {/* Top Horizon Bar */}
          <rect
            x="9.5"
            y="7.5"
            width="17"
            height="2.2"
            rx="1.1"
            fill="url(#amberGoldMetal)"
          />

          {/* Second Parallel Horizon Bar */}
          <rect
            x="9.5"
            y="12.5"
            width="12"
            height="2.2"
            rx="1.1"
            fill="url(#amberGoldMetal)"
          />

          {/* Vertical Stem */}
          <rect
            x="13.4"
            y="7.5"
            width="2.2"
            height="6.5"
            fill="url(#amberGoldMetal)"
          />

          {/* Devanagari 'Ra' Loop */}
          <path
            d="M14.5 13.5 C19.5 13.5 22.5 15.2 22.5 18 C22.5 20.8 19.5 22.5 14.5 22.5"
            stroke="url(#amberGoldMetal)"
            strokeWidth="2.2"
            strokeLinecap="round"
            fill="none"
          />

          {/* Diagonal Slash Leg */}
          <path
            d="M16 22.5 L24 30"
            stroke="url(#amberGoldMetal)"
            strokeWidth="2.2"
            strokeLinecap="round"
          />

          {/* Glowing Apex Node */}
          <circle cx="18" cy="3" r="1.1" fill="#ffd0a8" />
        </svg>
      </div>

      {showText && (
        <span
          className={`font-mono text-base font-bold tracking-[0.14em] text-[#e5e2e3] transition-colors ${textClassName}`}
        >
          AGENT<span className="text-[#ffb77b]">MANDI</span>
        </span>
      )}
    </div>
  );
}

export default AgentMandiLogo;
