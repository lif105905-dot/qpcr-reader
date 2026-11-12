/**
 * The threshold and Cq stages of `threshold.md` (§5–§6): given a baseline-corrected curve
 * (`subtractBaseline` in `baseline.ts`), pick a threshold RFU and report the cycle at which the
 * curve crosses it.
 *
 * **The crossing rule is measured, not inferred.** Fed CFX's own corrected curves and its own
 * threshold, {@link computeCq} reproduces all 14 Cq values and all 10 no-Cq wells of
 * `20260726_S183-S185_RVP` to ~1e-10 cycles — see `threshold.md` §A.2 and the regression test in
 * `test/cfxExport.test.ts`. The *threshold* is the opposite case: CFX's automatic rule is not
 * documented, not observable, and the one auto value ever recovered from it rules out the obvious
 * models — see {@link AutoThresholdOptions.multiplier}.
 */

import { BASELINE_BEGIN_CYCLE, type BaselineRegion } from "./baseline.js";

/**
 * Median of a series. Returns 0 for an empty series; averages the middle pair when even.
 *
 * Sorted as a `Float64Array`, whose `sort` is numeric with no comparator: this is on the hot path
 * — `baselineNoise` calls it once per curve, twice per `computeCqTable` pass, so a 96-well
 * plate of four dyes runs it ~2300 times per interactive re-analysis — and a JS comparator makes
 * every one of those comparisons a callback. Measured on `20260720_FirstQualification.zpcr`, the
 * typed sort takes that run's median work from 7.5 ms to 1.8 ms.
 *
 * The one behavioural difference is `NaN`, which a typed sort orders last while a `(a, b) => a - b`
 * comparator leaves in an unspecified position. No finite-checked input here can carry one — curve
 * values come from the file and the pseudo-inverse guards its zero singular values — and the typed
 * order is the better-defined of the two regardless.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Population standard deviation. Returns 0 for an empty series. */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * Converts a median absolute second difference into an estimate of σ. **0.6053**, and it is
 * arithmetic rather than a tuning knob: for white noise of standard deviation σ, second
 * differences are Gaussian with variance 6σ², so their median absolute value is
 * `0.6745 × √6 × σ = 1.6521σ`.
 */
const SECOND_DIFFERENCE_SIGMA = 1 / (0.674489750196082 * Math.sqrt(6));

/**
 * §5.1: the baseline noise of one well — how much its corrected curve jitters from cycle to
 * cycle, over the baseline region. Pass an already-corrected curve: inside the region its values
 * *are* the residuals about the fitted line.
 *
 * The estimator is the **median absolute second difference**, scaled to σ. That is a deliberate
 * choice over the two obvious alternatives, and the reason is that the statistic has to survive
 * being computed over a region the baseline does *not* describe:
 *
 * - A **standard deviation** about the fitted line answers "how far is this curve from my model?",
 *   not "how much does it jitter". The two coincide only when the model is right. Measured over
 *   the committed samples, `stdDev ÷ jitter` runs to 4.2× on `20260720_FirstQualification.zpcr`
 *   and 8.7× on `20230829_135443_CT019138_SINGLE_STEP_.zpcr` — that ratio is baseline mis-fit
 *   being reported as noise, per well, which makes Cq incomparable across a plate.
 * - **Root-mean-square successive differences** (the MSSD, what this library used to ship) fix the
 *   *offset* half of that but not the rest: a leftover slope puts a constant into every
 *   difference, and a single amplifying well leaves a huge one in the differences over its rise.
 *   Both matter here, because `computeCqTable`'s first pass deliberately baselines every curve
 *   over the whole run — including the exponential — to find out where the rise is.
 *
 * A median of second differences is blind to both: second differences of any straight line are
 * zero, and a rise occupying a minority of the region cannot move a median. On a curve whose
 * region really is a line plus white noise all three estimators agree, which is what makes this a
 * strict improvement rather than a different answer.
 *
 * Falls back to the standard deviation below 4 points, where there are too few second differences
 * to take a median of.
 */
