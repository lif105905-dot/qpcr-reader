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
  curvaturePeakFractions?: number[];
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
  /** The fluorescence at the steepest-rise cycle — CFX's `Threshold`. */
  value: number;
  /** That cycle's index, 0-based. */
  peakCycle: number;
  /** `peakCycle / (values.length - 1)`: 0 at the start of the run, 1 at its last cycle. */
  peakFraction: number;
}

/**
 * {@link curvatureThreshold} with its position: what a well's curve says the threshold should be,
 * and where along the run it said so.
 */
export function curvatureEstimate(values: number[]): CurvatureEstimate | null {
  const n = values.length;
  if (n < 7) return null;
  const smooth = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    smooth[i] =
      i < 2 || i >= n - 2
        ? values[i]!
        : (-3 * values[i - 2]! +
            12 * values[i - 1]! +
            17 * values[i]! +
            12 * values[i + 1]! -
            3 * values[i + 2]!) /
          35;
  }
  let best = 0;
  let bestIndex = -1;
  for (let i = 3; i < n - 1; i++) {
    const second = smooth[i + 1]! - 2 * smooth[i]! + smooth[i - 1]!;
    if (second > best) {
      best = second;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  const value = smooth[bestIndex]!;
  if (value <= 0) return null;
  return { value, peakCycle: bestIndex, peakFraction: bestIndex / (n - 1) };
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
/** A curve peaking past this fraction of the run is still climbing at its end — see
 * {@link AutoThresholdOptions.curvaturePeakFractions}. */
const LATE_PEAK_FRACTION = 0.7;

/** Share of a dye's curves that may peak late before the `"curvature"` rule declines. */
const LATE_PEAK_SHARE = 0.3;

/** A dye whose *median* curve peaks past this fraction of the run has no shoulder at all. */
const LATE_PEAK_MEDIAN = 0.6;

export function autoThreshold(noiseEstimates: number[], options: AutoThresholdOptions = {}): number {
  if (options.method === "curvature") {
    const shapes = options.curvatureEstimates ?? [];
    const peaks = options.curvaturePeakFractions ?? [];
    // A dye whose curves are still climbing when the run ended has not shown CFX a shoulder, and
    // CFX does not read a threshold off such curves either — it falls through to another branch.
    // Say so by declining here: roughly a third of a weak plate's wells peak in the last third of
    // the run, none of a healthy plate's do.
    const latePeaks = peaks.filter((f) => f > LATE_PEAK_FRACTION).length;
    const plateaued =
      peaks.length === 0 ||
      (latePeaks / peaks.length <= LATE_PEAK_SHARE && median(peaks) <= LATE_PEAK_MEDIAN);
    if (shapes.length > 0 && plateaued) {
      const shape = median(shapes);
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
