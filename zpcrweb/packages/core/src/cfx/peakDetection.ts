/**
 * `BioRad.Math.PeakDetection` — CFX's peak finder, transcribed.
 *
 * The instrument locates a well's amplification as the *first peak of its first derivative*: the
 * flat baseline contributes nothing, the rise contributes a bump, and where that bump starts and
 * ends become the baseline window (`PeakStartIndex`) and the threshold's scan region. Everything
 * downstream in `CurveAnalysis3` — `RefineMeanBaselineEndCycle`, `CalcInputLeftMaxPosCurvatureCycle`
 * — is a refinement of these two numbers, so getting them right is the gate to matching CFX's Cq at
 * all.
 *
 * Transcribed from `019_BioRad.PCR.Analysis` / `BioRad.Math` (decompiled):
 * `InitalizeData` math.cs:8565, `CalculatePeaks` :8593, `AddRefinedExtremum` :8660,
 * `ExtractPeaks` :8725, `CalculatePeakProperties` :8842, `CalculateLeftPeakCutoff` :8770,
 * `CalculateRightPeakCutoff` :8806, `IsMaximum`/`IsMinimum` :9028/:9070, `RefineExtremum` :9106,
 * `RefineZeroCrossing` :9166. Defaults are the ones `CalculateAutoBeginEndCyclesThreshold` sets:
 * filter width 5, poly order 4, Δx = 1, peak-height threshold 0, merge on.
 */

/** One detected peak: where its derivative maximum sits, and the flat stretches either side. */
export interface CfxPeak {
  /** Refined index of the derivative's maximum — `PeakLocation`. */
  location: number;
  /** Index the peak's rise starts at — `PeakStartIndex`, what the baseline ends on. */
  startIndex: number;
  /** Index the peak's rise is over by — `PeakEndIndex`. */
  endIndex: number;
  /** The first derivative's value at `location` — `PeakHeight`. */
  height: number;
  /** Index of the underlying extremum — `PeakBaseIndex`. */
  baseIndex: number;
}

const FILTER_WIDTH = 5;
const FILTER_POLY_ORDER = 4;
const FLATNESS_VALUE = 0.15;
/** `_SinglePointSideFluctuationFilterRatio` (math.cs:8373) — how small a wiggle must be to vanish. */
const SPF_RATIO = 0.035;
/** `_MergePeakCloseness` (math.cs:8383) — peaks closer than this on x may merge. */
const MERGE_CLOSENESS = 5;
/** `_MergeRelativePeakHeightThreshold` (math.cs:8377). */
const MERGE_HEIGHT_RATIO = 0.05;
/** `_MergeRelativeInnerPeakHeightRatioThreshold` (math.cs:8379) — how deep the dip may be. */
const MERGE_DIP_RATIO = 0.05;
/** 实验开关（只在 Node 测量脚本里用；浏览器里恒为 false 走默认行为）。 */
const flag = (name: string): boolean =>
  typeof process !== "undefined" && process.env?.[name] === "1";
const SPF_ON = !flag("CFX_NO_SPF");
const MERGE_ON = !flag("CFX_NO_MERGE");

/** Coefficients of the polynomial that interpolates `values[center-2 .. center+2]` in local x. */
function localPolynomial(values: number[], center: number): number[] {
  const half = (FILTER_WIDTH - 1) / 2;
  const size = FILTER_POLY_ORDER + 1;
  const a: number[][] = Array.from({ length: size }, () => new Array(size + 1).fill(0));
  for (let i = -half; i <= half; i += 1) {
    const y = values[Math.min(values.length - 1, Math.max(0, center + i))]!;
    const row: number[] = [];
    for (let k = 0; k < size; k += 1) row.push(i ** k);
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) a[r]![c]! += row[r]! * row[c]!;
      a[r]![size]! += row[r]! * y;
    }
  }
  // Gaussian elimination on the normal equations.
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return [0, 0, 0, 0, 0];
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const scale = a[col]![col]!;
    for (let k = col; k <= size; k += 1) a[col]![k] = a[col]![k]! / scale;
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      for (let k = col; k <= size; k += 1) a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
    }
  }
  return a.map((row) => row[size]!);
}