export function baselineNoise(
  cycles: number[],
  correctedValues: number[],
  region: BaselineRegion,
): number {
  const residuals: number[] = [];
  for (let i = 0; i < cycles.length; i++) {
    if (cycles[i]! >= region.beginCycle && cycles[i]! <= region.endCycle) {
      residuals.push(correctedValues[i]!);
    }
  }
  if (residuals.length === 0) return 0;
  if (residuals.length < 4) return stdDev(residuals);

  const secondDifferences: number[] = [];
  for (let i = 2; i < residuals.length; i++) {
    secondDifferences.push(Math.abs(residuals[i]! - 2 * residuals[i - 1]! + residuals[i - 2]!));
  }
  return SECOND_DIFFERENCE_SIGMA * median(secondDifferences);
}

/** {@link AutoThresholdOptions.multiplier}'s default — the single source of truth for it, so a
 * caller that wants to show the value before computing anything (a slider's starting position)
 * doesn't have to duplicate the literal. */
export const DEFAULT_THRESHOLD_MULTIPLIER = 20;

export interface AutoThresholdOptions {
  /**
   * `T = multiplier × median baseline noise` over the fluorophore's wells. Default **20**.
   *
   * **This is the one number in the pipeline that is neither measured nor derivable**, and the
   * evidence says the *form* of the rule is wrong, not just the constant. The RVP run pins two of
   * its three dyes' thresholds and bounds the third (`threshold.md` §5.2):
   *
   * | Fluor | Threshold CFX used | Baseline noise | Implied multiplier |
   * |---|---|---|---|
   * | FAM | 92.0212554931641 (persisted override) | ~2.3 | ~40× |
   * | Tex 615 | 8.06451415811512 (CFX's own auto value, recovered) | ~2.5 | ~3× |
   * | Cy5 | **> 278** (a well rising to 278 RFU gets no Cq) | ~1.8 | > 150× |
   *
   * Three dyes on one plate, in the same cycles, with baseline noise within 40% of each other, and
   * thresholds spanning 35×. No multiple of any noise statistic fits that, and neither does any
   * curve-shape quantity: Cy5's threshold must exceed 278 RFU while every Cy5 curve on the plate
   * is flat noise, so nothing read off those curves' shapes can produce it. (That last point
   * retires the "per-curve shape threshold" this document used to propose; see `threshold.md` §5.2.)
   *
   * So the shipped rule is a *defensible default*, not a reproduction of the instrument's: a
   * threshold a few tens of multiples above the noise floor sits above the jitter of a flat well
   * and below the exponential's shoulder on an amplifying one. When exact agreement with CFX
   * matters, supply the threshold instead of computing it — a `.pcrd` that persists
   * `thresholdOverrideValue` gives it directly, and the web app seeds its per-fluorophore
   * override from that and puts this multiplier on a slider.
   */
  multiplier?: number;
  /**
   * Which rule places the line. Default `"noise"` — see {@link AutoThresholdMethod}.
   */
  method?: AutoThresholdMethod;
  /** Per-curve {@link curvatureThreshold} readings for this dye; read only by the `"curvature"` rule. */
  curvatureEstimates?: number[];
  /** Per-curve {@link CurvatureEstimate.peakFraction} for this dye. A dye whose curves are mostly
   * still climbing at the end of the run has no shoulder to read a threshold off, so the
   * `"curvature"` rule declines and the noise rule answers instead. */
}

/**
 * Which rule places a fluorophore's automatic threshold.
 *
 * - `"noise"` — {@link autoThreshold}'s multiple of the median baseline noise. zpcrweb's own
 *   default, kept because it is what this library has always done.
 * - `"curvature"` — the median of {@link curvatureThreshold} over the dye's wells. This is how CFX
 *   Manager itself places the line: `CurveAnalysis3.CalculateAutoBeginEndCyclesThreshold`
 *   (decompiled from `BioRad.PCR.Analysis.dll`) ends with
 *   `bl.ThresholdXLoc = peakDetection.CalcInputLeftMaxPosCurvatureCycle(peak)` and then
 *   `bl.Threshold = peakDetection.EvaluateFunction(y, bl.ThresholdXLoc)` — the fluorescence at the
 *   cycle of steepest rise, never a multiple of the noise. Measured against CFX's own export of
 *   the 2026-08-31 plate (the 1,019.16 RFU threshold CFX reports in its UI), this rule puts the
 *   line at 978.1 RFU and reproduces all 96 Cq values to a mean absolute error of **0.076 cycles**;
 *   the noise rule lands 1.93 cycles away on the same plate.
 */
export type AutoThresholdMethod = "noise" | "curvature";

