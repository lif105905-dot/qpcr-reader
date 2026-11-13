/**
 * 自动识别：把 GelFigure 的引擎（`vendor/gf-engine.js`）接到我们的文档模型上。
 *
 * 移植自 `apps/western/src/core/detect.js`。原实现从全局 `window.Engine` 取引擎；这里改成把
 * 引擎作为参数传进来 —— 同一个行为，但不再依赖 DOM，可以在 Node 里用桩引擎测。
 */
import type { Crop } from "./transform.js";

/** 引擎要求的灰度图：宽、高、逐像素数据（0–255）。 */
export interface EngineImage {
  w: number;
  h: number;
  data: Uint8Array | Uint8ClampedArray | number[];
}

export interface EngineLaneResult {
  centers?: number[];
  pitch?: number;
}

/** `vendor/gf-engine.js` 暴露的那几个函数。 */
export interface WesternEngine {
  cropImg(img: EngineImage, rect: { x: number; y: number; w: number; h: number }): EngineImage;
  detectBright(img: EngineImage): boolean;
  detectLanes(img: EngineImage, bright: boolean): EngineLaneResult;
  downsample(img: EngineImage, width: number): EngineImage;
  deskew(img: EngineImage, bright: boolean): number;
}

/** 我们文档里的图片（`image.js` 的产物）—— 至少需要宽高与像素。 */
export interface WesternImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray | number[];
}

export interface LaneDetection {
  /** 泳道中线，归一化到整张图（0–1）。 */
  centers: number[];
  count: number;
  /** 引擎给出的泳道间距（像素），0 表示没测出来。 */
  pitchPx: number;
  /** 这张图是「亮底暗带」还是「暗底亮带」。 */
  bright: boolean;
}

/** 我们的图片 → 引擎要的 `{w,h,data}`。 */
export function toEngine(img: WesternImage | null | undefined): EngineImage | null {
  if (!img) return null;
  return { w: img.width, h: img.height, data: img.data };
}

/** 在给定矩形（归一化）里找泳道；没有引擎或没有图时返回 `null`。 */
export function detectLanes(
  engine: WesternEngine | null | undefined,
  img: WesternImage | null | undefined,
  crop?: Crop,
): LaneDetection | null {
  if (!engine || !img) return null;
  const base = toEngine(img);
  if (!base) return null;
  const r = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const rect = {
    x: Math.max(0, r.x) * base.w,
    y: Math.max(0, r.y) * base.h,
    w: Math.max(1, r.w * base.w),
    h: Math.max(1, r.h * base.h),
  };
  const cropped = engine.cropImg(base, rect);
  const bright = engine.detectBright(cropped);
  const res = engine.detectLanes(cropped, bright);
  const centers = (res.centers ?? []).map((x) => (rect.x + x) / base.w);
  return { centers, count: centers.length, pitchPx: res.pitch ?? 0, bright };
}

/** 转正角度（度，顺时针为正，与 `doc.view.rotate` 同向）。 */
export function detectAngle(
  engine: WesternEngine | null | undefined,
  img: WesternImage | null | undefined,
): number {
  if (!engine || !img) return 0;
  const base = toEngine(img);
  if (!base) return 0;
  const bright = engine.detectBright(engine.downsample(base, 800));
  return engine.deskew(base, bright) || 0;
}
