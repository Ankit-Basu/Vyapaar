import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Seal } from "@/components/studio/seal";
import {
  Glass,
  GlassButton,
  GlassInput,
  Metal,
  Money,
  StatusPill,
  Studio,
} from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Vyapaar — material",
  description: "The Studio material system: lit graphite, glass, metal and the seal.",
};

/**
 * The material checkpoint.
 *
 * Everything the redesign rests on, shown before any real screen is touched:
 * if the glass and the metal do not have light in them here, they will not
 * have light in them anywhere.
 */
export default function StyleGuide() {
  return (
    <>
      <Studio />
      <main className="relative mx-auto w-full max-w-5xl px-6 py-24 sm:px-8">
        <header className="mb-20">
          <p className="st-micro">Vyapaar</p>
          <h1 className="st-display mt-4 text-[clamp(2.5rem,5.5vw,4rem)]">
            Material, before screens.
          </h1>
          <p className="st-body mt-6 max-w-xl">
            A graphite room with one studio light. Glass you look through, metal money is
            struck from, and a seal that gets pressed. Colour appears only where it means
            something.
          </p>
        </header>

        <Section
          title="The room"
          note="One key light from the upper left and one weak cool bounce from the lower right — nothing else. That single direction is what every specular edge below is consistent with. The previous version used four saturated aurora blobs, which have no light direction, so the surfaces in front of them read as coloured rectangles instead of glass."
        >
          <Glass depth={1} className="h-40 rounded-2xl" />
        </Section>

        <Section
          title="Glass"
          note="Depth is elevation, not decoration. More depth means more blur, a brighter top edge and a longer cast shadow — which is what elevation actually looks like under a fixed light. Four things together sell it: the blur, the hairline where the key catches the top edge, the inner shadow along the bottom where it does not, and the shadow the pane throws into the room."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {([1, 2, 3] as const).map((depth) => (
              <Glass key={depth} depth={depth} className="rounded-2xl p-5">
                <p className="st-micro">depth {depth}</p>
                <p className="st-title mt-2">
                  {depth === 1 ? "Chrome" : depth === 2 ? "Content" : "Floating"}
                </p>
                <p className="st-caption mt-2">
                  {depth === 1
                    ? "Sits almost on the ground. Nav bars, chips, inputs."
                    : depth === 2
                      ? "The default pane. Panels and cards."
                      : "Above everything. Menus, sheets, the hero object."}
                </p>
              </Glass>
            ))}
          </div>
        </Section>

        <Section
          title="Metal"
          note="The money material, and the one primary action. It appears twice on a screen at most — the moment it is everywhere it stops meaning anything. Hover it for the specular sweep. Text on metal is the canvas colour, never white: measured against the mid tone, #F5F6F8 is 1.76:1 and the canvas is 10.30:1, so the component does not offer white at all."
        >
          <div className="flex flex-wrap items-center gap-5">
            <Metal as="button" className="h-11 rounded-xl px-5 text-[0.8125rem] font-semibold">
              Watch an agent buy something
            </Metal>
            <div className="st-glass rounded-2xl px-6 py-4">
              <p className="st-micro">settled</p>
              <p className="mt-1 text-[1.75rem] leading-none font-semibold">
                <Money>₹13,396.00</Money>
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="The seal"
          note="The signature element. Consent happens once and then binds every purchase after it, so it leaves an artifact rather than a status string — the four bounds the server actually enforces, struck into the metal. The third state is the whole tamper story without prose: edit the cap, re-sign with the wrong key, and verification fails before a single bound is consulted."
        >
          <div className="flex flex-wrap items-start justify-center gap-10 sm:justify-start">
            {(["signed", "unsigned", "broken"] as const).map((state) => (
              <div key={state} className="flex flex-col items-center gap-3">
                <Seal state={state} size={196} />
                <span className="st-micro">{state}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Status"
          note="Three hues, fixed everywhere. Nothing about presentation — no theme, mode or preference — re-tints them, because a denial that looks different depending on a display setting is a denial that lies. Everything else on the page is graphite."
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusPill kind="pass">auto_approve</StatusPill>
            <StatusPill kind="gate">gate_for_human</StatusPill>
            <StatusPill kind="deny">deny</StatusPill>
            <StatusPill kind="live" pulse>
              streaming
            </StatusPill>
            <StatusPill kind="idle">offline</StatusPill>
          </div>
        </Section>

        <Section
          title="Controls"
          note="Everything that is not the one primary action is glass. The focus ring is the cool accent — the only place a colour appears without carrying status meaning."
        >
          <div className="flex flex-wrap items-center gap-3">
            <GlassButton>See the guardrails</GlassButton>
            <GlassButton disabled>Disabled</GlassButton>
            <GlassInput placeholder="What should the agent buy?" className="min-w-64 flex-1" />
          </div>
        </Section>

        <Section
          title="Type"
          note="One strict scale. Slightly negative tracking on display sizes, never cramped — over-tight condensed display type was one of the tells being removed. Data is mono and tabular so columns of money align on the decimal."
        >
          <Glass depth={2} className="space-y-5 rounded-2xl p-7">
            <p className="st-display text-[clamp(2rem,4vw,3rem)]">Let an AI agent spend your money.</p>
            <p className="st-title">A signed mandate, enforced server-side</p>
            <p className="st-body max-w-xl">
              Every rupee it moves is bounded by a signed mandate, gated when it matters, and
              explained in a tamper-evident audit trail.
            </p>
            <p className="st-caption">Eight guardrails, in order, every time.</p>
            <p className="st-micro">append-only · hash-chained</p>
            <p className="st-numeric text-[0.8125rem] text-st-body">
              prev 9f3ac21b0b12de99 · hash 5c8e1a2be41bb093
            </p>
          </Glass>
        </Section>

        <footer className="st-caption mt-24 border-t border-white/[0.07] pt-8">
          Contrast checked against the brightest surface each token actually sits on. Caption
          was specified at #71757F, which measures 3.45:1 on 9% glass; it ships at #868A92,
          the nearest tone that clears AA.
        </footer>
      </main>
    </>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-20">
      <h2 className="st-title">{title}</h2>
      <p className="st-caption mt-2 mb-7 max-w-2xl">{note}</p>
      {children}
    </section>
  );
}
