/**
 * 画布坐标换算与命中测试 —— 移植自 `apps/western/src/core/canvasmath.js`。
 *
 * 约定与原来一致：视图坐标相对画布左上角（CSS 像素），图像坐标是旋转后画布的像素。
 * 纯函数，不碰 DOM。
 */
import { clamp } from "./util.js";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `fit()` 的结果：装进视图后的缩放与偏移。 */
export interface Fit {
  scale: number;
  dx: number;
  dy: number;
}

/** `fit()` + 用户缩放/平移之后的实际变换。 */
export type ViewTransform = Fit;

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type HitTarget = Handle | "move" | "rotate" | null;

export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 把 `imgW×imgH` 按 contain 装进视图（四周留 `padding`）。 */
export function fit(imgW: number, imgH: number, viewW: number, viewH: number, padding = 24): Fit {
  const pad = padding;
  const availW = Math.max(1, viewW - pad * 2);
  const availH = Math.max(1, viewH - pad * 2);
  const scale = Math.min(availW / imgW, availH / imgH);
  return {
    scale,
    dx: (viewW - imgW * scale) / 2,
    dy: (viewH - imgH * scale) / 2,
  };
}

/** 在 `fit()` 的基础上叠加用户缩放/平移。 */
export function transform(fitObj: Fit, zoom = 1, panX = 0, panY = 0): ViewTransform {
  return {
    scale: fitObj.scale * zoom,
    dx: fitObj.dx + panX,
    dy: fitObj.dy + panY,
  };
}

export function toScreen(pt: Point, t: ViewTransform): Point {
  return { x: pt.x * t.scale + t.dx, y: pt.y * t.scale + t.dy };
}

export function toImage(pt: Point, t: ViewTransform): Point {
  return { x: (pt.x - t.dx) / t.scale, y: (pt.y - t.dy) / t.scale };
}

/** 八个把手的位置（图像像素）。 */
export function handlePoints(rect: Rect): Record<Handle, Point> {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = rect.x + rect.w;
  const b = rect.y + rect.h;
  return {
    nw: { x: rect.x, y: rect.y },
    n: { x: cx, y: rect.y },
    ne: { x: r, y: rect.y },
    e: { x: r, y: cy },
    se: { x: r, y: b },
    s: { x: cx, y: b },
    sw: { x: rect.x, y: b },
    w: { x: rect.x, y: cy },
  };
}

/**
 * 命中测试：把手 → `'nw'…`，内部 → `'move'`，旋转圈 → `'rotate'`，其它 `null`。
 * `pt` 是图像坐标，`tol` 是命中半径（图像像素）。
 */
export function hitTest(
  rect: Rect,
  pt: Point,
  tol = 8,
  rotatePoint?: Point | null,
): HitTarget {
  if (rotatePoint) {
    const dx = pt.x - rotatePoint.x;
    const dy = pt.y - rotatePoint.y;
    if (dx * dx + dy * dy <= tol * tol * 2.2) return "rotate";
  }
  const pts = handlePoints(rect);
  for (const k of HANDLES) {
    const dx = pt.x - pts[k].x;
    const dy = pt.y - pts[k].y;
    if (dx * dx + dy * dy <= tol * tol) return k;
  }
  if (pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h) {
    return "move";
  }
  return null;
}

/** 拖动把手后的新矩形（图像像素），保证最短边 `minSide`。 */
export function resizeRect(rect: Rect, handle: Handle, imgPt: Point, minSide = 8): Rect {
  const min = minSide;
  let x0 = rect.x;
  let y0 = rect.y;
  let x1 = rect.x + rect.w;
  let y1 = rect.y + rect.h;
  if (handle.includes("n")) y0 = Math.min(imgPt.y, y1 - min);
  if (handle.includes("s")) y1 = Math.max(imgPt.y, y0 + min);
  if (handle.includes("w")) x0 = Math.min(imgPt.x, x1 - min);
  if (handle.includes("e")) x1 = Math.max(imgPt.x, x0 + min);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 图像像素矩形 → 归一化（0..1）。 */
export function toNorm(rect: Rect, imgW: number, imgH: number): Rect {
  return {
    x: clamp(rect.x / imgW, 0, 1),
    y: clamp(rect.y / imgH, 0, 1),
    w: clamp(rect.w / imgW, 0, 1),
    h: clamp(rect.h / imgH, 0, 1),
  };
}