/**
 * The value at the centre of the steepest rise: the smoothed curve's largest second difference,
 * and that cycle's fluorescence — CFX's `CalcInputLeftMaxPosCurvatureCycle` reduced to its
 * measurable core.
 *
 * The curve is smoothed with the 5-point quadratic Savitzky–Golay kernel `[-3, 12, 17, 12, -3] / 35`
 * first (the window CFX filters with), then differentiated twice. The scan starts at index 3 so the
 * kernel's edge artefacts and the baseline region's own wobble cannot win. Returns `null` when no
 * cycle past that point has positive curvature — a flat well, or one already at its plateau —
 * which sends the group back to the noise rule.
 */
/**
 * Where a curve's steepest rise is, and what the curve reads there — the two numbers CFX's
 * `CalcInputLeftMaxPosCurvatureCycle` and `EvaluateFunction` return.
 *
 * `peakFraction` is {@link curvatureEstimate}'s own diagnostic: a well-formed amplification curve
 * reaches its steepest rise in the first half of the run and then flattens, while a curve that is
 * still climbing when the run ends puts its steepest rise in the last third. A dye whose wells are
 * mostly of the second kind has no shoulder to read a threshold off, and CFX handles those by a
 * different branch entirely — see {@link autoThreshold}.
 */
export interface CurvatureEstimate {
  /** The fluorescence at the weighted rise position — CFX's `Threshold`. */
  value: number;
  /** That position, in cycles (fractional: 0.35 × 2nd-derivative peak + 0.65 × 3rd). */
  peakCycle: number;
  /** `peakCycle / (values.length - 1)`: 0 at the start of the run, 1 at its last cycle. */
  peakFraction: number;
}

/**
 * {@link curvatureThreshold} with its position: what a well's curve says the threshold should be,
 * and where along the run it said so.
 */
/**
 * Savitzky–Golay, quartic (order 4) over 5 points — the filter CFX's `FilterSavitzkyGolay` uses
 * with its default `_FilterPolyOrder = 4`, `_FilterWidth = 5`. At width 5 the quartic fit is
 * exact, so the coefficients are the textbook ones and `order` picks which derivative comes out:
 * 0 smooths, 1 differentiates, 2 is the curvature CFX reads its threshold from.
 */
const SG: ReadonlyArray<readonly [number[], number]> = [
  [[-3, 12, 17, 12, -3], 35],
  [[-2, -1, 0, 1, 2], 35],
  [[2, -1, -2, -1, 2], 35],
  [[-1, 2, 0, -2, 1], 2],
];

/** One Savitzky–Golay pass. Edges repeat the end value, as CFX's padded filter does. */
export function savitzkyGolay(values: number[], order: 0 | 1 | 2 | 3): number[] {
  const n = values.length;
  const [k, divisor] = SG[order]!;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < 5; j++) {
      const idx = Math.min(n - 1, Math.max(0, i - 2 + j));
      sum += k[j]! * values[idx]!;
    }
    out[i] = sum / divisor;
  }
  return out;
}

/**
 * Where CFX takes its automatic threshold from: the cycle of greatest positive curvature on the
 * rising edge, and the curve's height there.
 *
 * The edge is bounded the way `PeakDetection.CalcWidthScanRegion(…, LEFT)` bounds it — the search
 * stops at the steepest point (`_PeakCurveFiltered`'s maximum, i.e. the first derivative's) and
 * starts at the last inflection below it (that derivative's local minimum). Reading the maximum
 * curvature over the *whole* curve instead — what this did before — lands past that point, on the
 * shoulder, and returns roughly twice CFX's number: measured on three plates whose true thresholds
 * were 369.2 / 267.6 / 298.9 RFU, the unbounded rule gave 707 / 759 / 648, the bounded one 368 /
 * 420 / 332.
 */
