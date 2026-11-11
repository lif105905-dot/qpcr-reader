
/* 泳道：手输条数 → 等距中线；拖动中线时不许越界。纯函数。 */
(function (W) {
  'use strict';

  const MIN_GAP = 0.004; // 相邻中线最小间距（归一化）

  /** n 条泳道的等距中线（1/n, 3/n, ...） */
  function evenCenters(n) {
    const k = Math.max(0, Math.floor(n));
    const out = [];
    for (let i = 0; i < k; i++) out.push((2 * i + 1) / (2 * k));
    return out;
  }

  /** 设置条数：等距重排；名字保留前缀并按需补 1..n */
  function setCount(doc, n) {
    const k = Math.max(0, Math.floor(n));
    doc.laneCount = k;
    doc.laneCenters = evenCenters(k);
    const names = Array.isArray(doc.laneNames) ? doc.laneNames.slice(0, k) : [];
    while (names.length < k) names.push(String(names.length + 1));
    doc.laneNames = names;
    return doc;
  }

  /** 拖动第 i 根中线到 x，夹在左右邻居之间 */
  function moveCenter(centers, i, x) {
    const out = centers.slice();
    if (i < 0 || i >= out.length) return out;
    const lo = i > 0 ? out[i - 1] + MIN_GAP : MIN_GAP;
    const hi = i < out.length - 1 ? out[i + 1] - MIN_GAP : 1 - MIN_GAP;
    out[i] = W.util.clamp(x, Math.min(lo, hi), Math.max(lo, hi));
    // 全等距时邻居可能贴太近，保证不重叠
    for (let j = 1; j < out.length; j++) {
      if (out[j] < out[j - 1] + MIN_GAP) out[j] = out[j - 1] + MIN_GAP;
    }
    return out;
  }

  /** 归一化 x 最近的泳道下标 */
  function nearestLane(centers, x) {
    let best = -1, bestD = Infinity;
    centers.forEach(function (c, i) {
      const d = Math.abs(c - x);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /** 首尾等距：首尾两根固定（拖的就是首/尾时按新的那根算），中间等分 */
  function linkedMove(centers, i, x) {
    const n = centers.length;
    if (n < 2) return moveCenter(centers, i, x);
    const out = centers.slice();
    const x0 = i === 0 ? W.util.clamp(x, MIN_GAP, out[n - 1] - MIN_GAP * (n - 1)) : out[0];
    const x1 = i === n - 1 ? W.util.clamp(x, out[0] + MIN_GAP * (n - 1), 1 - MIN_GAP) : out[n - 1];
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const span = Math.max(MIN_GAP * (n - 1), hi - lo);
    const step = span / (n - 1);
    for (let k = 0; k < n; k++) out[k] = lo + step * k;
    return out;
  }

  W.lanes = { MIN_GAP, evenCenters, setCount, moveCenter, linkedMove, nearestLane };
})(window.WA = window.WA || {});
