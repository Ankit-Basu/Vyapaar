"use client";

import MoltenMetal from "./MoltenMetal";

type Props = {
  opacity?: number;
  speed?: number;
  scale?: number;
  mouseStrength?: number;
  className?: string;
};

export function MoltenBackground({
  opacity = 1,
  speed = 0.35,
  scale = 3.8,
  mouseStrength = 0.35,
  className,
}: Props) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className || ""}`}
      aria-hidden
    >
      <MoltenMetal
        color1="#5227FF"
        color2="#FF9FFC"
        color3="#FFFFFF"
        speed={speed}
        scale={scale}
        detail={3}
        glow={1.8}
        coreSize={0.1}
        swirl={1}
        fold={-0.2}
        blackPoint={0.04}
        brightness={1.35}
        colorMode="molten"
        grain
        grainIntensity={0.04}
        mouseInteraction
        mouseStrength={mouseStrength}
        opacity={opacity}
        backgroundColor="#05070f"
      />
      {/* Subtle vignette / gradient overlay to ensure perfect contrast for text */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 30%, transparent 20%, rgba(5, 7, 15, 0.45) 75%, rgba(5, 7, 15, 0.85) 100%)",
        }}
      />
    </div>
  );
}

export default MoltenBackground;
