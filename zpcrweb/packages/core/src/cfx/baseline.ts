import { detectPeaks, type CfxPeak } from "./peakDetection.js";

/**
 * CFX 的自动基线（CurveAnalysis3.CalculateAutoBeginEndCyclesThreshold + PeakDetection）。
 *
 * 反编译自 Bio-Rad.PCR.Analysis 2013-08-23：
 *  - 起点固定是 2（与 .pcrd 里写的 baselineBeginRepeat 一致）；
 *  - 终点由峰检测给出：先在第一导数上找极值、拼成峰，再用 MeanMinMaxThreshold
 *    选出"第一个高度超过中位阈值"的峰，取它的 PeakStartIndex，交给
 *    RefineMeanBaselineEndCycle 二分收缩到平坦段结束。
 */

const FLATNESS_BOUND = 0.035;
const LINEARITY_BOUND = 0.03;
const SCAN_RIGHT_RATIO = 0.0085;
const BASELINE_BEGIN = 0;

function mean(values: number[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to && i < values.length; i++) {
    sum += values[i]!;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

function linearFit(xs: number[], ys: number[]) {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
    sxx += xs[i]! * xs[i]!;
    sxy += xs[i]! * ys[i]!;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let residual = 0;
  for (let i = 0; i < n; i++) {
    const diff = ys[i]! - (intercept + slope * xs[i]!);
    residual += diff * diff;
  }
  return { slope, intercept, residualsStdDev: Math.sqrt(residual / n) };
}

/** CFX 的 PeakArrayPostProcessor.SetMeanMinMaxThresholdMethod()：留高度超过 min+0.5(max−min) 的峰。 */
export function filterPeaks(peaks: CfxPeak[]): CfxPeak[] {
  if (peaks.length <= 1) return [...peaks];
  const heights = peaks.map((p) => p.height);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  const threshold = lo + 0.5 * (hi - lo);
  return peaks.filter((peak) => peak.height > threshold);
}

export function selectPeak(peaks: CfxPeak[]): CfxPeak | null {
  if (peaks.length === 0) return null;
  if (peaks.length === 1) return peaks[0]!;
  return filterPeaks(peaks)[0] ?? peaks[0]!;
}

function testSubRegionHorizontal(values: number[], start: number, end: number) {
  const mid = Math.floor((start + end) / 2);
  const leftMean = Math.abs(mean(values, start, mid));
  const rightMean = Math.abs(mean(values, mid, end));
  const span = Math.max(1, Math.max(...values) - Math.min(...values));
  const relative = Math.abs(leftMean - rightMean) / span;
  return { horizontal: relative < FLATNESS_BOUND, newMean: (leftMean + rightMean) / 2 };
}

function scanRight(values: number[], start: number, end: number, reference: number): number {
  const span = Math.abs(Math.max(...values) - Math.min(...values));
  const limit = Math.min(values.length - 1, end + 10);
  let index = start;
  for (; index < limit; index++) {
    const pair = (values[index]! + values[index + 1]!) / 2;
    if ((pair - reference) / span > SCAN_RIGHT_RATIO) break;
  }
  return index - 1;
}

function refineEnd(values: number[], start: number, end: number, fallback: number): number | null {
  if (mean(values, start, end) < 0) return Math.max(start, end - 2);
  const xs = values.map((_, i) => i);
  let cursor = end;
  for (let pass = 0; pass < 5; pass++) {
    const mid = Math.floor((start + cursor) / 2);
    const test = testSubRegionHorizontal(values, start, cursor);
    if (test.horizontal || cursor < 8) return scanRight(values, cursor, end, test.newMean);
    const fit = linearFit(xs.slice(start, cursor), values.slice(start, cursor));
    if (fit.residualsStdDev < LINEARITY_BOUND * mean(values, start, cursor)) {
      return Math.max(start, cursor - 2);
    }
    cursor = fallback <= mid || pass !== 0 ? mid : fallback;
  }
  return null;
}

export interface CfxBaselineWindow {
  beginCycle: number;
  endCycle: number;
  peak: CfxPeak | null;
}

/** 复刻 CFX 的自动基线终点：峰起点 → 二分收缩到平坦段结束。 */
export function cfxBaselineWindow(values: number[]): CfxBaselineWindow {
  const peaks = detectPeaks(values);
  const selected = selectPeak(peaks);
  if (!selected) {
    return { beginCycle: BASELINE_BEGIN, endCycle: Math.min(8, values.length - 1), peak: null };
  }
  const start = Math.max(BASELINE_BEGIN + 3, Math.round(selected.startIndex));
  const previous = peaks.filter((p) => p.baseIndex < selected.baseIndex).pop() ?? null;
  const fallback = previous ? Math.round(previous.startIndex) : -1;
  const refined = refineEnd(values, BASELINE_BEGIN, start, fallback);
  return {
    beginCycle: BASELINE_BEGIN,
    endCycle: refined ?? Math.min(8, values.length - 1),
    peak: selected,
  };
}

export interface CfxBaseline {
  beginCycle: number;
  endCycle: number;
  slope: number;
  intercept: number;
  corrected: number[];
}

/** 按 CFX 的口径扣基线：在 [begin, end] 上做一次线性最小二乘。 */
export function cfxBaselineCorrect(values: number[]): CfxBaseline {
  const window = cfxBaselineWindow(values);
  const end = Math.max(window.beginCycle + 1, Math.min(window.endCycle, values.length - 1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = window.beginCycle; i <= end; i++) {
    xs.push(i);
    ys.push(values[i]!);
  }
  const fit = linearFit(xs, ys);
  return {
    beginCycle: window.beginCycle,
    endCycle: end,
    slope: fit.slope,
    intercept: fit.intercept,
    corrected: values.map((v, i) => v - (fit.intercept + fit.slope * i)),
  };
}