function evaluatePolynomial(coefficients: number[], x: number): number {
  let total = 0;
  for (let k = coefficients.length - 1; k >= 0; k -= 1) total = total * x + coefficients[k]!;
  return total;
}

function derivativePolynomial(coefficients: number[]): number[] {
  const out: number[] = [];
  for (let k = 1; k < coefficients.length; k += 1) out.push(coefficients[k]! * k);
  return out;
}

/** `Polynomial.CalcBracketedRoot` — the first sign change of `f` inside [lo, hi], or -1. */
function bracketedRoot(f: (x: number) => number, lo: number, hi: number, tolerance = 0.001): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return -1;
  for (let i = 0; i < 40 && b - a > tolerance; i += 1) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fa * fm <= 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** `FilterSavitskyGolay.RunFilter(values, order)` for the instrument's fixed 5/4 filter. */
export function sgFilter(values: number[], order: number): number[] {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const coefficients = localPolynomial(values, i);
    let derivative = coefficients;
    for (let d = 0; d < order; d += 1) derivative = derivativePolynomial(derivative);
    out[i] = derivative[0] ?? 0;
  }
  return out;
}

/** `EvaluateFunction` — the local interpolating polynomial evaluated at a fractional index. */
function evaluateAt(values: number[], index: number): number {
  const centre = Math.round(index);
  if (centre < 2 || centre > values.length - 3 || index === centre) return values[centre]!;
  return evaluatePolynomial(localPolynomial(values, centre), index - centre);
}

/** `RefineExtremum` — sub-cycle location of the extremum at `index`, via the derivative's roots. */
function refineExtremum(firstDerivative: number[], index: number): number {
  if (index <= 2 || index >= firstDerivative.length - 3) return index;
  const local = localPolynomial(firstDerivative, index);
  const slope = derivativePolynomial(local);
  const f = (x: number) => evaluatePolynomial(slope, x);
  let forward = -1;
  let backward = -1;
  for (let step = 1; step <= 3; step += 1) {
    const reach = step * 0.25;
    forward = bracketedRoot(f, 0, reach);
    backward = bracketedRoot(f, -reach, 0);
    if (forward !== -1 || backward !== -1) break;
  }
  if (forward === -1 && backward === -1) return index;
  if (forward !== -1 && backward === -1) return index + forward;
  if (forward === -1) return index + backward;
  // Two candidates: a peak keeps the smaller root, a trough the larger.
  const atForward = evaluateAt(firstDerivative, index + forward);
  const atBackward = evaluateAt(firstDerivative, index + backward);
  const isPeak = firstDerivative[index]! > firstDerivative[index - 1]!;
  return index + (isPeak ? (atForward > atBackward ? forward : backward) : atForward > atBackward ? backward : forward);
}

/** Refine a zero crossing of `values` inside [index-1, index], or -1 when there is none. */
function refineZeroCrossing(values: number[], index: number, from: number, to: number): number {
  const a = index - 1;
  const b = index;
  const fa = values[a]!;
  const fb = values[b]!;
  if (fa * fb > 0) return -1;
  const t = (0 - fa) / (fb - fa || 1);
  const crossing = a + t;
  if (crossing < Math.min(from, to) || crossing > Math.max(from, to)) return crossing;
  return crossing;
}

/** `IsLeftSPFPattern` (math.cs:8981) — a one-cycle side wiggle the instrument discards. */
function isLeftSpf(d: number[], i: number): boolean {
  if (i <= 3 || i >= d.length - 4) return false;
  const [a, b, c, plus1, plus2] = [d[i - 2]!, d[i - 1]!, d[i]!, d[i + 1]!, d[i + 2]!];
  return (
    c < b &&
    b < plus1 &&
    b > a &&
    a > d[i - 3]! &&
    plus2 > plus1 &&
    (b - c) / Math.abs(b) < SPF_RATIO
  );
}

