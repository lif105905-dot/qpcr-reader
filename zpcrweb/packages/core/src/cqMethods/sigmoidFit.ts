/**
 * `sigmoidFit` Cq method — see `cqMethod.ts` for the contract every method is held to.
 *
 * The analogue of CFX Maestro's "Regression" mode: fit a smooth amplification model to the
 * well's baseline-corrected trace, then read the Cq off the *model* rather than the noisy data.
 *
 * ```
 * T       = the curve's threshold — shared by every well of the dye
 * window  = [max(baseline begin, crossing − FIT_BEFORE_CROSSING) ..
 *            min(N, steepest rise after the crossing + FIT_PAST_INFLECTION)]
 * fit     y = y0 + A / (1 + exp(−(c − c0) / b))     weighted Levenberg–Marquardt, weights
 *                                                   1 / (σ² + (REL_WEIGHT·y)²): absolute error
 *                                                   at the foot, relative error up the rise
 * reject  → null (the threshold Cq stands) when the fit fails, b ∉ [MIN_B, MAX_B], or
 *         A < max(MIN_AMPLITUDE_OF_THRESHOLD·T, MIN_AMPLITUDE_SIGMAS·σ)
 * weight  w = soft(|y0|, MAX_Y0_OF_THRESHOLD·T)
 *           × soft(|model's own T crossing − threshold Cq|, MAX_CROSSING_DISAGREEMENT)
 *           × soft(foot RMS, min(MAX_FOOT_RMS_OF_THRESHOLD·T, MAX_FOOT_RMS_SIGMAS·σ))
 *         soft(v, L) = 1 for v ≤ L, falling linearly to 0 at 2L;  w = 0 → null
 * S(c)    = model − y0                              (the fitted signal, zero at baseline)
 * knee    = argmax_c d²/dc² ln(KNEE_OF_THRESHOLD·T + S(c))   on a 0.01-cycle grid
 * Cq      = threshold Cq − w · (threshold Cq − knee)
 * ```
 *
 * **Why a log-space knee is a level.** For an exponential `S = s·e^{c/b}`, the second derivative
 * of `ln(B + S)` peaks exactly where `S = B`: the knee in log space is the cycle at which the signal
 * reaches the background it is measured against. Against the raw fluorescence (thousands of RFU)
 * that is far *later* than the threshold; against a level below the threshold it is where the
 * fitted curve takes off. Because the model is smooth, its second derivative carries none of the
 * cycle-to-cycle jitter that makes a second derivative of the data itself unusable.
 *
 * **Why every level that moves a Cq is a fraction of the threshold, not of the curve's σ.**
 * Replicate wells of one dye share a threshold but not a σ — it varies up to ~8× between wells of
 * one triplicate. A knee level, or a gate deciding "shift or fall back", read off each well's own
 * σ puts replicates at different points of the same curve shape, which more than doubled the
 * replicate scatter of the corpus's clean CFX groups. Tying them to `T` keeps them group-shared.
 * σ survives only in two loose sanity bounds (amplitude ≥ 10σ, foot RMS ≤ 8σ) that a real curve
 * never meets. The gates are soft for the same reason: a hard cutoff lets two near-identical
 * replicates land on opposite sides of it, one shifted by a cycle and one not.
 */

import type { CqRefineInput } from "../cqMethod.js";

/** The log-space background as a fraction of the threshold: the knee lands about where the fitted
 * signal reaches this fraction of `T`. Tuned on the corpus (`tools/cqeval.mjs`): 0.5 calls ~0.25
 * cycle earlier and scatters Biomeme replicates more; 0.7 gives up a third of the shift. */
export const KNEE_OF_THRESHOLD = 0.6;
/** How many cycles past the steepest observed rise the fit window extends. The model only has to
 * describe the foot and the exponential; a real plateau is asymmetric, and a symmetric logistic
 * forced through all of it bends the foot. Tuned on the corpus. */
export const FIT_PAST_INFLECTION = 3;
/** How many cycles before the threshold crossing the fit window starts (never before the baseline
 * region). The model needs enough flat baseline to pin `y0`, but the run's first reads carry
 * settling transients a logistic cannot describe. Tuned on the corpus. */
export const FIT_BEFORE_CROSSING = 10;
/** The fit's weights treat a point's error as `σ` at the foot and this fraction of its value up
 * the rise, so the tall part of the curve cannot outvote the foot. Tuned on the corpus. */
export const REL_WEIGHT = 0.05;
/** Plausible logistic scale, cycles per e-fold. 100% efficiency is 1/ln 2 ≈ 1.44; 3 is ~40%. */
export const MIN_B = 0.4;
export const MAX_B = 3;
/** Fit rejected when the fitted amplitude is under this multiple of the threshold — a curve that
 * barely clears its threshold keeps the threshold Cq. Tuned on the corpus. */
