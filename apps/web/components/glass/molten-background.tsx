"use client";

import MoltenMetal from "./MoltenMetal";

type Props = {
  opacity?: number;
  speed?: number;
  scale?: number;
  mouseStrength?: number;
  /**
   * Run the WebGL field at all.
   *
   * Off keeps the ground and the vignette but skips the shader — which is what
   * a page wants when its hero is already a full-screen canvas. A WebGL loop
   * behind an opaque surface renders frames nobody can see and is the first
   * thing to cost you smooth scrolling.
   */
  shader?: boolean;
  className?: string;
};

export function MoltenBackground({
  opacity = 1,
  speed = 0.35,
  scale = 3.8,
  mouseStrength = 0.35,
  shader = true,
  className,
}: Props) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className || ""}`}
      style={shader ? undefined : { background: "#05070f" }}
      aria-hidden
    >
      {shader && (
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
      )}
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
