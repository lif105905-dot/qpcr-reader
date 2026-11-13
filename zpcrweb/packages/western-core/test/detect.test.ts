import { describe, expect, it } from "vitest";
import { detectAngle, detectLanes, toEngine, type EngineImage, type WesternEngine } from "../src/detect.js";

const img = { width: 1000, height: 500, data: [0, 1, 2] };

/** 桩引擎：记录被问到的矩形，返回固定的泳道。 */
function stubEngine(overrides: Partial<WesternEngine> = {}): WesternEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    cropImg(i: EngineImage, rect) {
      calls.push(`crop ${rect.x},${rect.y},${rect.w},${rect.h}`);
      return i;
    },
    detectBright() {
      calls.push("bright");
      return true;
    },
    detectLanes() {
      calls.push("lanes");
      return { centers: [0, 500, 999], pitch: 250 };
    },
    downsample(i: EngineImage) {
      calls.push("downsample");
      return i;
    },
    deskew(_i, bright) {
      calls.push(`deskew ${bright}`);
      return 2.5;
    },
    ...overrides,
  } as WesternEngine & { calls: string[] };
}

describe("detect", () => {
  it("没有引擎或图片时返回空", () => {
    expect(detectLanes(null, img)).toBeNull();
    expect(detectLanes(stubEngine(), null)).toBeNull();
    expect(detectAngle(null, img)).toBe(0);
  });

  it("泳道中线换算回整张图的归一化坐标", () => {
    const r = detectLanes(stubEngine(), img);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(3);
    expect(r!.centers[1]).toBeCloseTo(0.5, 10);
    expect(r!.pitchPx).toBe(250);
    expect(r!.bright).toBe(true);
  });

  it("裁切矩形按像素喂给引擎，坐标再折算回来", () => {
    const e = stubEngine();
    const r = detectLanes(e, img, { x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(e.calls[0]).toBe("crop 250,0,500,500");
    // 中线 0 落在裁切区左上角 → 整图 25%
    expect(r!.centers[0]).toBeCloseTo(0.25, 10);
    expect(r!.centers[2]).toBeCloseTo((250 + 999) / 1000, 10);
  });

  it("detectAngle 用降采样图判明暗再求角度", () => {
    const e = stubEngine();
    expect(detectAngle(e, img)).toBe(2.5);
    expect(e.calls).toContain("downsample");
    expect(e.calls).toContain("deskew true");
  });

  it("toEngine 只挑宽度、高度与像素", () => {
    expect(toEngine(img)).toEqual({ w: 1000, h: 500, data: img.data });
    expect(toEngine(null)).toBeNull();
  });
});
