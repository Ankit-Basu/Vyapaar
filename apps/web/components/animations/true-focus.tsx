"use client";

import React, { useEffect, useRef, useState } from "react";

interface TrueFocusProps {
  sentence?: string;
  separator?: string;
  manualMode?: boolean;
  blurAmount?: number;
  borderColor?: string;
  glowColor?: string;
  animationDuration?: number;
  pauseBetweenAnimations?: number;
  containerClassName?: string;
  wordClassName?: string;
}

interface FocusRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function TrueFocus({
  sentence = "The Unseen.",
  separator = " ",
  manualMode = false,
  blurAmount = 5,
  borderColor = "var(--color-brand-400, #ffb77b)",
  glowColor = "var(--color-brand-500, #b16d2e)",
  animationDuration = 0.5,
  pauseBetweenAnimations = 1.2,
  containerClassName = "",
  wordClassName = "font-serif text-inherit font-semibold leading-[0.88]",
}: TrueFocusProps) {
  const words = sentence.split(separator);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [lastActiveIndex, setLastActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [focusRect, setFocusRect] = useState<FocusRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!manualMode) {
      const interval = setInterval(
        () => {
          setCurrentIndex((prev) => (prev + 1) % words.length);
        },
        (animationDuration + pauseBetweenAnimations) * 1000,
      );

      return () => clearInterval(interval);
    }
  }, [manualMode, animationDuration, pauseBetweenAnimations, words.length]);

  const updateRect = () => {
    if (currentIndex === null || currentIndex === -1) return;
    const activeEl = wordRefs.current[currentIndex];
    const parentEl = containerRef.current;
    if (!activeEl || !parentEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();

    setFocusRect({
      x: activeRect.left - parentRect.left,
      y: activeRect.top - parentRect.top,
      width: activeRect.width,
      height: activeRect.height,
    });
    setInitialized(true);
  };

  useEffect(() => {
    updateRect();
    const handleResize = () => updateRect();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentIndex, words.length]);

  const handleMouseEnter = (index: number) => {
    if (manualMode) {
      setLastActiveIndex(index);
      setCurrentIndex(index);
    }
  };

  const handleMouseLeave = () => {
    if (manualMode && lastActiveIndex !== null) {
      setCurrentIndex(lastActiveIndex);
    }
  };

  return (
    <div
      className={`relative inline-flex flex-wrap items-center gap-[0.2em] ${containerClassName}`.trim()}
      ref={containerRef}
      style={{ outline: "none", userSelect: "none" }}
    >
      {words.map((word, index) => {
        const isActive = index === currentIndex;
        return (
          <span
            key={index}
            ref={(el) => {
              wordRefs.current[index] = el;
            }}
            className={`relative cursor-pointer transition-all ${wordClassName}`.trim()}
            style={{
              filter: isActive ? "blur(0px)" : `blur(${blurAmount}px)`,
              opacity: isActive ? 1 : 0.45,
              transition: `filter ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1), opacity ${animationDuration}s ease`,
              outline: "none",
              userSelect: "none",
            }}
            onMouseEnter={() => handleMouseEnter(index)}
            onMouseLeave={handleMouseLeave}
          >
            {word}
          </span>
        );
      })}

      {/* Shifting bounding reticle box with glowing corner brackets */}
      <div
        className="pointer-events-none absolute top-0 left-0"
        style={{
          transform: `translate3d(${focusRect.x}px, ${focusRect.y}px, 0)`,
          width: focusRect.width ? `${focusRect.width}px` : "auto",
          height: focusRect.height ? `${focusRect.height}px` : "auto",
          opacity: initialized && currentIndex >= 0 ? 1 : 0,
          transition: `transform ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1), width ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1), height ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease`,
          boxSizing: "border-box",
        }}
      >
        {/* Top Left Corner */}
        <span
          className="absolute -top-2.5 -left-2.5 size-4 rounded-tl-[3px] border-t-2 border-l-2"
          style={{
            borderColor,
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
        {/* Top Right Corner */}
        <span
          className="absolute -top-2.5 -right-2.5 size-4 rounded-tr-[3px] border-t-2 border-r-2"
          style={{
            borderColor,
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
        {/* Bottom Left Corner */}
        <span
          className="absolute -bottom-2.5 -left-2.5 size-4 rounded-bl-[3px] border-b-2 border-l-2"
          style={{
            borderColor,
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
        {/* Bottom Right Corner */}
        <span
          className="absolute -bottom-2.5 -right-2.5 size-4 rounded-br-[3px] border-b-2 border-r-2"
          style={{
            borderColor,
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
      </div>
    </div>
  );
}
