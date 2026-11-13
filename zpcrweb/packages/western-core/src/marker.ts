/**
 * Marker：按从大到小选一条 ladder，用户在图上从上往下依次点条带，第 i 个点配第 i 个分子量。
 *
 * 移植自 `apps/western/src/core/marker.js`。原文件里的 `remaining()` 是死代码、且算法有误
 * （任何输入都返回 0），迁移时不带过来。
 */
import type { Point } from "./canvasmath.js";

/** 用户在图上点的一个条带：`y` 是图像坐标（0 = 顶部）。 */
export interface MarkerPoint extends Point {
  lane?: number;
}

/** 配好分子量的条带。 */
export interface AssignedBand {
  y: number;
  lane?: number;
  kDa: number;
}

/** 按 `y` 排序后依次配分子量；超出 ladder 长度的点丢弃。 */
export function assignSizes(
  points: readonly MarkerPoint[] | null | undefined,
  sizes: readonly number[],
): AssignedBand[] {
  const list = (points ?? []).slice().sort((a, b) => a.y - b.y);
  const out: AssignedBand[] = [];
  for (let i = 0; i < list.length && i < sizes.length; i += 1) {
    out.push({ y: list[i]!.y, lane: list[i]!.lane, kDa: sizes[i]! });
  }
  return out;
}

/** kDa 标签：整数不带小数点，否则保留一位。 */
export function formatKDa(v: number): string {
  if (!isFinite(v)) return "";
  const r = Math.round(v * 10) / 10;
  return String(Number.isInteger(r) ? r : r.toFixed(1));
}

/** 按单位格式化：`bp` 取整，其它按 kDa。 */
export function formatLabel(v: number, unit?: string): string {
  if (!isFinite(v)) return "";
  if (unit === "bp") return String(Math.round(v));
  return formatKDa(v);
}

/**
 * 相邻两点之间的换算：返回 `y → kDa` 的映射。
 *
 * 分子量与迁移距离在对数尺度上更接近线性，所以两点之间按 `log(kDa)` 线性插值；
 * 两端之外按端点值延伸。少于两个点时返回 `null`。
 */
export function interpolator(
  assigned: readonly AssignedBand[] | null | undefined,
): ((y: number) => number) | null {
  if (!assigned || assigned.length < 2) return null;
  const pts = assigned.slice().sort((a, b) => a.y - b.y);
  return (y: number): number => {
    const first = pts[0]!;
    if (y <= first.y) return first.kDa;
    const last = pts[pts.length - 1]!;
    if (y >= last.y) return last.kDa;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (y >= a.y && y <= b.y) {
        const t = (y - a.y) / (b.y - a.y || 1e-9);
        const la = Math.log(a.kDa);
        const lb = Math.log(b.kDa);
        return Math.exp(la + (lb - la) * t);
      }
    }
    return last.kDa;
  };
}
