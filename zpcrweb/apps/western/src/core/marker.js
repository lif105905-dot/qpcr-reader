
/* Marker：按从大到小选一条 ladder，用户在图上从上往下依次点条带，第 i 个点配第 i 个分子量。
 * 纯函数。 */
(function (W) {
  'use strict';

  /** 把点按 y（0=顶部）排序后依次配分子量；超出 ladder 长度的点丢弃 */
  function assignSizes(points, sizes) {
    const list = (points || []).slice().sort(function (a, b) { return a.y - b.y; });
    const out = [];
    for (let i = 0; i < list.length && i < sizes.length; i++) {
      out.push({ y: list[i].y, lane: list[i].lane, kDa: sizes[i] });
    }
    return out;
  }

  /** 还能再点几个 */
  function remaining(points, sizes) {
    return Math.max(0, Math.min(sizes.length, (points || []).length + 0, sizes.length) - (points || []).length);
  }

  /** 按单位格式化：bp 取整，kDa 保留一位小数 */
  function formatLabel(v, unit) {
    if (!isFinite(v)) return '';
    if (unit === 'bp') return String(Math.round(v));
    return formatKDa(v);
  }

  function formatKDa(v) {
    if (!isFinite(v)) return '';
    const r = Math.round(v * 10) / 10;
    return String(Number.isInteger(r) ? r : r.toFixed(1));
  }

  /** 相邻两点之间换算：返回 y → kDa 的线性映射（点少于 2 个时返回 null） */
  function interpolator(assigned) {
    if (!assigned || assigned.length < 2) return null;
    const pts = assigned.slice().sort(function (a, b) { return a.y - b.y; });
    return function (y) {
      if (y <= pts[0].y) return pts[0].kDa;
      const last = pts[pts.length - 1];
      if (y >= last.y) return last.kDa;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (y >= a.y && y <= b.y) {
          const t = (y - a.y) / (b.y - a.y || 1e-9);
          // 分子量与 y 的对数关系更接近实际迁移
          const la = Math.log(a.kDa), lb = Math.log(b.kDa);
          return Math.exp(la + (lb - la) * t);
        }
      }
      return last.kDa;
    };
  }

  W.marker = { assignSizes, remaining, formatKDa, formatLabel, interpolator };
})(window.WA = window.WA || {});
