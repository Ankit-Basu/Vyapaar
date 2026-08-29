"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A decoded frame is either an ImageBitmap (fast path) or an <img> fallback. */
type Frame =
  | { kind: "bitmap"; img: ImageBitmap }
  | { kind: "element"; img: HTMLImageElement; url: string };

/**
 * Decode a WebP blob into something ctx.drawImage can use.
 * createImageBitmap is the fast, off-main-thread path — but it can throw
 * "The source image could not be decoded" in backgrounded/hidden tabs and
 * some embedded webviews. When it does, fall back to a plain HTMLImageElement,
 * which decodes reliably everywhere. Both are valid drawImage sources.
 */
async function decodeBlob(blob: Blob): Promise<Frame> {
  try {
    const img = await createImageBitmap(blob);
    return { kind: "bitmap", img };
  } catch {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img decode failed"));
      img.src = url;
    });
    return { kind: "element", img, url };
  }
}

function releaseFrame(f: Frame) {
  if (f.kind === "bitmap") f.img.close();
  else URL.revokeObjectURL(f.url);
}

/**
 * Loads a WebP frame sequence (public/frames/<name>/) and exposes a
 * draw(canvas, progress) scrubber.
 *
 * Memory strategy: compressed blobs stay resident (a few MB), decoded
 * frames live only in a sliding window around the playhead so scrubbing
 * stays 60fps without holding hundreds of MB of pixels.
 */
export function useFrameSequence(name: string) {
  const blobs = useRef<(Blob | null)[]>([]);
  const frames = useRef<Map<number, Frame>>(new Map());
  const decoding = useRef<Set<number>>(new Set());
  const countRef = useRef(0);
  const lastProgress = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // Captured for the cleanup: reading `frames.current` there would read
    // whatever the ref points at on unmount rather than what this effect filled.
    const decoded = frames.current;
    (async () => {
      /*
       * Root-absolute, not relative. A relative fetch resolves against the
       * current route, so on any nested page it asks for
       * `/<route>/frames/...` and 404s — which left the canvas at zero size
       * and the film invisible the first time this ran off the root.
       */
      const m = await fetch(`/frames/${name}/manifest.json`).then((r) => r.json());
      if (!alive) return;
      countRef.current = m.count;
      blobs.current = new Array(m.count).fill(null);
      const url = (i: number) =>
        m.pattern.replace("%03d", String(i + 1).padStart(3, "0"));

      // fetch all compressed frames (small), decode only frame 0 up front
      await Promise.all(
        Array.from({ length: m.count }, async (_, i) => {
          try {
            const b = await fetch(url(i)).then((r) => r.blob());
            if (alive) blobs.current[i] = b;
          } catch {
            /* refetched implicitly on next visit */
          }
        })
      );
      if (!alive) return;
      if (blobs.current[0]) {
        try {
          const f = await decodeBlob(blobs.current[0]);
          if (!alive) return releaseFrame(f);
          frames.current.set(0, f);
        } catch {
          /* first frame will be retried by the draw loop */
        }
      }
      setReady(true);
    })();
    return () => {
      alive = false;
      decoded.forEach(releaseFrame);
      decoded.clear();
    };
  }, [name]);

  const decode = useCallback((i: number) => {
    if (frames.current.has(i) || decoding.current.has(i) || !blobs.current[i]) return;
    decoding.current.add(i);
    decodeBlob(blobs.current[i]!)
      .then((f) => frames.current.set(i, f))
      .catch(() => {})
      .finally(() => decoding.current.delete(i));
  }, []);

  /** decode ahead of the playhead, evict far-away frames */
  const manageWindow = useCallback((center: number) => {
    const AHEAD = 16;
    const KEEP = 32;
    for (let d = 0; d <= AHEAD; d++) {
      const a = center + d;
      const b = center - d;
      if (a < countRef.current) decode(a);
      if (b >= 0) decode(b);
    }
    if (frames.current.size > KEEP * 2) {
      for (const [idx, f] of frames.current) {
        if (Math.abs(idx - center) > KEEP) {
          releaseFrame(f);
          frames.current.delete(idx);
        }
      }
    }
  }, [decode]);

  const nearestDecoded = useCallback((i: number): Frame | null => {
    if (frames.current.has(i)) return frames.current.get(i)!;
    for (let d = 1; d < countRef.current; d++) {
      if (frames.current.has(i - d)) return frames.current.get(i - d)!;
      if (frames.current.has(i + d)) return frames.current.get(i + d)!;
    }
    return null;
  }, []);

  /**
   * progress ∈ [0,1] → draw the matching frame, contain-fit, on the canvas.
   *
   * Stable across renders, and that stability is load-bearing. A consumer puts
   * `draw` in the dependency array of the effect that builds its ScrollTrigger;
   * with a fresh identity each render, scrolling set state, the render changed
   * `draw`, the effect tore the trigger down and rebuilt it, and the rebuild's
   * opening `draw(canvas, 0)` snapped the film back to frame 0. The captions
   * advanced while the picture never moved.
   *
   * Everything it touches is a ref, so there is nothing to depend on.
   */
  const draw = useCallback(function draw(
    canvas: HTMLCanvasElement | null,
    progress: number,
  ) {
    if (!canvas || countRef.current === 0) return;
    lastProgress.current = progress;
    const i = Math.round(Math.min(1, Math.max(0, progress)) * (countRef.current - 1));
    manageWindow(i);
    const frame = nearestDecoded(i);
    if (!frame) return;
    const src = frame.img;

    /*
     * Device pixel ratio is deliberately capped at 1.
     *
     * The footage is 1280x720. On a 1500px canvas at DPR 2 the backing store is
     * 3000px and every frame gets upscaled 2.3x — four times the pixels to
     * push, and not one of them sharper, because the source has no more detail
     * to give. At DPR 1 the same frame is upscaled 1.17x and looks better.
     */
    const dpr = 1;
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);

    /*
     * Cover, not contain.
     *
     * Contain letterboxes, and the bars have to be filled with *something*.
     * This footage's void is not a flat colour — it runs from #454d58 at the
     * top-left god-ray to #090b0c at the bottom-right — so no page background
     * can meet its edge without a visible seam down the sides. Cover removes
     * the bars entirely. It costs a crop, but the coin sits centred with wide
     * margins, so at ordinary window shapes the crop takes only empty void.
     */
    const s = Math.max(cw / src.width, ch / src.height);
    const w = src.width * s;
    const h = src.height * s;
    ctx.drawImage(src, (cw - w) / 2, (ch - h) / 2, w, h);
  }, [manageWindow, nearestDecoded]);

  return { ready, draw, lastProgress };
}
