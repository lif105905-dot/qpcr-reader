import { describe, expect, it } from "vitest";
import { applyAdjust, gradeValue, levels, LUT_N, levelKey, lutFor, sampleDisplay } from "../src/image.js";

const ramp = (n = 1000): Float32Array => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 1) a[i] = i / (n - 1);
  return a;
};

describe("image levels", () => {
  it("1%/99% 分位接近 0.01/0.99", () => {
    const lv = levels(ramp());
    expect(Math.abs(lv.black - 0.01)).toBeLessThan(0.02);
    expect(Math.abs(lv.white - 0.99)).toBeLessThan(0.02);
  });

  it("常数图不会除零", () => {
    const lv = levels(new Float32Array(100).fill(0.3));
    expect(lv.white).toBeGreaterThan(lv.black);
  });

  it("空数组给出可用默认", () => {
    expect(levels(new Float32Array(0))).toEqual({ black: 0, white: 1 });
  });
});

describe("image adjust", () => {
  const base = { black: 0.1, white: 0.9 };

  it("亮度滑块把黑白场一起平移、跨度不变", () => {
    const up = applyAdjust(base, 60, 50);
    const down = applyAdjust(base, 40, 50);
    expect((up.black + up.white) / 2).toBeGreaterThan((base.black + base.white) / 2);
    expect((down.black + down.white) / 2).toBeLessThan((base.black + base.white) / 2);
    expect(Math.round((up.white - up.black) * 1000)).toBe(Math.round((base.white - base.black) * 1000));
  });

  it("对比度滑块改变跨度", () => {
    const wide = applyAdjust(base, 50, 80);
    const narrow = applyAdjust(base, 50, 20);
    expect(wide.white - wide.black).toBeLessThan(base.white - base.black);
    expect(narrow.white - narrow.black).toBeGreaterThan(base.white - base.black);
  });
});

describe("image lut", () => {
  it("两端夹紧、反相翻转", () => {
    const lut = lutFor(0.2, 0.8, false);
    expect(lut).toHaveLength(LUT_N + 1);
    expect(lut[0]).toBe(0);
    expect(lut[LUT_N]).toBe(255);
    expect(lut[Math.round(0.5 * 4096)]).toBe(127);
    const inv = lutFor(0.2, 0.8, true);
    expect(inv[0]).toBe(255);
    expect(inv[LUT_N]).toBe(0);
  });

  it("gamma < 1 提亮中间调", () => {
    const plain = lutFor(0, 1, false, 1)[2048]!;
    const lifted = lutFor(0, 1, false, 0.5)[2048]!;
    expect(lifted).toBeGreaterThan(plain);
  });

  it("gradeValue 与 LUT 一致（±1 量化误差）", () => {
    const black = 0.15;
    const white = 0.65;
    const lut = lutFor(black, white, false);
    for (const v of [0, 0.15, 0.4, 0.65, 1]) {
      const want = Math.round(gradeValue(v, black, white, false) * 255);
      expect(Math.abs(lut[(v * 4096) | 0]! - want)).toBeLessThanOrEqual(1);
    }
  });

  it("levelKey 稳定且随参数变化", () => {
    expect(levelKey(0.1, 0.9, false, 1)).toBe(levelKey(0.1, 0.9, false, 1));
    expect(levelKey(0.1, 0.9, true, 1)).not.toBe(levelKey(0.1, 0.9, false, 1));
    expect(levelKey(0.1, 0.9, false, 0.8)).not.toBe(levelKey(0.1, 0.9, false, 1));
  });
});

describe("sampleDisplay", () => {
  // `img.data` 是 0..1 的归一化灰度（原实现在 LUT 里按 `v*4096` 取索引），不是 0..255。
  const img = { width: 4, height: 2, data: [0, 0.25, 0.5, 1, 0, 0.25, 0.5, 1] };

  it("输出 RGBA、尺寸与最长边限制", () => {
    const out = sampleDisplay(img, { black: 0, white: 1 }, 4096);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect(out.rgba).toHaveLength(4 * 2 * 4);
    expect(out.rgba[0]).toBe(0);
    expect(out.rgba[3]).toBe(255);
    expect(out.rgba[3 * 4]).toBe(255);
  });

  it("按 maxSide 等比缩小", () => {
    const big = { width: 100, height: 50, data: new Float32Array(5000) };
    const out = sampleDisplay(big, { black: 0, white: 1 }, 10);
    expect(out.width).toBe(10);
    expect(out.height).toBe(5);
  });
});
