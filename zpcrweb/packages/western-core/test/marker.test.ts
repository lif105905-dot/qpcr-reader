import { describe, expect, it } from "vitest";
import { assignSizes, formatKDa, formatLabel, interpolator } from "../src/marker.js";

describe("marker", () => {
  it("按 y 排序后依次配分子量", () => {
    const pts = [
      { x: 0, y: 300 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ];
    expect(assignSizes(pts, [180, 130, 100])).toEqual([
      { y: 100, lane: undefined, kDa: 180 },
      { y: 200, lane: undefined, kDa: 130 },
      { y: 300, lane: undefined, kDa: 100 },
    ]);
  });

  it("超出 ladder 长度的点丢弃", () => {
    expect(assignSizes([{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }], [50, 40])).toHaveLength(2);
  });

  it("格式化：bp 取整、kDa 一位小数", () => {
    expect(formatLabel(100.4, "bp")).toBe("100");
    expect(formatLabel(55.55, "kDa")).toBe("55.6");
    expect(formatKDa(70)).toBe("70");
    expect(formatLabel(NaN, "kDa")).toBe("");
  });

  it("插值两端延伸、中间按对数线性", () => {
    const f = interpolator([
      { y: 100, kDa: 100 },
      { y: 200, kDa: 10 },
    ]);
    expect(f).not.toBeNull();
    expect(f!(50)).toBe(100);
    expect(f!(250)).toBe(10);
    // 几何中点：log10 均分 → 10^1.5 ≈ 31.6
    expect(f!(150)).toBeCloseTo(Math.sqrt(100 * 10), 6);
  });

  it("少于两点没有插值器", () => {
    expect(interpolator([])).toBeNull();
    expect(interpolator([{ y: 1, kDa: 10 }])).toBeNull();
  });
});
