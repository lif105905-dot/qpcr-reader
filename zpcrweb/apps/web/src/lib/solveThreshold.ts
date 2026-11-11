import { computeCq } from "@zpcrweb/core";

/** One curve of the plate, already baseline-corrected, with the well it belongs to. */
export interface SolvableCurve {
  well: string;
  cycles: number[];
  values: number[];
}

/**
 * The one threshold that best reproduces a set of Cq values some other program reported.
 *
 * CFX does not write its automatic threshold into the file, and its own rule (largest positive
 * curvature, averaged over wells) does not survive our baseline exactly — measured against three
 * plates it lands about twice as high. Solving for the threshold instead of deriving it sidesteps
 * the whole question: if we are told the Cq of every well, one number can be found that puts our
 * crossing there, and the numbers then agree to a hundredth of a cycle.
 *
 * Golden-section over the plateau height: the error is unimodal in the threshold (too low and every
 * curve crosses early, too high and they cross late), so ~40 evaluations are enough.
 */
export function solveThreshold(
  curves: SolvableCurve[],
  cfxCq: Record<string, number>,
): number | null {
  const pairs = curves
    .map((curve) => ({ curve, want: cfxCq[curve.well] }))
    .filter((p) => Number.isFinite(p.want) && p.want! > 0 && p.want! < 40);
  if (pairs.length < 4) return null;

  let ceiling = 0;
  for (const p of pairs) for (const v of p.curve.values) if (v > ceiling) ceiling = v;
  if (!(ceiling > 0)) return null;

  const error = (threshold: number): number => {
    let total = 0;
    let counted = 0;
    for (const { curve, want } of pairs) {
      const cq = computeCq(curve.cycles, curve.values, threshold);
      if (cq == null) continue;
      const delta = cq - want!;
      total += delta * delta;
      counted += 1;
    }
    // A threshold that leaves most wells without a Cq is worse than one that fits them all.
    return counted < pairs.length * 0.5 ? Number.POSITIVE_INFINITY : total / counted;
  };

  let lo = 0;
  let hi = ceiling;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 48; i += 1) {
    const a = hi - phi * (hi - lo);
    const b = lo + phi * (hi - lo);
    if (error(a) < error(b)) hi = b;
    else lo = a;
  }
  const best = Math.round((lo + hi) / 2);
  return best > 0 ? best : null;
}
