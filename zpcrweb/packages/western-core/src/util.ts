/**
 * 基础工具 —— `apps/western/src/core/util.js` 的 TypeScript 版本。
 *
 * 原实现挂在 `window.WA.util` 上；这里改成普通 ESM 导出，行为逐字保持：
 * 同一个 `clamp/round/mmToPt/escapeXml/uid` 语义，方便两套代码对拍。
 */

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH;

/** 夹到 [`lo`, `hi`] 区间内。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 四舍五入到 `digits` 位小数（`digits` 缺省为 0）。 */
export function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

/** XML 文本转义；`null`/`undefined` 按空串处理（原实现如此）。 */
export function escapeXml(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 随机 id，样式 `<prefix>-<7 位 base36>`。 */
export function uid(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
