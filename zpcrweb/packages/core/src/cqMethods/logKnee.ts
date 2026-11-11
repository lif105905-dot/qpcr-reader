/**
 * `logKnee` Cq method — see `cqMethod.ts` for the contract every method is held to.
 *
 * Backs the threshold Cq up to the **knee** of the curve in log space: the cycle where the
 * baseline-corrected curve leaves its floor and turns into the straight line an exponential is on
 * a log axis. That bend is where the second derivative of log fluorescence peaks.
 *
 * ```
 * F    = FLOOR_FRACTION × threshold
 * Y[c] = ln(max(corrected[c], F)) − ln F           # 0 on the floor, a line up the exponential
 * knee = the corner k of the continuous fit  Y ≈ s·max(c − k, 0)  over the reads up to
 *        HINGE_AFTER past the threshold Cq, with k searched (0.02-cycle grid) over the
 *        MAX_BACK_CYCLES before it
 * cq   = max(knee, the cycle the curve last rose through
 *                  max(GUARD_FRACTION × threshold, SIGMA_GATE × σ))
 * ```
 *
 * The corner of a floor-then-line fit is a point mass of d²Y — the second-derivative peak — but
 * fitted from every read at once rather than sampled at whole cycles. A sampled Savitzky–Golay
 * d² peak is broad relative to one-cycle reads and wanders between replicates; it was this
 * method's first form and scored worse on both corpora (Biomeme replicate SD 0.69 vs 0.48).
 *
 * **Every level is shared by the curve's threshold group** — a fraction of the threshold, not of
 * the curve's own σ, which varies up to 8× between replicate wells. With a 3σ floor and guard,
 * CFX replicate SD went 0.19 → 0.41. Per-curve σ survives only as {@link SIGMA_GATE}, a sanity
 * gate for a curve far noisier than its group.
 *
 * A corner pinned at the far edge of the search (a slow, long foot) is kept, not rejected: every
 * replicate of such a curve then backs up by the same capped amount, where rejecting some and
 * not others scattered Biomeme replicates (0.48 → 0.75). Also tried and dropped: projecting the
 * exponential's slope down to the floor, and pre-smoothing the curve.
 */

import type { CqRefineInput } from "../cqMethod.js";

/** The log floor, as a fraction of the threshold. Tuned on the corpus (0.15–0.25 all within
 * 0.01 of each other in replicate SD). */
export const FLOOR_FRACTION = 0.25;
/** The Cq never precedes the curve's last rise through this fraction of the threshold. Tuned on
 * the corpus: 0.15 → CFX replicate SD 0.29, 0.25 → 0.24. */
export const GUARD_FRACTION = 0.25;
/**
 * …nor through this many of the curve's own σ — a sanity gate for a curve far noisier than its
 * group. Tuned on the corpus, with "never before the obvious rise" outranking precision: 2 leaves
 * 38 Biomeme curves calling more than a cycle before their own 3σ rise, 2.5 leaves 17, **3 leaves
 * 5** at a cost of Biomeme clean-replicate SD 0.48 → 0.55 and CFX 0.24 → 0.27.
 *
 * It only binds when `3σ > GUARD_FRACTION × threshold`, i.e. a curve whose σ is above ~1.7× its
 * group's (at the default multiplier of 20), so clean replicates are untouched by it. Declining
 * such curves outright (keeping their threshold Cq) instead scattered replicates far worse
 * (Biomeme 0.62–1.02): some wells of a group shifted and others didn't.
 */
export const SIGMA_GATE = 3;
/** Furthest back from the threshold Cq the knee may sit, in cycles. Tuned on the corpus: 4
 * reaches into Biomeme's slow feet (replicate SD 0.48 → 0.56). */
export const MAX_BACK_CYCLES = 3;
/** Reads past the threshold Cq the fit includes — enough to pin the exponential's slope, too few
 * to reach the plateau. Tuned on the corpus (1–3 equivalent). */
export const HINGE_AFTER = 2;

export interface LogKneeParams {
  floorFraction: number;
  guardFraction: number;
  sigmaGate: number;
  maxBackCycles: number;
  hingeAfter: number;
}

export const LOG_KNEE_DEFAULTS: LogKneeParams = {
  floorFraction: FLOOR_FRACTION,
  guardFraction: GUARD_FRACTION,
  sigmaGate: SIGMA_GATE,
  maxBackCycles: MAX_BACK_CYCLES,
  hingeAfter: HINGE_AFTER,
};

/** Grid step of the corner search, in cycles. */
const CORNER_STEP = 0.02;

/** The fractional cycle at which `y` last rose through `level`, at or before index `upTo`. */
function lastRiseThrough(cycles: number[], y: number[], level: number, upTo: number): number | null {
  for (let i = Math.min(upTo, y.length - 1); i > 0; i--) {
    if (y[i - 1]! < level && y[i]! >= level) {
      return cycles[i - 1]! + (level - y[i - 1]!) / (y[i]! - y[i - 1]!);
    }
  }
  return null;
}

/** A `logKnee` refiner with its constants overridden — what a parameter sweep scores. */
export function makeLogKnee(params: Partial<LogKneeParams> = {}) {
  const p = { ...LOG_KNEE_DEFAULTS, ...params };

  return function logKnee(input: CqRefineInput): number | null {
    const { cycles, corrected, noise, threshold, thresholdCq } = input;
    const n = cycles.length;
    if (!(threshold > 0) || n < 8) return null;

    let after = cycles.findIndex((c) => c > thresholdCq);
    if (after < 0) after = n - 1;

    // The fit's reads: the search window and the floor before it, up to HINGE_AFTER past the Cq.
    // Reads on the floor (Y = 0) left of the corner contribute nothing either way.
    const floor = p.floorFraction * threshold;
    const xs: number[] = [];
    const ys: number[] = [];
    const last = Math.min(n - 1, after + p.hingeAfter - 1);
    for (let i = 0; i <= last; i++) {
      if (cycles[i]! < thresholdCq - p.maxBackCycles - 1) continue;
      xs.push(cycles[i]!);
      ys.push(Math.log(Math.max(corrected[i]!, floor) / floor));
    }
    if (xs.length < 4) return null;

    // Least squares over the corner k; for a given k the slope has a closed form.
    let knee: number | null = null;
    let bestSse = Infinity;
    for (let k = thresholdCq - p.maxBackCycles; k < thresholdCq; k += CORNER_STEP) {
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < xs.length; i++) {
        const x = Math.max(xs[i]! - k, 0);
        sxy += x * ys[i]!;
        sxx += x * x;
      }
      if (sxx === 0) continue;
      const s = sxy / sxx;
      if (!(s > 0)) continue;
      let sse = 0;
      for (let i = 0; i < xs.length; i++) sse += (ys[i]! - s * Math.max(xs[i]! - k, 0)) ** 2;
      if (sse < bestSse) {
        bestSse = sse;
        knee = k;
      }
    }
    if (knee == null) return null;

    const guard = Math.max(p.guardFraction * threshold, p.sigmaGate * (noise > 0 ? noise : 0));
    const rise = lastRiseThrough(cycles, corrected, guard, after);
    return rise != null && knee < rise ? rise : knee;
  };
}

export const logKnee = makeLogKnee();
