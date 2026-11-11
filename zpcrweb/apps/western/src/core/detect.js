/* 自动识别：把 GelFigure 的引擎（vendor/gf-engine.js）接到我们的文档模型上。
 * 只做三件事：判明暗、估转正角度、找泳道中线。识别结果写进 doc.view / laneCount / laneCenters，
 * 之后仍然是可手改的普通数据（没有“识别态”这种隐藏状态）。
 */
(function (W) {
  'use strict';

  function engine() { return W.Engine || (typeof window !== 'undefined' ? window.Engine : null); }

  /** 我们的图片 → 引擎要的 {w,h,data} */
  function toEngine(img) {
    if (!img) return null;
    return { w: img.width, h: img.height, data: img.data };
  }

  /** 在给定矩形（归一化）里找泳道，返回 { centers:[0..1], count, pitchPx } */
  function detectLanes(img, crop) {
    const E = engine();
    if (!E || !img) return null;
    const base = toEngine(img);
    const r = crop || { x: 0, y: 0, w: 1, h: 1 };
    const rect = {
      x: Math.max(0, r.x) * base.w,
      y: Math.max(0, r.y) * base.h,
      w: Math.max(1, r.w * base.w),
      h: Math.max(1, r.h * base.h)
    };
    const cropped = E.cropImg(base, rect);
    const bright = E.detectBright(cropped);
    const res = E.detectLanes(cropped, bright);
    const centers = (res.centers || []).map(function (x) { return (rect.x + x) / base.w; });
    return {
      centers: centers,
      count: centers.length,
      pitchPx: res.pitch || 0,
      bright: bright
    };
  }

  /** 转正角度（度，顺时针为正，与 doc.view.rotate 同向） */
  function detectAngle(img) {
    const E = engine();
    if (!E || !img) return 0;
    const base = toEngine(img);
    const bright = E.detectBright(E.downsample(base, 800));
    return E.deskew(base, bright) || 0;
  }

  W.detect = { engine: engine, toEngine: toEngine, detectLanes: detectLanes, detectAngle: detectAngle };
})(window.WA = window.WA || {});