export const MIN_AMPLITUDE_OF_THRESHOLD = 3;
/** Soft-gate limit on the fitted baseline level |y0|, as a fraction of the threshold: past it the
 * model is describing something other than a flat foot. Tuned on the corpus. */
export const MAX_Y0_OF_THRESHOLD = 0.3;
/** Soft-gate limit, in cycles, on the gap between the model's own threshold crossing and the
 * data's: a model that does not reproduce the crossing it refines is describing some other curve
 * (a bowed baseline, a drifting one). Tuned on the corpus. */
export const MAX_CROSSING_DISAGREEMENT = 0.4;
/** Soft-gate limit on the fit's RMS residual over the foot (window cycles up to the threshold
 * Cq + 1), as a fraction of the threshold. Tuned on the corpus. */
export const MAX_FOOT_RMS_OF_THRESHOLD = 0.1;
/** Per-curve sanity bounds, deliberately loose (see the module comment): the fitted amplitude must
 * be at least this many σ, and the foot RMS no more than {@link MAX_FOOT_RMS_SIGMAS} σ. */
export const MIN_AMPLITUDE_SIGMAS = 10;
export const MAX_FOOT_RMS_SIGMAS = 8;

/**
 * Every tunable of {@link sigmoidFitWith}. {@link SIGMOID_FIT_PARAMS} is what ships; the extra
 * knobs are the variants the corpus evaluation compared it with, kept so the comparison can be
 * re-run. A `…OfThreshold` value of 0 disables that threshold-relative level; a `…Sigmas` value of
 * 0 disables that σ-relative one.
 */
export interface SigmoidFitParams {
  /** The knee level as a fraction of the threshold; when 0, {@link kneeSigmas}·σ instead. */
  kneeOfThreshold: number;
  kneeSigmas: number;
  fitPastInflection: number;
  fitBeforeCrossing: number;
  relWeight: number;
  maxB: number;
  minAmplitudeOfThreshold: number;
  minAmplitudeSigmas: number;
  maxY0OfThreshold: number;
  maxY0Sigmas: number;
  maxCrossingDisagreement: number;
  maxFootRmsOfThreshold: number;
  maxFootRmsSigmas: number;
  /** Fade the shift out across each gate's limit instead of cutting it off. */
  softGates: boolean;
  /** When > 0, the knee level is at least this many times the local baseline's RMS — or, with
   * {@link wanderReject}, a curve whose wander exceeds the knee level is rejected. */
  wanderMultiple: number;
  wanderReject: boolean;
  /** `"knee"` (shipped); `"cross"`, the model crossing the knee level; or `"sdm"`, the
   * linear-space second-derivative maximum of the model. The last two are kept for evaluation. */
  mode?: "knee" | "cross" | "sdm";
  /** Evaluation hook: told why a curve kept its threshold Cq. */
  onReject?: (reason: string) => void;
}

export const SIGMOID_FIT_PARAMS: SigmoidFitParams = {
  kneeOfThreshold: KNEE_OF_THRESHOLD,
  kneeSigmas: 0,
  fitPastInflection: FIT_PAST_INFLECTION,
  fitBeforeCrossing: FIT_BEFORE_CROSSING,
  relWeight: REL_WEIGHT,
  maxB: MAX_B,
  minAmplitudeOfThreshold: MIN_AMPLITUDE_OF_THRESHOLD,
  minAmplitudeSigmas: MIN_AMPLITUDE_SIGMAS,
  maxY0OfThreshold: MAX_Y0_OF_THRESHOLD,
  maxY0Sigmas: 0,
  maxCrossingDisagreement: MAX_CROSSING_DISAGREEMENT,
  maxFootRmsOfThreshold: MAX_FOOT_RMS_OF_THRESHOLD,
  maxFootRmsSigmas: MAX_FOOT_RMS_SIGMAS,
  softGates: true,
  wanderMultiple: 0,
  wanderReject: false,
  mode: "knee",
};

export function sigmoidFit(input: CqRefineInput): number | null {
  return sigmoidFitWith(input, SIGMOID_FIT_PARAMS);
}

/** The model: `y0 + A / (1 + e^{−(c − c0)/b})`, parameters `[y0, A, c0, b]`. */
export function logistic(p: readonly number[], c: number): number {
  return p[0]! + p[1]! / (1 + Math.exp(-(c - p[2]!) / p[3]!));
}

/**
 * Weighted Levenberg–Marquardt fit of {@link logistic}. Returns the parameters, or null when the
 * normal equations are singular from the start or the result is not finite.
 */
