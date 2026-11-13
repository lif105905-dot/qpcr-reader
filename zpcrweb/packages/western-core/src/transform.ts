/**
 * 几何：旋转后的画布尺寸、裁切框的夹取与取整。
 *
 * 移植自 `apps/western/src/core/transform.js`，纯函数，行为逐字保持。
 */
import { clamp } from "./util.js";

/** 裁切框最短边（像素）。 */
export const MIN_SIDE = 8;

/** 归一化的裁切框。 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 宽高为 `w×h` 的图旋转 `deg` 度之后的外接框。 */
export function rotatedSize(w: number, h: number, deg = 0): Size {
  const r = Math.abs(((deg || 0) * Math.PI) / 180);
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return {
    w: Math.ceil(w * c + h * s),
    h: Math.ceil(w * s + h * c),
  };
}

/** 把归一化裁切框夹进 `[0,1]`，并保证最短边不小于 {@link MIN_SIDE} 像素。 */
export function cropClamp(crop: Crop, w: number, h: number): Crop {
  const minW = Math.min(1, MIN_SIDE / w);
  const minH = Math.min(1, MIN_SIDE / h);
  let x = clamp(crop.x, 0, 1);
  let y = clamp(crop.y, 0, 1);
  let cw = clamp(crop.w, minW, 1 - x);
  let ch = clamp(crop.h, minH, 1 - y);
  if (cw < minW) {
    cw = minW;
    x = Math.max(0, Math.min(x, 1 - cw));
  }
  if (ch < minH) {
    ch = minH;
    y = Math.max(0, Math.min(y, 1 - ch));
  }
  return { x, y, w: cw, h: ch };
}

/** 归一化裁切框 → 像素整数矩形（至少 1 px，且不越出图像）。 */
export function cropToPixels(crop: Crop, w: number, h: number): PixelRect {
  const c = cropClamp(crop, w, h);
  const x = Math.round(c.x * w);
  const y = Math.round(c.y * h);
  const pw = Math.max(1, Math.round(c.w * w));
  const ph = Math.max(1, Math.round(c.h * h));
  return { x, y, w: Math.min(pw, w - x), h: Math.min(ph, h - y) };
}

/** 是否等于「整张图」（四舍五入误差内）。 */
export function isFullCrop(crop?: Crop | null): boolean {
  if (!crop) return true;
  return crop.x <= 1e-4 && crop.y <= 1e-4 && crop.w >= 1 - 1e-4 && crop.h >= 1 - 1e-4;
}
