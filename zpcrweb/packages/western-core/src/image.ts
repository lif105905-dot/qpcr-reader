/**
 * 图像级别映射：分位黑白场、亮度/对比度滑块、gamma、反相。
 *
 * 移植自 `apps/western/src/core/image.js` 的纯计算部分（`levels`/`applyAdjust`/`gradeValue`/
 * `lutFor`/`levelKey`）。原来的 `displayCanvas`/`rotatedCanvas` 依赖 `<canvas>`，这里换成
 * {@link sampleDisplay} —— 同样的逐像素最近邻取样，但只产出 RGBA 数据，由调用方贴到画布上，
 * 这样 React 侧和 Node 测试都能用同一份实现。
 */
import { clamp } from "./util.js";

/** 查找表级数（与原实现一致）。 */
export const LUT_N = 4096;

export interface Levels {
  black: number;
  white: number;
}

/** 取 `loPct`/`hiPct` 分位作为黑白场；`sample` 是采样上限（默认采 20000 个点）。 */
export function levels(
  sig: ArrayLike<number>,
  sample = 20000,
  loPct = 1,
  hiPct = 99,
): Levels {
  const n = sig.length;
  const step = Math.max(1, Math.floor(n / (sample || 20000)));
  const vals: number[] = [];
  for (let i = 0; i < n; i += step) vals.push(sig[i]!);
  vals.sort((a, b) => a - b);
  if (!vals.length) return { black: 0, white: 1 };
  const lo = vals[Math.floor(vals.length * (loPct / 100))];
  const hi = vals[
    Math.min(vals.length - 1, Math.floor(vals.length * (hiPct / 100)))
  ];
  if (!(hi! > lo!)) return { black: 0, white: Math.max(1e-6, vals[vals.length - 1] || 1) };
  return { black: lo!, white: hi! };
}

/**
 * 亮度/对比度滑块（0..100，50 = 中性）换算成黑白场。
 *
 * 亮度把窗口整体平移，对比度缩放窗口：50 为中性，0 → 窗口放大 2.5 倍，100 → 缩到 0.4 倍。
 * 公式逐字保留自原实现。
 */
export function applyAdjust(base: Levels, brightness = 50, contrast = 50): Levels {
  const b = clamp(brightness, 0, 100);
  const c = clamp(contrast, 0, 100);
  const span0 = base.white - base.black;
  const k = c < 50 ? 0.4 + 0.6 * (c / 50) : 1 + 1.5 * ((c - 50) / 50);
  const span = span0 / k;
  const mid = (base.black + base.white) / 2 + ((b - 50) / 50) * span0 * 0.5;
  return { black: mid - span / 2, white: mid + span / 2 };
}

/** 单点映射到 0..1（`gamma < 1` 提亮中间调；`invert` 取反）。 */
export function gradeValue(
  v: number,
  black: number,
  white: number,
  invert = false,
  gamma = 1,
): number {
  let t = clamp((v - black) / (white - black || 1e-9), 0, 1);
  if (gamma && gamma !== 1) t = t ** gamma;
  return invert ? 1 - t : t;
}

/** 4096 级查找表；索引 = `floor(v * 4096)`，长度 `LUT_N + 1`。 */
export function lutFor(
  black: number,
  white: number,
  invert = false,
  gamma = 1,
): Uint8Array {
  const lut = new Uint8Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i += 1) {
    lut[i] = Math.round(gradeValue(i / LUT_N, black, white, invert, gamma) * 255);
  }
  return lut;
}

/** 缓存键：黑白场 + 反相 + gamma 的稳定字符串。 */
export function levelKey(
  black: number,
  white: number,
  invert: boolean,
  gamma = 1,
): string {
  return `${black.toFixed(6)}|${white.toFixed(6)}|${invert ? 1 : 0}|${(gamma || 1).toFixed(3)}`;
}

/** 生成显示用的灰度 RGBA 数据（最近邻缩放，最长边不超过 `maxSide`）。 */
export interface DisplayBitmap {
  width: number;
  height: number;
  /** 逐像素 RGBA，可直接 `ctx.putImageData(new ImageData(rgba, w, h), 0, 0)`。 */
  rgba: Uint8ClampedArray;
}

export function sampleDisplay(
  img: { width: number; height: number; data: ArrayLike<number> },
  levelsNs: Levels & { invert?: boolean; gamma?: number },
  maxSide = 4096,
): DisplayBitmap {
  const black = levelsNs.black;
  const white = levelsNs.white;
  const invert = !!levelsNs.invert;
  const gamma = levelsNs.gamma || 1;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const lut = lutFor(black, white, invert, gamma);
  const src = img.data;
  const px = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y += 1) {
    const rowBase = Math.floor(y * sy) * img.width;
    for (let x = 0; x < w; x += 1) {
      const v = src[rowBase + Math.floor(x * sx)] || 0;
      const g = lut[(v * 4096) | 0] ?? 0;
      const o = (y * w + x) * 4;
      px[o] = g;
      px[o + 1] = g;
      px[o + 2] = g;
      px[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba: px };
}
