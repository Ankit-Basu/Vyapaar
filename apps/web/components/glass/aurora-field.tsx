/**
 * The field every glass surface refracts.
 *
 * This is the single load-bearing piece of the material: glass over a flat
 * black page has nothing to see through, so it renders as a grey rectangle no
 * matter how carefully the edge and shadow are tuned. Four slow-drifting lobes
 * of colour give it something to bend.
 *
 * Deliberately not a client component — it is four divs and a noise overlay
 * with no state, and the drift and the reduced-motion freeze are both handled
 * in CSS. Nothing here needs to ship JavaScript.
 */
export function AuroraField() {
  return (
    <>
      <div className="aurora-field" aria-hidden>
        <div className="aurora-blob aurora-blob--violet" />
        <div className="aurora-blob aurora-blob--indigo" />
        <div className="aurora-blob aurora-blob--teal" />
        <div className="aurora-blob aurora-blob--magenta" />
      </div>
      <div className="aurora-grain" aria-hidden />
    </>
  );
}
