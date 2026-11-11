import { describe, it, expect } from "vitest";
import {
  applyRefiner,
  computeCqTable,
  CQ_METHODS,
  parseZpcrwebSettingsJson,
  type CqRefineInput,
  type CqTableCurve,
} from "../src/index.js";

/** A sigmoid on a sloped background, with deterministic jitter. */
function curve(cq: number | null, n = 40): number[] {
  const out: number[] = [];
  for (let c = 1; c <= n; c++) {
    const jitter = 3 * Math.sin(c * 12.9898) * Math.cos(c * 78.233);
    const amp = cq == null ? 0 : 3000 / (1 + Math.exp(-(c - (cq + 4)) / 1.6));
    out.push(1000 + 2 * c + jitter + amp);
  }
  return out;
}

const cycles = Array.from({ length: 40 }, (_, i) => i + 1);
const curves: CqTableCurve[] = [
  { key: "pos", group: "FAM", cycles, values: curve(20) },
  { key: "neg1", group: "FAM", cycles, values: curve(null) },
  { key: "neg2", group: "FAM", cycles, values: curve(null) },
];

describe("Cq methods", () => {
  it("the default is the threshold crossing, and reports it unchanged", () => {
    expect(CQ_METHODS[0]!.id).toBe("threshold");
    const table = computeCqTable(curves);
    const pos = table.get("pos")!;
    expect(pos.cq).not.toBeNull();
    expect(pos.cq).toBe(pos.thresholdCq);
  });

  it("every registered method keeps the plate's calls and never reports later", () => {
    const base = computeCqTable(curves);
    for (const m of CQ_METHODS) {
      const table = computeCqTable(curves, { cqMethod: m.id });
      for (const [key, entry] of table) {
        const ref = base.get(key)!;
        // Nothing upstream of the reported number moves.
        expect(entry.thresholdCq).toBe(ref.thresholdCq);
        expect(entry.threshold).toBe(ref.threshold);
        expect(entry.baselineRegion).toEqual(ref.baselineRegion);
        expect(entry.endRfu).toBe(ref.endRfu);
        if (ref.thresholdCq == null) expect(entry.cq).toBeNull();
        else expect(entry.cq!).toBeLessThanOrEqual(ref.thresholdCq);
      }
    }
  });

  it("applyRefiner enforces the contract on a misbehaving refiner", () => {
    const input = {
      cycles,
      values: curve(20),
      corrected: curve(20),
      baselineFit: { slope: 0, intercept: 0 },
      baselineRegion: { beginCycle: 3, endCycle: 18 },
      noise: 1,
      threshold: 100,
    } as Omit<CqRefineInput, "thresholdCq">;
    expect(applyRefiner(() => 5, { ...input, thresholdCq: null })).toBeNull();
    expect(applyRefiner(() => 30, { ...input, thresholdCq: 20 })).toBe(20);
    expect(applyRefiner(() => 1, { ...input, thresholdCq: 20 })).toBe(20);
    expect(applyRefiner(() => NaN, { ...input, thresholdCq: 20 })).toBe(20);
    expect(applyRefiner(() => null, { ...input, thresholdCq: 20 })).toBe(20);
    expect(applyRefiner(() => { throw new Error("boom"); }, { ...input, thresholdCq: 20 })).toBe(20);
    expect(applyRefiner(() => 18.5, { ...input, thresholdCq: 20 })).toBe(18.5);
  });

  it("zpcrweb.json keeps a known method and drops an unknown one", () => {
    const id = CQ_METHODS.at(-1)!.id;
    expect(parseZpcrwebSettingsJson(JSON.stringify({ version: 1, analysis: { cqMethod: id } }))?.analysis)
      .toEqual({ cqMethod: id });
    expect(
      parseZpcrwebSettingsJson(JSON.stringify({ version: 1, analysis: { cqMethod: "nope", thresholdMultiplier: 5 } }))
        ?.analysis,
    ).toEqual({ thresholdMultiplier: 5 });
  });
});
