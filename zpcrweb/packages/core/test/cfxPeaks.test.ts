import { describe, expect, it } from "vitest";
import { cfxBaselineCorrect, cfxBaselineWindow } from "../src/cfx/baseline.js";
import { detectPeaks, sgFilter } from "../src/cfx/peakDetection.js";

/** 合成一条 CFX 形状的扩增曲线：平段 + 指数上升 + 平台。 */
function amplificationCurve(points = 41, options: { baseline?: number; noise?: number } = {}) {
  const baseline = options.baseline ?? 3300;
  const noise = options.noise ?? 3;
  const values: number[] = [];
  for (let i = 0; i < points; i++) {
    const rise = 4200 / (1 + Math.exp(-0.75 * (i - 22)));
    const wobble = noise * Math.sin(i * 1.7);
    values.push(baseline + 6 * i + rise + wobble);
  }
  return values;
}

describe("detectPeaks", () => {
  it("finds the rise as a peak whose start sits in the flat part", () => {
    const peaks = detectPeaks(amplificationCurve());
    expect(peaks.length).toBeGreaterThan(0);
    const main = peaks.reduce((a, b) => (a.height >= b.height ? a : b));
    expect(main.height).toBeGreaterThan(50);
    // 上升段最陡处大约在 22 附近，起点更早
    expect(main.location).toBeGreaterThan(17);
    expect(main.location).toBeLessThan(27);
    expect(main.startIndex).toBeLessThan(main.location);
    expect(main.endIndex).toBeGreaterThan(main.location);
  });

  it("returns nothing for a curve too short to filter", () => {
    expect(detectPeaks([1, 2, 3])).toEqual([]);
  });

  it("keeps a flat curve free of large peaks", () => {
    const flat = Array.from({ length: 41 }, (_, i) => 3300 + (i % 2 === 0 ? 1 : -1));
    const peaks = detectPeaks(flat);
    for (const peak of peaks) expect(Math.abs(peak.height)).toBeLessThan(50);
  });
});

describe("sgFilter", () => {
  it("smooths a straight line without moving it", () => {
    const line = Array.from({ length: 21 }, (_, i) => 10 + 3 * i);
    const smoothed = sgFilter(line, 0);
    for (let i = 2; i < line.length - 2; i++) {
      expect(smoothed[i]!).toBeCloseTo(line[i]!, 6);
    }
  });

  it("returns the slope for order 1", () => {
    const line = Array.from({ length: 21 }, (_, i) => 5 + 2.5 * i);
    const derivative = sgFilter(line, 1);
    expect(derivative[10]!).toBeCloseTo(2.5, 4);
  });
});

describe("cfxBaselineCorrect", () => {
  it("ends the window before the rise and flattens the baseline", () => {
    const values = amplificationCurve();
    const baseline = cfxBaselineCorrect(values);
    expect(baseline.beginCycle).toBe(0);
    expect(baseline.endCycle).toBeGreaterThanOrEqual(3);
    expect(baseline.endCycle).toBeLessThan(20);
    // 校正后前几个循环接近 0
    for (let i = baseline.beginCycle; i <= baseline.endCycle; i++) {
      expect(Math.abs(baseline.corrected[i]!)).toBeLessThan(120);
    }
    // 平台仍然很高
    expect(baseline.corrected.at(-1)!).toBeGreaterThan(2000);
  });

  it("reports a window even for a flat well", () => {
    const flat = Array.from({ length: 41 }, () => 3300);
    const window = cfxBaselineWindow(flat);
    expect(window.beginCycle).toBe(0);
    expect(window.endCycle).toBeGreaterThan(0);
  });
});