/** `IsRightSPFPattern` (math.cs:9013) — the mirror of {@link isLeftSpf}. */
function isRightSpf(d: number[], i: number): boolean {
  if (i <= 3 || i >= d.length - 4) return false;
  const [a, b, c, plus1, plus2] = [d[i - 2]!, d[i - 1]!, d[i]!, d[i + 1]!, d[i + 2]!];
  return (
    b < c &&
    c < a &&
    c > plus1 &&
    a < d[i - 3]! &&
    plus2 < plus1 &&
    (c - b) / Math.abs(c) < SPF_RATIO
  );
}

interface Extremum {
  location: number;
  baseIndex: number;
  isPeak: boolean;
}

/** Every extremum of the curve, in order — the chain `CalcWidthScanRegion` walks. */
function extremalPoints(values: number[]): { extrema: Extremum[]; firstDerivative: number[] } {
  const n = values.length;
  if (n < 9) return { extrema: [], firstDerivative: [] };
  const firstDerivative = sgFilter(values, 1);
  const extrema: Extremum[] = [];
  let prior = 0;
  for (let i = 1; i < n - 1; i += 1) {
    const previous = firstDerivative[i - 1]!;
    const here = firstDerivative[i]!;
    const next = firstDerivative[i + 1]!;
    const isPeak = here > previous && here > next;
    const isTrough = here < previous && here < next;
    if (!isPeak && !isTrough) continue;
    if (SPF_ON && (isLeftSpf(firstDerivative, i) || isRightSpf(firstDerivative, i))) {
      extrema.pop();
      prior = extrema.length === 0 ? 0 : extrema[extrema.length - 1]!.location;
      continue;
    }
    const refined = refineExtremum(firstDerivative, i);
    const location = refined <= prior ? i : refined;
    extrema.push({ location, baseIndex: i, isPeak });
    prior = location;
  }
  return { extrema, firstDerivative };
}

/** `CalcWidthScanRegion(_, LEFT)` needs the extremum before the peak: its base index. */
export function previousExtremumBase(values: number[], before: number): number {
  const { extrema } = extremalPoints(values);
  let base = 0;
  for (const extremum of extrema) {
    if (extremum.baseIndex >= before) break;
    base = extremum.baseIndex;
  }
  return base;
}

/** `CalculatePeaks` reduced to the parts `CurveAnalysis3` reads: the extrema and their peaks. */
export function detectPeaks(values: number[]): CfxPeak[] {
  const n = values.length;
  const { extrema, firstDerivative } = extremalPoints(values);
  if (n < 9 || extrema.length === 0) return [];

  const peaks: CfxPeak[] = [];
  for (let e = 0; e < extrema.length; e += 1) {
    const extremum = extrema[e]!;
    if (!extremum.isPeak) continue;
    const location = extremum.location;
    const leftLimit = e === 0 ? 0 : extrema[e - 1]!.location;
    const rightLimit = e === extrema.length - 1 ? n - 1 : extrema[e + 1]!.location;
    peaks.push({
      location,
      startIndex: leftCutoff(firstDerivative, location, leftLimit),
      endIndex: rightCutoff(firstDerivative, location, rightLimit),
      height: evaluateAt(firstDerivative, location),
      baseIndex: extremum.baseIndex,
    });
  }
  return MERGE_ON ? mergePeaks(peaks, extrema, firstDerivative) : peaks;
}

/**
 * `MergePeakArray` (math.cs:9975) — adjacent peaks of nearly equal height with a shallow dip between
 * them are the same rise split by filter noise; CFX folds them into one. It repeats until no pair
 * qualifies, always merging the pair whose locations are closest (`ScanForBestMergeCandidatePair`).
 */