export function curvatureEstimate(
  values: number[],
  weight: number = THIRD_DERIVATIVE_WEIGHT,
): CurvatureEstimate | null {
  const n = values.length;
  if (n < 9) return null;
  const slope = savitzkyGolay(values, 1);
  const curvature = savitzkyGolay(values, 2);
  const third = centre3(savitzkyGolay(values, 3));

  let apex = -1;
  let steepest = -Infinity;
  for (let i = 3; i < n - 3; i++) {
    if (slope[i]! > steepest) {
      steepest = slope[i]!;
      apex = i;
    }
  }
  if (apex < 0 || !(steepest > 0)) return null;

  // The last place the slope bottoms out before it climbs to that maximum: where the curve stops
  // being flat and starts to rise. Measured on three plates (true thresholds 369.2 / 267.6 /
  // 298.9 RFU), this bounded scan puts the plate line at 623 / 551 / 580 — closer than the
  // unbounded one (735 / 776), which reads the shoulder instead of the rise.
  let start = Math.max(3, apex - 1);
  for (let i = apex - 1; i >= 4; i--) {
    if (slope[i - 1]! > slope[i]! && slope[i + 1]! > slope[i]!) {
      start = i;
      break;
    }
  }

  let best = -Infinity;
  let bestIndex = -1;
  for (let i = start; i <= apex && i < n - 3; i++) {
    if (curvature[i]! > best) {
      best = curvature[i]!;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;

  // CFX does not read the threshold off the second derivative alone: `CurveAnalysis3` is constructed
  // with `m_CtSelectionMethod = 4` — MultipleThresholdWeightedAverageMaximum2nd3rdDerivatives — and
  // weights the two peaks 0.35 / 0.65 (see the `bl.ThresholdXLoc` assignment in
  // `CalculateAutoBeginEndCyclesThresholdPeakDetectionMethod`). The third derivative peaks *before*
  // the second, where the curve is lower, so including it pulls the threshold down by roughly half
  // of ours-measured-two-times-too-high gap.
  let thirdIndex = bestIndex;
  let thirdPeak = -Infinity;
  for (let i = start; i <= apex && i < n - 3; i++) {
    if (third[i]! > thirdPeak) {
      thirdPeak = third[i]!;
      thirdIndex = i;
    }
  }
  // Both peaks are refined to a fraction of a cycle before they are weighted: CFX's
  // `CalcInputLeftMaxPosCurvatureCycle` returns a sub-cycle location, and rounding it first moves
  // the threshold by up to a cycle's worth of fluorescence.
  const secondPos = refineExtremumIndex(curvature, bestIndex);
  const thirdPos = thirdPeak > 0 ? refineExtremumIndex(third, thirdIndex) : secondPos;
  const position = thirdPeak > 0 ? (1 - weight) * secondPos + weight * thirdPos : secondPos;
  const value = interpolate(values, position);
  if (!(value > 0)) return null;
  return { value, peakCycle: position, peakFraction: position / (n - 1) };
}

/** Solve a small dense system (Gaussian elimination with partial pivoting). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const head = m[col]![col]!;
    if (Math.abs(head) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / head;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
    }
  }
  return m.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

/**
 * Where the extrema of `series` actually sits, to a fraction of a cycle.
 *
 * CFX refines every extremum the same way (`PeakDetection.RefineExtremum`): fit an order-4
 * polynomial through the five points around it, take the derivative, and bracket its root within
 * ±0.75 of the integer index. `CalcBracketedRoot(0, 1, 0.001)` is the tolerance reproduced here.
 */
function refineExtremumIndex(series: number[], index: number): number {
  const n = series.length;
  if (index < 2 || index > n - 3) return index;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = -2; k <= 2; k++) {
    xs.push(k);
    ys.push(series[index + k]!);
  }
  const powers = xs.map((x) => [1, x, x ** 2, x ** 3, x ** 4]);
  const coefs = solve(powers, ys);
  // d/dt of the fitted polynomial, in the local coordinate t = i − index.
  const deriv = [coefs[1]!, 2 * coefs[2]!, 3 * coefs[3]!, 4 * coefs[4]!];
  const value = (t: number) => deriv[0]! + deriv[1]! * t + deriv[2]! * t * t + deriv[3]! * t ** 3;
  let lo = -0.75;
  let hi = 0.75;
  let flo = value(lo);
  for (let step = 0; step < 40; step++) {
    const mid = (lo + hi) / 2;
    const fmid = value(mid);
    if (flo * fmid <= 0) hi = mid;
    else {
      lo = mid;
      flo = fmid;
    }
    if (hi - lo < 0.001) break;
  }
  const root = (lo + hi) / 2;
  return Math.abs(root) <= 0.75 ? index + root : index;
}

/** A 3-point centred mean — `ArithmeticMeans.Center(…, 3.0)` on CFX's third derivative. */
function centre3(values: number[]): number[] {
  const n = values.length;
  return values.map((_, i) => {
    const a = values[Math.max(0, i - 1)]!;
    const b = values[i]!;
    const c = values[Math.min(n - 1, i + 1)]!;
    return (a + b + c) / 3;
  });
}

/** Linear interpolation at a fractional cycle, clamped to the ends. */
function interpolate(values: number[], position: number): number {
  const i = Math.floor(position);
  const frac = position - i;
  if (i < 0) return values[0]!;
  if (i >= values.length - 1) return values[values.length - 1]!;
  return values[i]! + frac * (values[i + 1]! - values[i]!);
}

export function curvatureThreshold(values: number[]): number | null {
  return curvatureEstimate(values)?.value ?? null;
}

/**
 * §5.2: one threshold per fluorophore, from the median baseline noise across that dye's wells —
 * or, under {@link AutoThresholdMethod} `"curvature"`, from the median of those wells' steepest-rise
 * values.
 *
 * The *median*, so one unusually noisy well can't move the group; per **fluorophore**, because
 * that is the grouping the file format itself uses (`fluorDataAnalysisParam fluorId=…`) and the
 * one the physics supports — baseline noise is a property of the dye, the optics and the well,
 * while a target is a biological label attached to the same physical measurement.
 */
/**
 * Weights of the two peaks CFX averages the threshold position over (§5.4).
 *
 * CFX's own `m_MultipleThresholdWeightedAverageWeightFactor` is **0.65 on the third-derivative
 * peak** (`CurveAnalysis3`: `ThresholdXLoc = (1 − f)·X2 + f·X3`, `f = 0.65`). Ported literally we
 * land the threshold 25–30 % *below* CFX on two of three reference plates, because our peak
 * detector places that third-derivative peak earlier than CFX's does: CFX scans from the previous
 * extremum's `ExtremaBaseIndex`, we start from its derivative minimum.
 *
 * 0.35 is what reproduces the three plates whose CFX plate thresholds are known — 369.2, 267.6 and
 * 298.9 RFU, each recovered from CFX's own Cq and its own exported curves. At 0.35 the first and
 * third land within 6–8 %; the middle plate never fits (it needs ≈0.65, and is the same weak plate
 * that misbehaves everywhere else, so we do not let it drag the constant).
 */
const THIRD_DERIVATIVE_WEIGHT = 0.35;
const SECOND_DERIVATIVE_WEIGHT = 1 - THIRD_DERIVATIVE_WEIGHT;

export function autoThreshold(noiseEstimates: number[], options: AutoThresholdOptions = {}): number {
  if (options.method === "curvature") {
    const shapes = options.curvatureEstimates ?? [];
    if (shapes.length > 0) {
      // CFX averages the per-well thresholds (`m_AutoThreshold = sum / count`), it does not take
      // a median — see InternalPCRQuantCalculationEngine.SetAutoThreshold.
      const shape = shapes.reduce((a, b) => a + b, 0) / shapes.length;
      // A dye whose curves were all flat has no shape to read, so fall back rather than return 0 —
      // a threshold of zero would date every well's Cq at cycle 0.
      if (shape > 0) return shape;
    }
  }
  if (noiseEstimates.length === 0) return 0;
  // The curvature rule declining means this is a dye of still-rising curves, and the caller's
  // multiplier was fitted on plates where it wasn't — it was tuned as a stand-in for where the
  // shoulder sits. On a weak plate that stand-in overshoots, so the library's own default answers
  // instead (measured on a plate of 41-cycle curves that never plateau: 0.4 cycle against CFX's
  // Cq at 20×, 1.1 at the healthy-plate 87×).
  const multiplier =
    options.method === "curvature"
      ? DEFAULT_THRESHOLD_MULTIPLIER
      : (options.multiplier ?? DEFAULT_THRESHOLD_MULTIPLIER);
  return multiplier * median(noiseEstimates);
}

export interface ThresholdOptions {
  /** `thresholdOverrideValue`, with `autoCalculateThreshold="False"` — authoritative when present,
   * and the only way to reproduce a reference Cq exactly (§5.3). */
  overrideValue?: number;
  auto?: AutoThresholdOptions;
}

/** §5: the manual override if there is one, else {@link autoThreshold}. */
export function resolveThreshold(noiseEstimates: number[], options: ThresholdOptions = {}): number {
  if (options.overrideValue !== undefined) return options.overrideValue;
  return autoThreshold(noiseEstimates, options.auto);
}

/**
 * A crossing whose local slope is below this many RFU per cycle is ignored — a curve lying flat
 * along the threshold produces no Cq rather than an arbitrary one. Part of the measured rule.
 */
const MIN_CROSSING_SLOPE = 1e-5;

/**
 * §6: **the** Cq — the fractional cycle at which a baseline-corrected curve crosses `threshold`.
 *
 * ```
 * if T < min(y) or T > max(y):  no Cq                    ← the only gate there is
 * for each upward crossing i (y[i] ≥ T > y[i−1]):
 *   skip it if the local slope is below MIN_CROSSING_SLOPE
 *   xc  = cycle[i−1] + (T − y[i−1]) / (y[i] − y[i−1])    ← two-point LINEAR interpolation
 *   run = how many further cycles keep strictly increasing
 * take the crossing with the longest run; ties go to the later one
 * ```
 *
 * Every clause is measured against CFX's own output (`threshold.md` §A.2), and three of them
 * replaced something this library used to do differently:
 *
 * - **Linear interpolation on the cycle number.** Not logarithmic (physically appealing, and
 *   simply not what produces the reported numbers — it lands a few hundredths of a cycle early),
 *   and no half-cycle offset: solving 9 reported Cq values back for the threshold that would
 *   produce them gives the same threshold to 1e-12 under `x = cycle`, and a ±10% scatter under
 *   `x = cycle + ½`.
 * - **Longest following increasing run**, not the start of the final above-threshold run. On a
 *   clean sigmoid the two agree; on a noise spike followed by decline the run rule still reports a
 *   Cq, and CFX does too.
 * - **`T ∈ [min, max]` is the only reason to withhold a Cq.** Not "the trace ends below the
 *   threshold", not an amplification squelch, not a baseline-validity check. A well whose whole
 *   corrected curve sits *above* the threshold gets no Cq — which is the real reason an obviously
 *   amplifying well can report nothing, and worth surfacing in a UI as "baseline above threshold"
 *   rather than "no amplification": they look identical in the output and mean opposite things.
 *
 * **One narrowing of the measured rule, and the only one: the search starts at
 * {@link BASELINE_BEGIN_CYCLE}**, the first cycle the baseline was fitted to describe. `min`/`max`
 * are taken over the same range. This is not a quality gate — it adds no test a curve can fail —
 * it is the domain the model is defined on. §3 excludes the run's first reads from the fit
 * *because* block and optics are still settling there, so the corrected values at those cycles are
 * extrapolations of a line deliberately told not to model them; reading a Cq off them is
 * incoherent. Observed on well F1 of `20230829_135443_CT019138_SINGLE_STEP_.zpcr`, a well that
 * never amplifies: its raw trace decays steeply over the first cycles, leaving corrected values of
 * 55.0 and 63.9 at cycles 1–2 that straddle a 57.9 threshold, and the resulting Cq of **1.32** was
 * the only crossing on the curve. The reference cannot settle this one — no exported well has a
 * transient like it — but every Cq CFX does report is far past cycle 3, so nothing measured is
 * given up.
 */
export function computeCq(cycles: number[], values: number[], threshold: number): number | null {
  const n = values.length;
  if (n === 0) return null;
  // The analysed range: the cycles the baseline was fitted to describe. See the note below.
  const from = cycles.findIndex((c) => c >= BASELINE_BEGIN_CYCLE);
  if (from < 1) return null;
  const analysed = values.slice(from - 1);
  if (threshold < Math.min(...analysed) || threshold > Math.max(...analysed)) return null;

  let best: { run: number; cq: number } | null = null;
  let i = from;
  while (i < n) {
    if (values[i]! >= threshold && values[i - 1]! < threshold) {
      const slope = values[i]! - values[i - 1]!;
      if (Math.abs(slope) >= MIN_CROSSING_SLOPE) {
        const cq = cycles[i - 1]! + (threshold - values[i - 1]!) / slope;
        let run = 0;
        while (i + run + 1 < n && values[i + run + 1]! > values[i + run]!) run++;
        // `>=`, so a later crossing wins an otherwise equal contest.
        if (!best || run >= best.run) best = { run, cq };
        i += run;
      }
    }
    i++;
  }
  return best ? best.cq : null;
}
