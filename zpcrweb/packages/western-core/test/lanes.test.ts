import { describe, expect, it } from "vitest";
import { evenCenters, linkedMove, MIN_GAP, moveCenter, nearestLane, setCount } from "../src/lanes.js";

describe("lanes", () => {
  it("evenCenters 均匀铺满 0..1", () => {
    expect(evenCenters(2)).toEqual([0.25, 0.75]);
    const five = evenCenters(5);
    expect(five[0]).toBeCloseTo(0.1, 10);
    expect(five[4]).toBeCloseTo(0.9, 10);
    expect(evenCenters(0)).toEqual([]);
  });

  it("setCount 改条数、重排中线、补齐名字", () => {
    const doc = { laneCount: 2, laneCenters: [], laneNames: ["A"] };
    setCount(doc, 3);
    expect(doc.laneCount).toBe(3);
    expect(doc.laneCenters).toEqual(evenCenters(3));
    expect(doc.laneNames).toEqual(["A", "2", "3"]);
  });

  it("moveCenter 夹在邻居之间", () => {
    const out = moveCenter([0.2, 0.5, 0.8], 1, 0.1);
    expect(out[1]).toBeCloseTo(0.2 + MIN_GAP, 10);
    const far = moveCenter([0.2, 0.5, 0.8], 1, 0.99);
    expect(far[1]).toBeCloseTo(0.8 - MIN_GAP, 10);
  });

  it("moveCenter 之后不重叠", () => {
    const out = moveCenter([0.2, 0.21, 0.22], 2, 0.2);
    for (let i = 1; i < out.length; i += 1) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]! + MIN_GAP - 1e-12);
  });

  it("linkedMove 拖首尾重排中间", () => {
    const out = linkedMove([0.2, 0.5, 0.8], 2, 0.9);
    expect(out[0]).toBeCloseTo(0.2, 10);
    expect(out[2]).toBeCloseTo(0.9, 10);
    expect(out[1]).toBeCloseTo(0.55, 10);
  });

  it("nearestLane 取最近的一根", () => {
    expect(nearestLane([0.1, 0.5, 0.9], 0.52)).toBe(1);
    expect(nearestLane([], 0.5)).toBe(-1);
  });
});
