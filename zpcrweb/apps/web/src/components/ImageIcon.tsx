/** A picture frame with a sun and a horizon — used on the melt view's "TIFF" button, which saves
 * the chart as an image rather than as a table (see `lib/figure/meltFigure.ts`). Same drawing
 * conventions as `DownloadIcon`: a 16×16 viewBox and `currentColor` strokes. */
export function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="5.8" cy="6" r="1.3" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M2 11.2l3.4-3.1 2.6 2.4 2-1.8L14 11.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
