
/* 画布坐标换算与命中测试（纯函数，不碰 DOM）。
 * 约定：视图坐标是相对画布左上角的 CSS 像素；图像坐标是旋转后画布的像素。 */
(function (W) {
  'use strict';

  /** 把图像按 contain 装进视图，返回缩放与偏移 */
  function fit(imgW, imgH, viewW, viewH, padding) {
    const pad = padding == null ? 24 : padding;
    const availW = Math.max(1, viewW - pad * 2);
    const availH = Math.max(1, viewH - pad * 2);
    const scale = Math.min(availW / imgW, availH / imgH);
    return {
      scale,
      dx: (viewW - imgW * scale) / 2,
      dy: (viewH - imgH * scale) / 2
    };
  }

  /** fit + 用户缩放/平移 → 实际变换 */
  function transform(fitObj, zoom, panX, panY) {
    const s = fitObj.scale * (zoom || 1);
    return {
      scale: s,
      dx: fitObj.dx + (panX || 0),
      dy: fitObj.dy + (panY || 0)
    };
  }

  function toScreen(pt, t) { return { x: pt.x * t.scale + t.dx, y: pt.y * t.scale + t.dy }; }
  function toImage(pt, t) { return { x: (pt.x - t.dx) / t.scale, y: (pt.y - t.dy) / t.scale }; }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  /** 八个把手的位置（图像像素） */
  function handlePoints(rect) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const r = rect.x + rect.w, b = rect.y + rect.h;
    return {
      nw: { x: rect.x, y: rect.y }, n: { x: cx, y: rect.y },
      ne: { x: r, y: rect.y }, e: { x: r, y: cy },
      se: { x: r, y: b }, s: { x: cx, y: b },
      sw: { x: rect.x, y: b }, w: { x: rect.x, y: cy }
    };
  }

  /**
   * 命中测试：返回 'nw'..'w' / 'move' / 'rotate' / null
   * pt 是图像坐标，tol 是命中半径（图像像素）
   */
  function hitTest(rect, pt, tol, rotatePoint) {
    const t = tol == null ? 8 : tol;
    if (rotatePoint) {
      const dx = pt.x - rotatePoint.x, dy = pt.y - rotatePoint.y;
      if (dx * dx + dy * dy <= t * t * 2.2) return 'rotate';
    }
    const pts = handlePoints(rect);
    for (const k of HANDLES) {
      const dx = pt.x - pts[k].x, dy = pt.y - pts[k].y;
      if (dx * dx + dy * dy <= t * t) return k;
    }
    if (pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h) return 'move';
    return null;
  }

  /** 拖拽把手后新矩形（图像像素），保证最小边 */
  function resizeRect(rect, handle, imgPt, minSide) {
    const min = minSide == null ? 8 : minSide;
    let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
    if (handle.indexOf('n') >= 0) y0 = Math.min(imgPt.y, y1 - min);
    if (handle.indexOf('s') >= 0) y1 = Math.max(imgPt.y, y0 + min);
    if (handle.indexOf('w') >= 0) x0 = Math.min(imgPt.x, x1 - min);
    if (handle.indexOf('e') >= 0) x1 = Math.max(imgPt.x, x0 + min);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** 图像像素矩形 → 归一化（0..1） */
  function toNorm(rect, imgW, imgH) {
    return {
      x: W.util.clamp(rect.x / imgW, 0, 1),
      y: W.util.clamp(rect.y / imgH, 0, 1),
      w: W.util.clamp(rect.w / imgW, 0, 1),
      h: W.util.clamp(rect.h / imgH, 0, 1)
    };
  }

  W.canvasmath = { fit, transform, toScreen, toImage, HANDLES, handlePoints, hitTest, resizeRect, toNorm };
})(window.WA = window.WA || {});
