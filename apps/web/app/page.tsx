import { MoltenBackground } from "@/components/glass/molten-background";
import { RupeeFilm } from "@/components/film/rupee-film";
import SmoothScroll from "@/components/film/smooth-scroll";
import { AuditScene } from "@/components/landing/audit-scene";
import { GuardrailScene } from "@/components/landing/guardrail-scene";
import { Nav } from "@/components/landing/nav";
import {
  Cta,
  Failure,
  Footer,
  Mandate,
  Mcp,
  Problem,
  StatStrip,
} from "@/components/landing/sections";

/**
 * The landing page tells the story in the order the system actually works:
 * the gap, the consent that closes it, the guardrails that enforce it, what
 * happens when it goes wrong, the trail it leaves, and who can use it.
 *
 * It opens on the film. A rupee is minted, sealed, carried through the
 * guardrails, settled and recorded — scrubbed frame by frame at the reader's
 * own pace. That is the whole product in one continuous shot, so it replaces
 * the static hero rather than sitting beside it; two headlines making the same
 * claim would only weaken both.
 *
 * Two later sections also pin and scrub — the guardrail gauntlet and the audit
 * chain — because both are sequences, and letting the reader drive a sequence
 * explains it better than any static diagram would.
 */
export default function Landing() {
  return (
    <SmoothScroll>
      {/*
        The lit ground, with the shader off.
        The film is a full-screen canvas for the first six screens, so a WebGL
        loop behind it renders frames nobody can see; below the film this still
        paints the ground the sections stand on.
      */}
      <MoltenBackground shader={false} />

      <Nav />

      <main className="relative z-10">
        <RupeeFilm />
        <StatStrip />
        <Problem />
        <Mandate />
        <GuardrailScene />
        <Failure />
        <AuditScene />
        <Mcp />
        <Cta />
      </main>

      <Footer />
    </SmoothScroll>
  );
}
