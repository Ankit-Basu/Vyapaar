import { KineticHero } from "@/components/landing/kinetic-hero";
import SmoothScroll from "@/components/film/smooth-scroll";
import { AuditScene } from "@/components/landing/audit-scene";
import { GuardrailScene } from "@/components/landing/guardrail-scene";
import { Nav } from "@/components/landing/nav";
import {
  Cta,
  Failure,
  Footer,
  Growth,
  Mandate,
  Mcp,
  Problem,
  StatStrip,
} from "@/components/landing/sections";

export default function Landing() {
  return (
    <SmoothScroll>
      <div className="bg-[#131314] text-[#e5e2e3] min-h-screen">
        <Nav />

        <main className="relative z-10">
          <KineticHero />
          <StatStrip />
          <Problem />
          <Mandate />
          <GuardrailScene />
          <Growth />
          <Failure />
          <AuditScene />
          <Mcp />
          <Cta />
        </main>

        <Footer />
      </div>
    </SmoothScroll>
  );
}
