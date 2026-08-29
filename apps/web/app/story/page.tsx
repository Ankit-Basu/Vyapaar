import type { Metadata } from "next";
import Link from "next/link";

import { Mark } from "@/components/brand";
import { RupeeFilm } from "@/components/film/rupee-film";
import SmoothScroll from "@/components/film/smooth-scroll";
import { StoryOutro } from "@/components/film/story-outro";

export const metadata: Metadata = {
  title: "AgentMandi — the path of a rupee",
  description:
    "A scroll-driven film: one rupee travelling from a signed mandate, through eight guardrails, to a settled payment and a hash-chained record.",
};

/**
 * The film page.
 *
 * The scrubbed footage is the opening act, not the whole page — a run that
 * ends when the film ends has built a very expensive header. Everything below
 * continues the same story in type: what the eight checks actually are, what
 * happens when one fails, and where to go to watch it run for real.
 */
export default function Story() {
  return (
    <SmoothScroll>
      <div className="relative bg-canvas">
        {/* Deliberately minimal: the film owns the first screen, so the only
            chrome is a way back and a way in. */}
        <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 sm:px-10">
          <Link href="/" className="flex items-center gap-3" title="AgentMandi">
            <Mark size={32} />
            <span className="text-[14px] font-semibold tracking-tight text-mute-100">
              AgentMandi
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="glass-surface glass-d1 lift rounded-xl px-4 py-2 text-[12.5px] font-medium text-mute-200"
          >
            Open the control room
          </Link>
        </header>

        <RupeeFilm />
        <StoryOutro />
      </div>
    </SmoothScroll>
  );
}
