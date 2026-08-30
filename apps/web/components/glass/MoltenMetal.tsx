"use client";

import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import "./MoltenMetal.css";

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
};

const colorModeToFloat = (mode: string) => (mode === "ember" ? 1 : mode === "frost" ? 2 : 0);

function readThemeColors(fallbackColor1 = "#5227FF", fallbackColor2 = "#FF9FFC", fallbackColor3 = "#FFFFFF", fallbackBg = "#05070f") {
  if (typeof window === "undefined") {
    return {
      c1: fallbackColor1,
      c2: fallbackColor2,
      c3: fallbackColor3,
      bg: fallbackBg,
    };
  }
  const s = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    c1: pick("--shader-1", fallbackColor1),
    c2: pick("--shader-2", fallbackColor2),
    c3: pick("--shader-3", fallbackColor3),
    bg: pick("--color-canvas", fallbackBg),
  };
}

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uColorMode;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uBackgroundColor;
uniform bool uLightMode;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

  vec2 drift = vec2(0.0);
  if (uEnableMouse) {
    drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  }
  p += drift;

  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;

  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
  }

  c /= 6.0;

  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;

  float g = clamp(intensity, 0.0, 1.0);

  float mid = 0.5;
  if (uColorMode > 1.5) {
    mid = 0.65;
  } else if (uColorMode > 0.5) {
    mid = 0.35;
  }

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
  col = mix(col, uColor3, smoothstep(mid, 1.0, g));

  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;
  if (uLightMode) {
    float signal = 1.0 - exp(-max(c, 0.0) * 6.5);
    float body = smoothstep(0.075, 0.68, signal);
    float ridge = smoothstep(0.42, 0.92, signal);

    vec3 lightCol = mix(uColor1, uColor2, smoothstep(0.08, 0.52, signal));
    lightCol = mix(lightCol, uColor3, smoothstep(0.52, 0.96, signal));
    lightCol = mix(lightCol, lightCol * 0.72, ridge * 0.24);

    float coverage = body * mix(0.2, 0.86, signal) * uOpacity;
    if (uGrain > 0.5) {
      float gr = hash(gl_FragCoord.xy + iTime);
      coverage += (gr - 0.5) * uGrainIntensity * body * 0.16;
    }
    fragColor = vec4(mix(uBackgroundColor, lightCol, clamp(coverage, 0.0, 0.92)), 1.0);
  } else {
    // Render dynamic caustics over the theme's background canvas
    vec3 mixedColor = mix(uBackgroundColor, col, smoothstep(0.0, 0.85, a));
    fragColor = vec4(mixedColor, 1.0);
  }
}
`;

interface ContextValue {
  renderer: Renderer;
  program: Program;
  mesh: Mesh;
}

const ctxMap = new WeakMap<HTMLDivElement, ContextValue>();

export interface MoltenMetalProps {
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  scale?: number;
  detail?: number;
  /**
   * Device-pixel ratio ceiling for the render target.
   *
   * Fragment cost is quadratic in this. The hero wants 2 because it is the
   * subject; a background sitting at 40% opacity behind a vignette and a pane of
   * frosted glass does not — at that point 1 is indistinguishable and costs a
   * quarter as much per frame.
   */
  dpr?: number;
  /**
   * Cap the field's frame rate. 0 leaves it uncapped.
   *
   * This is the single biggest lever when the field sits *behind* glass. Every
   * frame it repaints invalidates every `backdrop-filter` in front of it, and a
   * dense screen can easily carry more blurred area than it has viewport. The
   * field itself drifts slowly enough that 20fps is indistinguishable from 60 —
   * so the cap buys back two thirds of that compositing work for nothing.
   */
  fps?: number;
  glow?: number;
  coreSize?: number;
  swirl?: number;
  fold?: number;
  blackPoint?: number;
  brightness?: number;
  colorMode?: "molten" | "ember" | "frost" | string;
  grain?: boolean;
  grainIntensity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  opacity?: number;
  backgroundColor?: string;
  lightMode?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function MoltenMetal({
  color1 = "#5227FF",
  color2 = "#FF9FFC",
  color3 = "#FFFFFF",
  speed = 0.35,
  scale = 4,
  detail = 3,
  dpr = 2,
  fps = 0,
  glow = 1.6,
  coreSize = 0.1,
  swirl = 1,
  fold = -0.2,
  blackPoint = 0.05,
  brightness = 1.3,
  colorMode = "molten",
  grain = true,
  grainIntensity = 0.05,
  mouseInteraction = true,
  mouseStrength = 0.3,
  opacity = 1.0,
  backgroundColor = "#05070d",
  lightMode = false,
  className = "",
  style,
}: MoltenMetalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, dpr),
      });
    } catch {
      return;
    }

    const gl = renderer.gl;
    if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) {
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const initialTheme = readThemeColors(color1, color2, color3, backgroundColor);
    const c1 = hexToRgb(initialTheme.c1);
    const c2 = hexToRgb(initialTheme.c2);
    const c3 = hexToRgb(initialTheme.c3);
    const bg = hexToRgb(initialTheme.bg);

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: speed },
        uScale: { value: scale },
        uDetail: { value: detail },
        uGlow: { value: glow },
        uCoreSize: { value: Math.max(coreSize, 0.001) },
        uSwirl: { value: swirl },
        uFold: { value: fold },
        uBlackPoint: { value: blackPoint },
        uBrightness: { value: brightness },
        uColorMode: { value: colorModeToFloat(colorMode) },
        uGrain: { value: grain ? 1 : 0 },
        uGrainIntensity: { value: grainIntensity },
        uOpacity: { value: opacity },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: mouseStrength },
        uEnableMouse: { value: mouseInteraction },
        uColor1: { value: new Float32Array(c1) },
        uColor2: { value: new Float32Array(c2) },
        uColor3: { value: new Float32Array(c3) },
        uBackgroundColor: { value: new Float32Array(bg) },
        uLightMode: { value: lightMode },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctxMap.set(container, { renderer, program, mesh });

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const res = program.uniforms.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    // Listen to theme changes in the document element
    const updateColorsFromTheme = () => {
      const themeColors = readThemeColors(color1, color2, color3, backgroundColor);
      const tc1 = hexToRgb(themeColors.c1);
      const tc2 = hexToRgb(themeColors.c2);
      const tc3 = hexToRgb(themeColors.c3);
      const tbg = hexToRgb(themeColors.bg);

      const u = program.uniforms;
      (u.uColor1.value as Float32Array)[0] = tc1[0];
      (u.uColor1.value as Float32Array)[1] = tc1[1];
      (u.uColor1.value as Float32Array)[2] = tc1[2];

      (u.uColor2.value as Float32Array)[0] = tc2[0];
      (u.uColor2.value as Float32Array)[1] = tc2[1];
      (u.uColor2.value as Float32Array)[2] = tc2[2];

      (u.uColor3.value as Float32Array)[0] = tc3[0];
      (u.uColor3.value as Float32Array)[1] = tc3[1];
      (u.uColor3.value as Float32Array)[2] = tc3[2];

      (u.uBackgroundColor.value as Float32Array)[0] = tbg[0];
      (u.uBackgroundColor.value as Float32Array)[1] = tbg[1];
      (u.uBackgroundColor.value as Float32Array)[2] = tbg[2];

      renderer.render({ scene: mesh });
    };

    const themeObserver = new MutationObserver(updateColorsFromTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const targetMouse = [0.5, 0.5];
    const currentMouse = [0.5, 0.5];

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      targetMouse[0] = (e.clientX - rect.left) / rect.width;
      targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
    };
    const handleMouseLeave = () => {
      targetMouse[0] = 0.5;
      targetMouse[1] = 0.5;
    };
    // Only listen when the shader will actually use it. The uniform was already
    // gated on `mouseInteraction`, but the listeners were not -- so a background
    // that ignores the pointer was still doing a getBoundingClientRect on every
    // mousemove across the whole window.
    if (mouseInteraction) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("mouseleave", handleMouseLeave);
    }

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();

    const minFrameMs = fps > 0 ? 1000 / fps : 0;
    let lastRender = 0;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // The rAF keeps ticking so the cap stays aligned to the compositor's
      // rhythm; what is skipped is the draw, and with it every backdrop-filter
      // recomputation that a repaint of the backdrop would have forced.
      if (minFrameMs && t - lastRender < minFrameMs) return;
      lastRender = t;

      program.uniforms.iTime.value = (t - t0) * 0.001;
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      const m = program.uniforms.uMouse.value as Float32Array;
      m[0] = currentMouse[0];
      m[1] = currentMouse[1];
      renderer.render({ scene: mesh });
    };

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) tryStart();
        else tryStop();
      },
      { threshold: 0 }
    );
    io.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) tryStart();
      else tryStop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryStart();

    return () => {
      tryStop();
      ro.disconnect();
      io.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (mouseInteraction) {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseleave", handleMouseLeave);
      }
      ctxMap.delete(container);
      if (canvas.parentNode === container) container.removeChild(canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    /*
     * Deliberately empty: this effect builds the WebGL context, and listing the
     * props would tear it down and rebuild it on every prop change. The second
     * effect below pushes prop updates into the existing uniforms instead,
     * which is the whole reason the two are split.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={`molten-metal-container ${className}`.trim()}
      style={style}
    />
  );
}
export { MoltenMetal };
