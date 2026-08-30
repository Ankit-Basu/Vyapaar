"use client";

import Link from "next/link";
import React, { useRef } from "react";
import { Shield, KeyRound, Link2 } from "lucide-react";
import TrueFocus from "@/components/animations/true-focus";
import { EASE, gsap, useScene } from "@/components/landing/motion";

export function KineticHero() {
  const scope = useRef<HTMLElement>(null);
  const leftContent = useRef<HTMLDivElement>(null);

  useScene(scope, {
    motion: () => {
      const tl = gsap.timeline({ defaults: { ease: EASE } });

      tl.from(".kinetic-status", { opacity: 0, y: 14, duration: 0.6 })
        .from(".kinetic-heading-line", { opacity: 0, y: 30, duration: 0.8 }, "-=0.3")
        .from(".kinetic-focus-wrap", { opacity: 0, scale: 0.96, duration: 0.8 }, "-=0.5")
        .from(".kinetic-subtext", { opacity: 0, y: 20, duration: 0.7 }, "-=0.5")
        .from(".kinetic-btn", { opacity: 0, y: 16, stagger: 0.08, duration: 0.6 }, "-=0.4")
        .from(".kinetic-trust-chip", { opacity: 0, y: 12, stagger: 0.06, duration: 0.5 }, "-=0.3");
    },
    still: () => {
      gsap.set(
        [
          ".kinetic-status",
          ".kinetic-heading-line",
          ".kinetic-focus-wrap",
          ".kinetic-subtext",
          ".kinetic-btn",
          ".kinetic-trust-chip",
        ],
        { opacity: 1, y: 0, scale: 1 },
      );
    },
  });

  return (
    <section
      ref={scope}
      id="top"
      className="relative min-h-[calc(100vh-64px)] w-full overflow-hidden bg-[#131314] text-[#e5e2e3] flex items-center"
    >
      {/* 3D Animated Kinetic Constellation Mesh (Right side, seamlessly camouflaged into background) */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-full md:w-3/5 select-none overflow-hidden z-0"
        aria-hidden="true"
      >
        {/*
         * Was a 53 MB GIF. The same footage as h264 is 1.5 MB and decodes on the
         * GPU instead of pegging a core, which is the difference between the hero
         * appearing instantly and appearing eventually.
         *
         * `autoPlay muted loop playsInline` is the combination every browser needs
         * before it will start a video without a tap; drop `muted` and iOS refuses.
         */}
        <video
          src="/landing.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-full w-full object-cover object-right motion-reduce:hidden"
        />
        {/* Directional fade: allows the mesh to seamlessly blend into the dark canvas under the text */}
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-[#131314]/35 to-[#131314]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#131314] via-transparent to-[#131314]/40" />
      </div>

      {/* Main Hero Content */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 sm:px-10 py-16">
        <div ref={leftContent} className="pt-3 md:max-w-[62%] md:pr-8">
          {/* Status Eyebrow */}
          <div className="kinetic-status mb-5 inline-flex items-center gap-2.5 rounded-full border border-[#ffb77b]/20 bg-[#ffb77b]/[0.04] px-3.5 py-1 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-[#ffb77b] shadow-[0_0_8px_#ffb77b] animate-pulse" />
            <span className="text-[10px] tracking-[0.38em] text-[#ffb77b] uppercase font-mono font-semibold">
              SYSTEM V4.0.3 // AGENT COMMERCE PROTOCOL
            </span>
          </div>

          {/* Editorial Display Heading */}
          <h1 className="kinetic-heading-line font-serif text-[54px] leading-[0.9] text-[#e5e2e3] sm:text-[76px] md:text-[92px] font-normal tracking-[-0.03em]">
            Authorising
          </h1>

          {/* Shifting Reticle Focus Box on italic words */}
          <div className="kinetic-focus-wrap font-serif text-[54px] leading-[0.9] italic text-[#ffb77b] sm:text-[76px] md:text-[92px]">
            <TrueFocus
              sentence="The Machine."
              manualMode={false}
              blurAmount={5}
              borderColor="#ffb77b"
              glowColor="rgba(255, 183, 123, 0.6)"
              animationDuration={0.5}
              pauseBetweenAnimations={1.2}
              containerClassName="italic items-start gap-[0.16em]"
              wordClassName="text-inherit font-semibold leading-[0.9]"
            />
          </div>

          {/* Subtitle Tailored to Vyapaar */}
          <p className="kinetic-subtext mt-8 max-w-xl text-[15px] leading-relaxed text-[#c7b0a6] font-sans">
            A cryptographically guarded mandate layer for high-stakes AI commerce.
            Move beyond conversational chat and empower software agents to discover, negotiate,
            and purchase with deterministic budget bounds.
          </p>

          {/* Action Buttons Row */}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="kinetic-btn bg-gradient-to-r from-[#ffb77b] to-[#b16d2e] px-7 py-3.5 text-[11px] font-semibold tracking-[0.2em] text-[#2e1500] uppercase transition hover:brightness-110 shadow-lg"
            >
              INITIALIZE CONTROL ROOM
            </Link>
            <a
              href="#guardrails"
              className="kinetic-btn bg-transparent px-7 py-3.5 text-[11px] font-semibold tracking-[0.2em] text-[#ffb77b] outline outline-1 outline-[#444748]/25 transition hover:text-[#ffd0a8] hover:outline-[#ffb77b]/50"
            >
              EXPLORE GUARDRAILS
            </a>
          </div>

          {/* Micro Telemetry Trust Badges */}
          <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-[#444748]/20 pt-6 font-mono text-[11px] text-[#b89a8e]">
            <div className="kinetic-trust-chip flex items-center gap-2">
              <Shield size={13} className="text-[#ffb77b]" />
              <span>9 + 9 GUARDRAILS</span>
            </div>
            <div className="kinetic-trust-chip flex items-center gap-2">
              <KeyRound size={13} className="text-[#ffb77b]" />
              <span>HMAC-SHA256 MANDATES</span>
            </div>
            <div className="kinetic-trust-chip flex items-center gap-2">
              <Link2 size={13} className="text-[#ffb77b]" />
              <span>APPEND-ONLY AUDIT CHAIN</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
export default KineticHero;
