import { describe, expect, it } from "vitest";
import { applyRefiner, type CqRefineInput } from "../../src/cqMethod.js";
import { computeCq } from "../../src/threshold.js";
import {
  fitLogistic,
  logistic,
  sigmoidFit,
  sigmoidFitWith,
  SIGMOID_FIT_PARAMS,
} from "../../src/cqMethods/sigmoidFit.js";

/** Deterministic Gaussian noise (LCG + Box–Muller), so the tests never flake. */
function noiseSource(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** A synthetic baseline-corrected curve: logistic signal plus white noise σ, with the threshold
 * at `thresholdSigmas`·σ and the threshold Cq taken by the real crossing rule. */
function curve(opts: {
  A?: number;
  c0?: number;
  b?: number;
  sigma?: number;
  thresholdSigmas?: number;
  seed?: number;
  n?: number;
  signal?: (c: number) => number;
}): Omit<CqRefineInput, "thresholdCq"> & { thresholdCq: number | null } {
  const { A = 5000, c0 = 28, b = 1.6, sigma = 3, thresholdSigmas = 20, seed = 1, n = 45 } = opts;
  const rnd = noiseSource(seed);
  const cycles = Array.from({ length: n }, (_, i) => i + 1);
  const signal = opts.signal ?? ((c: number) => A / (1 + Math.exp(-(c - c0) / b)));
  const corrected = cycles.map((c) => signal(c) + sigma * rnd());
  const threshold = thresholdSigmas * sigma;
  const thresholdCq = computeCq(cycles, corrected, threshold);
  return {
    cycles,
    values: corrected.map((v) => v + 5000),
    corrected,
    baselineFit: { intercept: 5000, slope: 0 },
    baselineRegion: { beginCycle: 3, endCycle: thresholdCq == null ? n : Math.round(thresholdCq) - 2 },
    noise: sigma,
    threshold,
    thresholdCq,
  };
}

describe("fitLogistic", () => {
  it("recovers the parameters of a noise-free logistic", () => {
    const xs = Array.from({ length: 30 }, (_, i) => i + 5);
    const truth = [2, 4000, 25, 1.7];
    const ys = xs.map((c) => logistic(truth, c));
    const p = fitLogistic(xs, ys, xs.map(() => 1), [0, 5000, 23, 1.5])!;
    expect(p[1]).toBeCloseTo(4000, 0);
    expect(p[2]).toBeCloseTo(25, 3);
    expect(p[3]).toBeCloseTo(1.7, 3);
  });
});

describe("sigmoidFit", () => {
  it("calls a clean sigmoid earlier than the threshold, near where the signal reaches 0.6·T", () => {
    const input = curve({});
    const thr = input.thresholdCq!;
    const cq = sigmoidFit(input as CqRefineInput)!;
    expect(cq).not.toBeNull();
    expect(cq).toBeLessThan(thr - 0.5);
    // For S ≈ A·e^{(c−c0)/b} the knee of ln(B + S) sits where S = B, here 0.6 × (20 × 3 RFU).
    const expected = 28 - 1.6 * Math.log(5000 / 36 - 1);
    expect(Math.abs(cq - expected)).toBeLessThan(0.5);
  });

  it("is stable across noise realisations of the same curve", () => {
    const cqs = [1, 2, 3, 4, 5, 6].map((seed) => sigmoidFit(curve({ seed }) as CqRefineInput)!);
    expect(cqs.every((c) => c != null)).toBe(true);
    expect(Math.max(...cqs) - Math.min(...cqs)).toBeLessThan(0.5);
  });

  it("keeps the threshold Cq for a weak curve that barely clears its threshold", () => {
    const input = curve({ A: 70, sigma: 3, thresholdSigmas: 10 });
    expect(input.thresholdCq).not.toBeNull();
    expect(sigmoidFit(input as CqRefineInput)).toBeNull();
  });

  it("keeps the threshold Cq for a linear drift, which is not a sigmoid", () => {
    const input = curve({ signal: (c) => Math.max(0, c - 20) * 8, sigma: 2 });
    expect(input.thresholdCq).not.toBeNull();
    const reasons: string[] = [];
    const cq = sigmoidFitWith(input as CqRefineInput, {
      ...SIGMOID_FIT_PARAMS,
      onReject: (r) => reasons.push(r),
    });
    // Either the fit is rejected outright, or it stays within a cycle of the crossing.
    if (cq != null) expect(input.thresholdCq! - cq).toBeLessThan(1);
    else expect(reasons.length).toBe(1);
  });

  it("never moves a Cq later, and never invents one, through the contract", () => {
    const negative = curve({ A: 0 });
    expect(applyRefiner(sigmoidFit, negative)).toBe(negative.thresholdCq);
    const input = curve({ seed: 7 });
    const cq = applyRefiner(sigmoidFit, input)!;
    expect(cq).toBeLessThanOrEqual(input.thresholdCq!);
  });
});
