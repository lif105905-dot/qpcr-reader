/**
 * `logTakeoff` Cq method — the **takeoff point**: where the curve's second derivative in log space
 * peaks, i.e. where amplification starts to dominate the background it sits on. See `cqMethod.ts`
 * for the contract every method is held to (never later than the threshold Cq, never a new call).
 *
 * Seen in log space, a curve is flat background, then a straight line (the exponential), and
 * `d²/dc² log F` peaks at the corner between the two. For `F = P + A·e^(b·c)` that peak is
 * **exactly where the exponential term equals P** — so the takeoff is set by what counts as the
 * background `P`, and is computed analytically from a fit instead of by differentiating samples:
 *
 * ```
 * u      = threshold / 20                   # the group's σ under the default auto threshold
 * floor  = MIN_LEVEL × max(u, own σ)        # the curve must clear its own noise to count
 * fit log(corrected) = a + b·cycle, weighted by corrected², over the contiguous points
 *   from the last rise through `floor` up to FIT_TOP × u (the early exponential)
 * decline unless e^b ∈ (MIN_GAIN, MAX_GAIN) and ≥ 3 points
 * cq = (log(PEDESTAL × u) − a) / b          # the analytic d² peak of log(PEDESTAL·u + e^(a+b·c))
 * cq = max(cq, the interpolated crossing of `floor`)
 * decline if thresholdCq − cq > MAX_BACK
 * ```
 *
 * Why the fit rather than the literal recipe — all tuned on the lab corpus (`tools/cqeval.mjs`,
 * 14 CFX runs / 209 positive curves, 373 Biomeme runs / 3004):
 *
 * - **log of the raw curve** (P = the fitted baseline, Tichopad's original form) moves almost
 *   nothing: CFX backgrounds sit ~2000σ above zero, so the corner is far *after* a 20σ threshold.
 * - **a Savitzky–Golay d² of sampled `log(corrected + P)`** does move the Cq ~1.2–1.7 cycles, but
 *   the knee is broad against one-cycle sampling and noise decides which sample peaks: on tight
 *   replicate triplets it scatters 0.4–0.9 cycles (SD) against the threshold Cq's 0.10.
 * - **the fit** keeps the threshold's precision (0.108 vs 0.099) while still calling ~1.3 earlier.
 *
 * Units are the group's (`threshold / 20`), not each curve's own σ, because replicates share a
 * threshold but not a σ (neighbouring RVP wells differ 3×); a per-curve unit puts each replicate's
 * takeoff at a different level and doubles their scatter. With a hand-set threshold, the levels
 * simply follow it: the pedestal is 0.4 × whatever threshold the curve is on.
 */

import type { CqRefineInput } from "../cqMethod.js";

/** Background level whose meeting with the exponential is the takeoff, in units of `threshold/20`
 * (so 0.4 × threshold). Tuned on the corpus: 5 calls ~2.0 cycles early at twice the replicate
 * scatter; 8 calls ~1.3 early at the threshold's own scatter. */
export const LOG_TAKEOFF_PEDESTAL = 8;

/** The rise counts from where the corrected curve last climbs through this many σ (the larger of
 * the group's and the curve's own). Tuned: below 3, noisy Biomeme wells start taking off inside
 * their own jitter. */
export const LOG_TAKEOFF_MIN_LEVEL = 3;

/** Top of the exponential fit, in units of `threshold/20` (so 5 × threshold) — below the
 * curvature of the approach to plateau on every clean curve in the corpus. */
export const LOG_TAKEOFF_FIT_TOP = 100;

/** Per-cycle amplification the fit must report; outside this it is not an exponential phase. */
export const LOG_TAKEOFF_MIN_GAIN = 1.2;
export const LOG_TAKEOFF_MAX_GAIN = 2.5;

/** Longest back-extrapolation trusted, in cycles. Beyond it the fit is shallow enough (a creeping
 * Biomeme curve, a U-shaped baseline) that the extrapolation, not the data, is placing the Cq.
 * The largest move on any CFX curve is 2.3. */
export const LOG_TAKEOFF_MAX_BACK = 3;

export function logTakeoff(input: CqRefineInput): number | null {
  const { cycles, corrected, thresholdCq } = input;
  const unit = input.threshold / 20;
  if (!(unit > 0)) return null;
  const floor = LOG_TAKEOFF_MIN_LEVEL * Math.max(unit, input.noise);

  // Walk back from the threshold crossing to where the curve last rose through `floor`.
  let start = -1;
  let floorCycle = -Infinity;
  const crossing = cycles.findIndex((c) => c >= thresholdCq);
  for (let i = crossing < 0 ? cycles.length - 1 : crossing; i > 0; i--) {
    if (corrected[i]! < floor) {
      start = i + 1;
      const a = corrected[i]!;
      const b = corrected[i + 1]!;
      floorCycle = cycles[i]! + ((floor - a) / (b - a)) * (cycles[i + 1]! - cycles[i]!);
      break;
    }
  }
  if (start < 0) return null;

  // Weighted least squares of log(corrected) on cycle over the early exponential. Additive noise σ
  // on v is σ/v on log v, hence the weight v².
  const top = LOG_TAKEOFF_FIT_TOP * unit;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let count = 0;
  for (let i = start; i < cycles.length && corrected[i]! <= top; i++) {
    const v = corrected[i]!;
    if (!(v > 0)) return null;
    const w = v * v;
    const x = cycles[i]!;
    const y = Math.log(v);
    sw += w;
    sx += w * x;
    sy += w * y;
    sxx += w * x * x;
    sxy += w * x * y;
    count++;
  }
  if (count < 3) return null;
  const varX = sxx - (sx * sx) / sw;
  if (!(varX > 0)) return null;
  const slope = (sxy - (sx * sy) / sw) / varX;
  if (!(slope > Math.log(LOG_TAKEOFF_MIN_GAIN) && slope < Math.log(LOG_TAKEOFF_MAX_GAIN))) return null;
  const intercept = (sy - slope * sx) / sw;

  const cq = Math.max((Math.log(LOG_TAKEOFF_PEDESTAL * unit) - intercept) / slope, floorCycle);
  if (thresholdCq - cq > LOG_TAKEOFF_MAX_BACK) return null;
  return cq;
}