export function fitLogistic(
  xs: readonly number[],
  ys: readonly number[],
  ws: readonly number[],
  seed: readonly number[],
): number[] | null {
  const n = xs.length;
  let p = seed.slice();
  const cost = (q: number[]): number => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = ys[i]! - logistic(q, xs[i]!);
      s += ws[i]! * r * r;
    }
    return s;
  };
  let cur = cost(p);
  let lambda = 1e-3;
  const J = [0, 0, 0, 0];
  for (let iter = 0; iter < 60; iter++) {
    const H = new Float64Array(16);
    const g = new Float64Array(4);
    for (let i = 0; i < n; i++) {
      const c = xs[i]!;
      const u = (c - p[2]!) / p[3]!;
      const e = Math.exp(-u);
      const L = 1 / (1 + e);
      const dL = L * L * e; // dL/du
      J[0] = 1;
      J[1] = L;
      J[2] = (-p[1]! * dL) / p[3]!;
      J[3] = (-p[1]! * dL * u) / p[3]!;
      const w = ws[i]!;
      const r = ys[i]! - (p[0]! + p[1]! * L);
      for (let a = 0; a < 4; a++) {
        g[a] = g[a]! + w * J[a]! * r;
        for (let b = 0; b <= a; b++) H[a * 4 + b] = H[a * 4 + b]! + w * J[a]! * J[b]!;
      }
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) H[a * 4 + b] = H[b * 4 + a]!;
    let accepted = false;
    for (let tries = 0; tries < 12 && !accepted; tries++) {
      const M = Float64Array.from(H);
      for (let a = 0; a < 4; a++) M[a * 5] = H[a * 5]! * (1 + lambda) + 1e-300;
      const d = solve4(M, g);
      if (d) {
        const q = [p[0]! + d[0]!, p[1]! + d[1]!, p[2]! + d[2]!, p[3]! + d[3]!];
        if (q[3]! > 0.05) {
          const s = cost(q);
          if (s < cur) {
            const rel = (cur - s) / Math.max(cur, 1e-300);
            p = q;
            cur = s;
            lambda = Math.max(lambda / 10, 1e-9);
            accepted = true;
            if (rel < 1e-10) return p;
            continue;
          }
        }
      }
      lambda *= 10;
    }
    if (!accepted) break;
  }
  return p.every(Number.isFinite) ? p : null;
}

/** Gaussian elimination with partial pivoting on a 4×4 system (`M` row-major); null if singular. */
function solve4(M: Float64Array, rhs: Float64Array): number[] | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) a.push([M[i * 4]!, M[i * 4 + 1]!, M[i * 4 + 2]!, M[i * 4 + 3]!, rhs[i]!]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (!(Math.abs(a[piv]![col]!) > 1e-300)) return null;
    const tmp = a[col]!;
    a[col] = a[piv]!;
    a[piv] = tmp;
    const pr = a[col]!;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const row = a[r]!;
      const f = row[col]! / pr[col]!;
      for (let k = col; k < 5; k++) row[k] = row[k]! - f * pr[k]!;
    }
  }
  return a.map((row, i) => row[4]! / row[i]!);
}

