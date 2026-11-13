/**
 * 泳道：条数 → 等距中线；拖动中线时不许越界。
 *
 * 移植自 `apps/western/src/core/lanes.js`。`setCount` 仍是原地改文档（原行为），
 * 这样两套代码可以逐字段对拍。
 */
import { clamp } from "./util.js";

/** 相邻中线的归一化最小间距。 */
export const MIN_GAP = 0.004;

/** 文档里泳道相关的字段 —— 只要求这几个，不绑定完整的 doc 类型。 */
export interface LaneDoc {
  laneCount?: number;
  laneCenters?: number[];
  laneNames?: string[];
}

/** `n` 条泳道的等距中线：`1/2n, 3/2n, …`。 */
export function evenCenters(n: number): number[] {
  const k = Math.max(0, Math.floor(n));
  const out: number[] = [];
  for (let i = 0; i < k; i += 1) out.push((2 * i + 1) / (2 * k));
  return out;
}

/** 设置条数：等距重排；名字保留前缀并按需补 `1..n`。 */
export function setCount<T extends LaneDoc>(doc: T, n: number): T {
  const k = Math.max(0, Math.floor(n));
  doc.laneCount = k;
  doc.laneCenters = evenCenters(k);
  const names = Array.isArray(doc.laneNames) ? doc.laneNames.slice(0, k) : [];
  while (names.length < k) names.push(String(names.length + 1));
  doc.laneNames = names;
  return doc;
}

/** 拖动第 `i` 根中线到 `x`，夹在左右邻居之间；之后再做一次防重叠。 */
export function moveCenter(centers: number[], i: number, x: number): number[] {
  const out = centers.slice();
  if (i < 0 || i >= out.length) return out;
  const lo = i > 0 ? out[i - 1]! + MIN_GAP : MIN_GAP;
  const hi = i < out.length - 1 ? out[i + 1]! - MIN_GAP : 1 - MIN_GAP;
  out[i] = clamp(x, Math.min(lo, hi), Math.max(lo, hi));
  for (let j = 1; j < out.length; j += 1) {
    if (out[j]! < out[j - 1]! + MIN_GAP) out[j] = out[j - 1]! + MIN_GAP;
  }
  return out;
}

/** 归一化 `x` 最近的泳道下标；空数组返回 `-1`。 */
export function nearestLane(centers: number[], x: number): number {
  let best = -1;
  let bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** 首尾等距：拖首/尾时按新的那根重排中间，其它情况保持不变。 */
export function linkedMove(centers: number[], i: number, x: number): number[] {
  const n = centers.length;
  if (n < 2) return moveCenter(centers, i, x);
  const out = centers.slice();
  const x0 = i === 0 ? clamp(x, MIN_GAP, out[n - 1]! - MIN_GAP * (n - 1)) : out[0]!;
  const x1 =
    i === n - 1 ? clamp(x, out[0]! + MIN_GAP * (n - 1), 1 - MIN_GAP) : out[n - 1]!;
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const span = Math.max(MIN_GAP * (n - 1), hi - lo);
  const step = span / (n - 1);
  for (let k = 0; k < n; k += 1) out[k] = lo + step * k;
  return out;
}
