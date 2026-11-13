import { describe, expect, it } from "vitest";
import {
  fit,
  handlePoints,
  hitTest,
  resizeRect,
  toImage,
  toNorm,
  toScreen,
  transform,
} from "../src/canvasmath.js";

describe("canvasmath.fit", () => {
  it("横向图按宽度贴合，居中", () => {
    const f = fit(1600, 1100, 1000, 800, 24);
    const w = 1600 * f.scale;
    const h = 1100 * f.scale;
    expect(Math.abs(f.dx + w / 2 - 500)).toBeLessThan(1e-6);
    expect(Math.abs(f.dy + h / 2 - 400)).toBeLessThan(1e-6);
  });

  it("极端视图不出现 NaN/Infinity", () => {
    const f = fit(100, 100, 10, 10, 24);
    expect(Number.isFinite(f.scale)).toBe(true);
    expect(f.scale).toBeGreaterThan(0);
  });
});

describe("坐标往返", () => {
  it("toImage 是 toScreen 的逆运算", () => {
    const t = transform(fit(1600, 1100, 1000, 800), 1.7, 30, -20);
    const p = { x: 640, y: 420 };
    const back = toImage(toScreen(p, t), t);
    expect(Math.abs(back.x - p.x)).toBeLessThan(1e-6);
    expect(Math.abs(back.y - p.y)).toBeLessThan(1e-6);
  });
});

describe("命中测试", () => {
  const rect = { x: 100, y: 100, w: 400, h: 200 };

  it("角点命中", () => {
    expect(hitTest(rect, { x: 100, y: 100 }, 8)).toBe("nw");
    expect(hitTest(rect, { x: 500, y: 300 }, 8)).toBe("se");
  });

  it("边中点命中", () => {
    expect(hitTest(rect, { x: 300, y: 100 }, 8)).toBe("n");
    expect(hitTest(rect, { x: 500, y: 200 }, 8)).toBe("e");
  });

  it("内部是 move，外部是 null", () => {
    expect(hitTest(rect, { x: 300, y: 200 }, 8)).toBe("move");
    expect(hitTest(rect, { x: 50, y: 50 }, 8)).toBeNull();
  });

  it("旋转把手优先于其它命中", () => {
    expect(hitTest(rect, { x: 301, y: 81 }, 8, { x: 300, y: 80 })).toBe("rotate");
  });
});

describe("拖拽改写矩形", () => {
  const rect = { x: 100, y: 100, w: 400, h: 200 };

  it("拖右下角变大", () => {
    expect(resizeRect(rect, "se", { x: 600, y: 400 }, 8)).toEqual({ x: 100, y: 100, w: 500, h: 300 });
  });

  it("拖过左上角时保持最短边", () => {
    const r = resizeRect(rect, "nw", { x: 900, y: 900 }, 8);
    expect(r.w).toBeGreaterThanOrEqual(8);
    expect(r.h).toBeGreaterThanOrEqual(8);
  });

  it("八个把手位置", () => {
    const p = handlePoints(rect);
    expect(p.nw).toEqual({ x: 100, y: 100 });
    expect(p.e).toEqual({ x: 500, y: 200 });
    expect(p.s).toEqual({ x: 300, y: 300 });
  });

  it("归一化并夹在 0..1", () => {
    expect(toNorm({ x: -50, y: 100, w: 500, h: 200 }, 400, 400)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
  });
});