export function sigmoidFitWith(input: CqRefineInput, params: SigmoidFitParams): number | null {
  const { cycles, corrected, noise, threshold, thresholdCq, baselineRegion } = input;
  const reject = (reason: string): null => {
    params.onReject?.(reason);
    return null;
  };
  const n = cycles.length;
  if (n < 8 || !(noise > 0)) return reject("input");

  const from = cycles.findIndex((c) => c >= baselineRegion.beginCycle);
  if (from < 0) return reject("input");
  // The steepest observed rise at or after the threshold crossing — roughly the inflection.
  let iCross = cycles.findIndex((c) => c >= thresholdCq);
  if (iCross < 1) iCross = n - 1;
  let iSteep = iCross;
  let steepest = -Infinity;
  for (let i = Math.max(iCross, from + 1); i < n; i++) {
    const d = corrected[i]! - corrected[i - 1]!;
    if (d > steepest) {
      steepest = d;
      iSteep = i;
    }
    if (i > iSteep + 2 && d < steepest * 0.3) break; // clearly turned over
  }
  const to = Math.min(n - 1, iSteep + params.fitPastInflection);
  const start = Math.max(from, iCross - params.fitBeforeCrossing);
  if (to - start + 1 < 8) return reject("short window");

  const xs = cycles.slice(start, to + 1);
  const ys = corrected.slice(start, to + 1);
  const ws = ys.map((y) => 1 / (noise * noise + (params.relWeight * Math.max(y, 0)) ** 2));
  const top = Math.max(...ys);
  if (!(top > threshold)) return reject("top");

  // Seed: plateau a little above the window's top, 100% efficiency, and c0 placed so the seed
  // passes through the threshold at the threshold Cq.
  const seedB = 1.5;
  const seedA = Math.max(top * 1.2, threshold * 2);
  const seedC0 = thresholdCq + seedB * Math.log(seedA / threshold - 1);
  const p = fitLogistic(xs, ys, ws, [0, seedA, seedC0, seedB]);
  if (!p) return reject("no fit");
  const [y0, A, c0, b] = p as [number, number, number, number];
  if (!(b >= MIN_B && b <= params.maxB)) return reject("b");
  const ampFloor = Math.max(params.minAmplitudeOfThreshold * threshold, params.minAmplitudeSigmas * noise);
  if (!(A >= ampFloor && A > threshold)) return reject("A");
  const y0Max = Math.min(
    params.maxY0OfThreshold > 0 ? params.maxY0OfThreshold * threshold : Infinity,
    params.maxY0Sigmas > 0 ? params.maxY0Sigmas * noise : Infinity,
  );
  // A soft gate's weight: 1 within `limit`, falling linearly to 0 at twice it, so two replicate
  // wells either side of a limit get nearly the same Cq rather than one shifted and one not.
  const soft = (value: number, limit: number): number =>
    !params.softGates ? (value <= limit ? 1 : 0) : Math.max(0, Math.min(1, 2 - value / limit));
  let weight = soft(Math.abs(y0), y0Max);
  if (weight === 0) return reject("y0");
  const tAbove = threshold - y0;
  const modelCrossing = tAbove > 0 && tAbove < A ? c0 - b * Math.log(A / tAbove - 1) : NaN;
  if (!Number.isFinite(modelCrossing)) return reject("crossing");
  weight *= soft(Math.abs(modelCrossing - thresholdCq), params.maxCrossingDisagreement);
  if (weight === 0) return reject("crossing");
  let ss = 0;
  let m = 0;
  for (let i = 0; i < xs.length && xs[i]! <= thresholdCq + 1; i++) {
    ss += (ys[i]! - logistic(p, xs[i]!)) ** 2;
    m++;
  }
  const footMax = Math.min(
    params.maxFootRmsOfThreshold > 0 ? params.maxFootRmsOfThreshold * threshold : Infinity,
    params.maxFootRmsSigmas > 0 ? params.maxFootRmsSigmas * noise : Infinity,
  );
  if (m === 0) return reject("foot rms");
  weight *= soft(Math.sqrt(ss / m), footMax);
  if (weight === 0) return reject("foot rms");

  const S = (c: number): number => A / (1 + Math.exp(-(c - c0) / b));
  const lo = xs[0]!; // the knee is only sought where the model was fitted
  // The knee level: a fraction of the group-shared threshold (see the module comment). The
  // σ-relative level and the baseline-wander guard below it are evaluation variants, off as
  // shipped — both are per-curve, and both scattered replicates.
  let B = params.kneeOfThreshold > 0 ? params.kneeOfThreshold * threshold : params.kneeSigmas * noise;
  if (params.wanderMultiple > 0) {
    let sq = 0;
    let k = 0;
    // Only the local baseline — the part of the fit window the region covers — so the run's
    // settling transients in its first reads don't count as wander.
    for (let i = start; i < n && cycles[i]! <= baselineRegion.endCycle; i++) {
      sq += corrected[i]! * corrected[i]!;
      k++;
    }
    const wander = k > 0 ? params.wanderMultiple * Math.sqrt(sq / k) : 0;
    if (params.wanderReject) {
      if (wander > B) return reject("wander");
    } else B = Math.max(B, wander);
  }
  const mode = params.mode ?? "knee";

  const blend = (cq: number): number => thresholdCq - weight * Math.max(0, thresholdCq - cq);
  if (mode === "cross") {
    if (!(A > B)) return reject("cross");
    return blend(c0 - b * Math.log(A / B - 1)); // S(c) = B, solved exactly
  }

  // The second-derivative maximum on a fine grid, of ln(B + S) ("knee") or of S ("sdm"). Searched
  // a little past the threshold Cq so a maximum just beyond it is found as such (and then clamped
  // to the threshold Cq by the contract) rather than mistaken for the grid's edge.
  const step = 0.01;
  const f = mode === "sdm" ? S : (c: number) => Math.log(B + S(c));
  let argmax = NaN;
  let best = -Infinity;
  for (let c = lo + step; c <= thresholdCq + 3; c += step) {
    const d2 = f(c + step) - 2 * f(c) + f(c - step);
    if (d2 > best) {
      best = d2;
      argmax = c;
    }
  }
  if (!(argmax > lo + 2 * step)) return reject("edge");
  return blend(argmax);
}
