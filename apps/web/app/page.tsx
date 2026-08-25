import { AuditScene } from "@/components/landing/audit-scene";
import { GuardrailScene } from "@/components/landing/guardrail-scene";
import { Hero } from "@/components/landing/hero";
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
 * Two sections pin and scrub — the guardrail gauntlet and the audit chain —
 * because both are sequences, and letting the reader drive the sequence at
 * their own pace explains them better than any static diagram would.
 */
export default function Landing() {
  return (
    <>
      <div className="aurora" aria-hidden />
      <div className="grain" aria-hidden />

      <Nav />

      <main className="relative">
        <Hero />
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
    </>
  );
}
