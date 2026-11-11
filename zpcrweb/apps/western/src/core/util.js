
/* 基础工具：命名空间挂在 window.WA 上，纯函数，无 DOM 依赖。 */
(function (W) {
  'use strict';

  const MM_PER_INCH = 25.4;
  const PT_PER_MM = 72 / MM_PER_INCH;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function round(v, digits) {
    const f = Math.pow(10, digits || 0);
    return Math.round(v * f) / f;
  }
  function mmToPt(mm) { return mm * PT_PER_MM; }
  function ptToMm(pt) { return pt / PT_PER_MM; }
  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9);
  }

  W.util = { MM_PER_INCH, PT_PER_MM, clamp, round, mmToPt, ptToMm, escapeXml, uid };
})(window.WA = window.WA || {});