function mergePeaks(peaks: CfxPeak[], extrema: Extremum[], d: number[]): CfxPeak[] {
  let list = peaks.slice();
  for (let guard = 0; guard < 8; guard += 1) {
    let bestIndex = -1;
    let bestRank = Number.POSITIVE_INFINITY;
    for (let i = 0; i < list.length - 1; i += 1) {
      const left = list[i]!;
      const right = list[i + 1]!;
      const distance = right.location - left.location;
      if (!(distance < MERGE_CLOSENESS)) continue;
      const tall = Math.max(left.height, right.height);
      if (!(tall > 0)) continue;
      const heightRank = (tall - Math.min(left.height, right.height)) / tall;
      if (!(heightRank < MERGE_HEIGHT_RATIO)) continue;
      // The trough between the two peaks, read off the derivative at its own extremum.
      const inner = extrema.find(
        (e) => !e.isPeak && e.baseIndex > left.baseIndex && e.baseIndex < right.baseIndex,
      );
      const dip = inner ? d[inner.baseIndex]! : Math.min(left.height, right.height);
      const short = Math.min(left.height, right.height);
      const dipRank = short === 0 ? 1 : (short - dip) / short;
      if (!(dipRank < MERGE_DIP_RATIO)) continue;
      if (distance < bestRank) {
        bestRank = distance;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const left = list[bestIndex]!;
    const right = list[bestIndex + 1]!;
    // `MergePeakPair` (math.cs:10180): midpoint location, taller height, outer boundaries kept.
    list = [
      ...list.slice(0, bestIndex),
      {
        location: (left.location + right.location) / 2,
        baseIndex: Math.round((left.baseIndex + right.baseIndex) / 2),
        height: Math.max(left.height, right.height),
        startIndex: left.startIndex,
        endIndex: right.endIndex,
      },
      ...list.slice(bestIndex + 2),
    ];
  }
  return list;
}

/** `CalculateLeftPeakCutoff` — back off the previous extremum, stopping where the rise begins. */
function leftCutoff(firstDerivative: number[], location: number, limit: number): number {
  let start = limit;
  const centre = Math.round(location);
  const from = Math.round(start);
  if (centre - from >= 2) {
    if (firstDerivative[from]! < 0) {
      for (let i = from; i <= centre; i += 1) {
        if (firstDerivative[i]! > 0) {
          const crossing = refineZeroCrossing(firstDerivative, i, -1, 0);
          start = crossing === -1 ? i : crossing;
          break;
        }
      }
    }
    const zero = Math.round(start);
    if (centre - zero >= 3) {
      for (let j = zero; j < centre - 1; j += 1) {
        if (firstDerivative[j + 1]! - firstDerivative[j]! > FLATNESS_VALUE) break;
        start = j + 1;
      }
    }
    start = Math.min(start, centre);
  }
  return start;
}

/** `CalculateRightPeakCutoff` — the mirror of {@link leftCutoff}. */
function rightCutoff(firstDerivative: number[], location: number, limit: number): number {
  let end = limit;
  const centre = Math.round(location);
  const to = Math.round(end);
  if (to - centre >= 2) {
    if (firstDerivative[to]! < 0) {
      for (let i = to; i > centre; i -= 1) {
        if (firstDerivative[i]! > 0) {
          const crossing = refineZeroCrossing(firstDerivative, i, 0, 1);
          end = crossing === -1 ? i : crossing;
          break;
        }
      }
    }
    const zero = Math.round(end);
    if (zero - centre >= 3) {
      for (let j = zero; j > centre + 1; j -= 1) {
        if (firstDerivative[j - 1]! - firstDerivative[j]! > FLATNESS_VALUE) break;
        end = j - 1;
      }
    }
    end = Math.max(end, centre);
  }
  return end;
}
