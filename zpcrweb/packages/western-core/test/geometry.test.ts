import { describe, expect, it } from "vitest";
import { cropClamp, cropToPixels, isFullCrop, MIN_SIDE, rotatedSize } from "../src/transform.js";

describe("transform", () => {
  it("旋转 0° 尺寸不变", () => {
    expect(rotatedSize(1600, 1100, 0)).toEqual({ w: 1600, h: 1100 });
  });

  it("旋转 90° 宽高互换", () => {
    expect(rotatedSize(1600, 1100, 90)).toEqual({ w: 1100, h: 1600 });
  });

  it("旋转 45° 取外接框", () => {
    const s = rotatedSize(100, 100, 45);
    expect(s.w).toBe(Math.ceil(100 * Math.SQRT2));
    expect(s.h).toBe(Math.ceil(100 * Math.SQRT2));
  });

  it("裁切框被夹在 0..1 内", () => {
    const c = cropClamp({ x: -0.2, y: 0.5, w: 0.5, h: 0.9 }, 1600, 1100);
    expect(c.x).toBe(0);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.w).toBeGreaterThan(0);
    expect(c.w).toBeLessThanOrEqual(1);
  });

  it("裁切框有最小尺寸", () => {
    const c = cropClamp({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 1600, 1100);
    expect(c.w).toBeGreaterThanOrEqual(MIN_SIDE / 1600 - 1e-9);
    expect(c.h).toBeGreaterThanOrEqual(MIN_SIDE / 1100 - 1e-9);
  });

  it("归一化 → 像素整数矩形", () => {
    expect(cropToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1600, 1100)).toEqual({
      x: 400,
      y: 550,
      w: 800,
      h: 275,
    });
  });

  it("isFullCrop 认整张、不认裁过的", () => {
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });
});
