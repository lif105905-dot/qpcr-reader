import { describe, expect, it } from "vitest";
import { applyRefiner, type CqRefineInput } from "../../src/cqMethod.js";
import { computeCq } from "../../src/threshold.js";
import { logTakeoff, LOG_TAKEOFF_MAX_BACK } from "../../src/cqMethods/logTakeoff.js";

/** Deterministic Gaussian noise (mulberry32 + Box–Muller), so the tests never flake. */
function noiseSource(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

const SIGMA = 2;
const THRESHOLD = 20 * SIGMA;
const BACKGROUND = 2000;

/**
 * A baseline-corrected curve built as a logistic of an exponential: `plateau / (1 + plateau /
 * (start·gain^c))`, which is exponential at `start·gain^c` until it nears the plateau — so the
 * exponential's meeting with any level `L` is known exactly: `c = log(L / start) / log(gain)`.
 */
function curve(seed: number, { gain = 1.9, start = 1e-4, sigma = SIGMA, plateau = 3000, n = 45 } = {}): CqRefineInput {
  const next = noiseSource(seed);
  const cycles = Array.from({ length: n }, (_, i) => i + 1);
  const corrected = cycles.map((c) => {
    const exp = start * gain ** c;
    return plateau / (1 + plateau / exp) + sigma * next();
  });
  const thresholdCq = computeCq(cycles, corrected, THRESHOLD);
  return {
    cycles,
    values: corrected.map((v) => v + BACKGROUND),
    corrected,
    baselineFit: { slope: 0, intercept: BACKGROUND },
    baselineRegion: { beginCycle: 3, endCycle: Math.max(8, Math.round(thresholdCq ?? n) - 2) },
    noise: sigma,
    threshold: THRESHOLD,
    thresholdCq: thresholdCq ?? NaN,
  };
}

describe("logTakeoff", () => {
  it("calls a clean exponential earlier than its threshold, where it meets 0.4 × threshold", () => {
    const input = curve(1);
    const cq = logTakeoff(input)!;
    // The exponential reaches 0.4 × 40 = 16 RFU at log(16 / 1e-4) / log(1.9).
    const expected = Math.log(16 / 1e-4) / Math.log(1.9);
    expect(cq).toBeLessThan(input.thresholdCq);
    expect(Math.abs(cq - expected)).toBeLessThan(0.15);
    expect(input.thresholdCq - cq).toBeGreaterThan(1);
  });

  it("keeps replicate precision: twenty noise draws of one curve scatter < 0.1 cycles", () => {
    const cqs = Array.from({ length: 20 }, (_, s) => logTakeoff(curve(100 + s))!);
    const mean = cqs.reduce((a, b) => a + b, 0) / cqs.length;
    const sd = Math.sqrt(cqs.reduce((a, b) => a + (b - mean) ** 2, 0) / (cqs.length - 1));
    expect(sd).toBeLessThan(0.1);
  });

  it("never lands before the curve clears 3σ of its own noise", () => {
    // A noisy well on a quiet plate: its own σ is 4× the group's, so the floor follows its own.
    const input = curve(7, { sigma: 4 * SIGMA });
    input.noise = 4 * SIGMA;
    const cq = logTakeoff(input);
    if (cq != null) {
      const i = input.cycles.findIndex((c) => c >= cq);
      // Every point from the Cq to the threshold crossing is above 3σ, interpolation aside.
      expect(input.corrected[i]!).toBeGreaterThanOrEqual(3 * input.noise);
    }
  });

  it("declines a creeping rise that isn't an exponential (gain below 1.2)", () => {
    const input = curve(3, { gain: 1.12, start: 1 });
    expect(Number.isFinite(input.thresholdCq)).toBe(true);
    expect(logTakeoff(input)).toBeNull();
  });

  it("declines rather than extrapolate further back than LOG_TAKEOFF_MAX_BACK", () => {
    // Gain 1.3 is a real but shallow exponential: 0.4 × threshold is log(2.5)/log(1.3) = 3.5 back.
    const input = curve(4, { gain: 1.3, start: 0.002 });
    expect(Math.log(2.5) / Math.log(1.3)).toBeGreaterThan(LOG_TAKEOFF_MAX_BACK);
    expect(logTakeoff(input)).toBeNull();
  });

  it("declines a flat noise curve that happened to touch its threshold", () => {
    const next = noiseSource(9);
    const cycles = Array.from({ length: 45 }, (_, i) => i + 1);
    const corrected = cycles.map(() => SIGMA * next());
    corrected[30] = THRESHOLD + 1; // one spike
    const input: CqRefineInput = {
      cycles,
      values: corrected.map((v) => v + BACKGROUND),
      corrected,
      baselineFit: { slope: 0, intercept: BACKGROUND },
      baselineRegion: { beginCycle: 3, endCycle: 45 },
      noise: SIGMA,
      threshold: THRESHOLD,
      thresholdCq: computeCq(cycles, corrected, THRESHOLD)!,
    };
    expect(input.thresholdCq).toBeGreaterThan(30);
    expect(logTakeoff(input)).toBeNull();
  });

  it("makes no call where the threshold rule made none", () => {
    const input = curve(5);
    expect(applyRefiner(logTakeoff, { ...input, thresholdCq: null })).toBeNull();
  });
});
