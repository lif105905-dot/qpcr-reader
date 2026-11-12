/**
 * `CurveAnalysis3`'s threshold pick — the rule CFX actually ships.
 *
 * ```csharp
 * // CalculateAutoBeginEndCyclesThreshold, after the baseline window is settled
 * double x2 = pd.CalcInputLeftMaxPosCurvatureCycle(val);   // max positive curvature, LEFT of the peak
 * double x3 = pd.CalcInputLeftMax3rdDerivativeCycle(val);  // the same maximum, refined twice over
 * bl.ThresholdXLoc = (1 - 0.65) * x2 + 0.65 * x3;
 * bl.Threshold    = pd.EvaluateFunction(y, bl.ThresholdXLoc);
 * ```
 *
 * `val` is the run's primary peak (`ExtractPeaks(peaks)[0]`), which on a clean amplification curve
 * is the first one. Note what `x3` is *not*: `CalcInputLeftMax3rdDerivativeCycle` scans
 * `_CurveFiltered2ndDeriv` exactly like `x2` does and then solves for the root of the second
 * derivative of the local polynomial — so it refines the same maximum instead of looking at the
 * third derivative. The 0.65 weight therefore slides the position by a fraction of a cycle, not by
 * a cycle.
 */
import { detectPeaks } from "./peakDetection.js";
import { selectPeak } from "./baseline.js";
import { savitzkyGolay } from "../threshold.js";

/** CFX's `m_MultipleThresholdWeightedAverageWeightFactor`. */
export const CFX_THRESHOLD_WEIGHT = 0.65;

/** Coefficients of the polynomial that interpolates the five points around `center`. */
function localPolynomial(series: number[], center: number): number[] | null {
  if (center < 2 || center > series.length - 3) return null;
  const xs = [-2, -1, 0, 1, 2];
  const ys = xs.map((k) => series[center + k]!);
  // Solve the 5×5 Vandermonde system by Gaussian elimination.
  const a = xs.map((x) => [1, x, x ** 2, x ** 3, x ** 4]);
  const m = a.map((row, i) => [...row, ys[i]!]);
  for (let col = 0; col < 5; col++) {
    let pivot = col;
    for (let r = col + 1; r < 5; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const head = m[col]![col]!;
    if (Math.abs(head) < 1e-12) return null;
    for (let r = 0; r < 5; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / head;
      for (let c = col; c <= 5; c++) m[r]![c] = m[r]![c]! - factor * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[5]! / row[i]!);
}

/** Root of `f` on `[lo, hi]`, or `null` when the function does not change sign there. */
function bracketedRoot(f: (x: number) => number, lo: number, hi: number, tol = 0.001): number | null {
  let flo = f(lo);
  let fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 60 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/** `Polynomial.CalcDerivative(vector, order)` evaluated as a closure. */
function derivativePoly(coefs: number[], order: number): (t: number) => number {
  const out = coefs.map((_, k) => {
    let factor = 1;
    for (let j = 0; j < order; j++) factor *= k - j;
    return k < order ? 0 : coefs[k]! * factor;
  });
  return (t: number) => out.reduce((sum, c, k) => sum + c * t ** k, 0);
}

/** Sub-cycle refinement of the extremum of `series` at `index`, CFX style. */
function refineExtremum(series: number[], index: number, order: 1 | 2): number {
  const coefs = localPolynomial(series, index);
  if (!coefs) return index;
  const f = derivativePoly(coefs, order);
  const root = bracketedRoot(f, 0, 1) ?? bracketedRoot(f, -1, 0);
  return root == null ? index : index + root;
}

function maxIndexInRange(series: number[], start: number, end: number): number {
  let best = start;
  for (let i = start; i <= end && i < series.length; i++) if (series[i]! > series[best]!) best = i;
  return best;
}

/** Linearly interpolated value of `values` at fractional index `x`. */
function valueAt(values: number[], x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  if (i < 0) return values[0]!;
  if (i >= values.length - 1) return values[values.length - 1]!;
  return values[i]! + (values[i + 1]! - values[i]!) * f;
}

/**
 * The threshold CFX reads off one well's curve, in the units of `values`.
 *
 * Pass the **baseline-corrected** curve: CFX evaluates its threshold on the analysed curve, which
 * is what the baseline subtraction produces.
 */
export function cfxThresholdValue(values: number[]): number | null {
  if (values.length < 9) return null;
  const peaks = detectPeaks(values);
  // The run's primary peak, chosen the same way the baseline window chooses it: the first peak
  // above the mid-height line. `peaks[0]` would be the first *noise* bump, and its scan region is
  // two cycles of nothing.
  const peak = selectPeak(peaks);
  if (!peak) return null;
  const end = Math.max(1, Math.min(Math.round(peak.baseIndex), values.length - 2));
  const start = 0;
  const curvature = savitzkyGolay(values, 2);
  const best = maxIndexInRange(curvature, start, end);
  if (!(curvature[best]! > 0)) return null;
  const x2 = refineExtremum(curvature, best, 1);
  const x3 = refineExtremum(curvature, best, 2);
  const position = (1 - CFX_THRESHOLD_WEIGHT) * x2 + CFX_THRESHOLD_WEIGHT * x3;
  return valueAt(values, position);
}
