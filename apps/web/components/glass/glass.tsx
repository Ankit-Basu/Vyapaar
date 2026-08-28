"use client";

import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Elevation. Not a style knob — a budget.
 *
 * 0 is the same material with no `backdrop-filter`, and it is what nested glass
 * must use: the parent has already blurred the backdrop, so a child blur
 * re-blurs an almost-uniform image for a full extra compositing pass. Every
 * other level costs one blurred layer, so a screen's blur count is just the
 * number of depth 1–3 surfaces on it.
 */
export type Depth = 0 | 1 | 2 | 3;

/*
 * Depth 2 is the base material, so it needs no modifier. The others layer on
 * top of `.glass-surface` rather than replacing it — replacing it silently
 * dropped the border and shadow from every non-default surface.
 */
const DEPTH_MODIFIER: Record<Depth, string | null> = {
  0: "glass-d0",
  1: "glass-d1",
  2: null,
  3: "glass-d3",
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Subscribed rather than read once, so toggling the OS setting takes effect. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * A specular highlight that tracks the pointer across a surface.
 *
 * Writes CSS custom properties instead of setting state: a sheen that re-rendered
 * React on every pointermove would be the most expensive thing on a dashboard
 * that already streams events. Coalesced into one `requestAnimationFrame` so a
 * burst of moves paints once.
 */
export function useSpecularSheen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const frame = useRef(0);
  const reduced = usePrefersReducedMotion();

  const onPointerMove = useCallback(
    (event: React.PointerEvent<T>) => {
      if (reduced) return;
      const node = ref.current;
      if (!node) return;

      const { clientX, clientY } = event;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const box = node.getBoundingClientRect();
        node.style.setProperty("--sheen-x", `${((clientX - box.left) / box.width) * 100}%`);
        node.style.setProperty("--sheen-y", `${((clientY - box.top) / box.height) * 100}%`);
        node.style.setProperty("--sheen-o", "1");
      });
    },
    [reduced],
  );

  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    ref.current?.style.setProperty("--sheen-o", "0");
  }, []);

  return { ref, sheenProps: { onPointerMove, onPointerLeave }, enabled: !reduced };
}

/**
 * A pane of glass.
 *
 * Fill, hairline border, specular top edge and ambient shadow always travel
 * together — guardrail 2 exists because dropping any single one of them is what
 * turns the material back into a grey box, so none of them is optional here.
 */
export function Glass<E extends ElementType = "div">({
  as,
  depth = 2,
  sheen = false,
  className,
  style,
  children,
  ...rest
}: {
  as?: E;
  depth?: Depth;
  /** Pointer-tracking highlight. For interactive surfaces only. */
  sheen?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<E>, "as" | "style" | "className" | "children">) {
  const Tag = (as ?? "div") as ElementType;
  const { ref, sheenProps } = useSpecularSheen<HTMLDivElement>();

  return (
    <Tag
      ref={sheen ? ref : undefined}
      className={cn(
        "glass-surface glass-specular-edge rounded-2xl",
        DEPTH_MODIFIER[depth],
        sheen && "glass-sheen",
        className,
      )}
      style={style}
      {...(sheen ? sheenProps : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}
