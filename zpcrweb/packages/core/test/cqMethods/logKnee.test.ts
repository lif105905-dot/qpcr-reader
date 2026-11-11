import { describe, expect, it } from "vitest";
import { applyRefiner, type CqRefineInput } from "../../src/cqMethod.js";
import { logKnee, makeLogKnee } from "../../src/cqMethods/logKnee.js";
import { computeCq } from "../../src/threshold.js";

/** Deterministic pseudo-random normal noise (LCG + Box–Muller). */
function noiseSeries(n: number, sigma: number, seed: number): number[] {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 1) / 4294967297;
  return Array.from({ length: n }, () => sigma * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
}

/** A corrected curve: logistic in log space (exponential then plateau), plus noise. */
function curve(opts: { n?: number; mid?: number; plateau?: number; eff?: number; sigma?: number; seed?: number }) {
  const { n = 45, mid = 28, plateau = 4000, eff = 0.9, sigma = 2, seed = 1 } = opts;
  const cycles = Array.from({ length: n }, (_, i) => i + 1);
  const k = Math.log(1 + eff);
  const noise = noiseSeries(n, sigma, seed);
  const corrected = cycles.map((c, i) => plateau / (1 + Math.exp(-k * (c - mid))) + noise[i]!);
  return { cycles, corrected, sigma };
}

function inputFor(c: ReturnType<typeof curve>, threshold: number): CqRefineInput | null {
  const thresholdCq = computeCq(c.cycles, c.corrected, threshold);
  if (thresholdCq == null) return null;
  return {
    cycles: c.cycles,
    values: c.corrected.map((v) => v + 1000),
    corrected: c.corrected,
    baselineFit: { slope: 0, intercept: 1000 },
    baselineRegion: { beginCycle: 3, endCycle: Math.round(thresholdCq) - 2 },
    noise: c.sigma,
    threshold,
    thresholdCq,
  };
}

describe("logKnee", () => {
  it("backs a clean sigmoid up towards where it leaves the noise, never past its 3σ rise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const c = curve({ seed });
      const input = inputFor(c, 40)!;
      const cq = applyRefiner(logKnee, input)!;
      expect(cq).toBeLessThan(input.thresholdCq - 0.5);
      expect(input.thresholdCq - cq).toBeLessThanOrEqual(4);
      // Never before the curve has risen through 3σ (with linear interpolation).
      const i = c.cycles.findIndex((x) => x >= cq);
      expect(c.corrected[i]!).toBeGreaterThanOrEqual(3 * c.sigma);
    }
  });

  it("reports the same Cq for noiseless replicates, and moves with them", () => {
    const a = applyRefiner(logKnee, inputFor(curve({ sigma: 1e-6, mid: 25 }), 40)!)!;
    const b = applyRefiner(logKnee, inputFor(curve({ sigma: 1e-6, mid: 28 }), 40)!)!;
    expect(b - a).toBeCloseTo(3, 1);
  });

  it("keeps the threshold Cq where there is no knee in reach", () => {
    const c = curve({ seed: 3 });
    const input = inputFor(c, 40)!;
    // A zero-cycle search window holds no corner.
    expect(makeLogKnee({ maxBackCycles: 0 })(input)).toBeNull();
    expect(applyRefiner(makeLogKnee({ maxBackCycles: 0 }), input)).toBe(input.thresholdCq);
  });

  it("uses group-shared levels: a noisier replicate does not move its Cq", () => {
    // Same curve, its σ estimate 3× apart — the two replicates should agree, since floor and
    // guard come from the shared threshold (the σ gate sits below the guard here).
    const input = inputFor(curve({ sigma: 1e-6, mid: 26 }), 40)!;
    const quiet = applyRefiner(logKnee, { ...input, noise: 1 })!;
    const noisy = applyRefiner(logKnee, { ...input, noise: 3 })!;
    expect(noisy).toBeCloseTo(quiet, 6);
    expect(quiet).toBeLessThan(input.thresholdCq - 1);
  });

  it("never makes a call on a flat negative", () => {
    const c = curve({ plateau: 0, seed: 7 });
    expect(inputFor(c, 40)).toBeNull();
    expect(
      applyRefiner(logKnee, {
        cycles: c.cycles,
        values: c.corrected,
        corrected: c.corrected,
        baselineFit: { slope: 0, intercept: 0 },
        baselineRegion: { beginCycle: 3, endCycle: 45 },
        noise: c.sigma,
        threshold: 40,
        thresholdCq: null,
      }),
    ).toBeNull();
  });

  it("returns null for degenerate input", () => {
    const c = curve({ seed: 2 });
    const input = inputFor(c, 40)!;
    expect(logKnee({ ...input, threshold: 0 })).toBeNull();
    expect(logKnee({ ...input, cycles: input.cycles.slice(0, 5), corrected: input.corrected.slice(0, 5) })).toBeNull();
  });
});
