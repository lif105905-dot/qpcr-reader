
/* 几何：旋转后的画布尺寸、裁切框的夹取与取整。纯函数。 */
(function (W) {
  'use strict';

  const MIN_SIDE = 8; // 裁切框最短边（像素）

  function rotatedSize(w, h, deg) {
    const r = Math.abs((deg || 0) * Math.PI / 180);
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    return {
      w: Math.ceil(w * c + h * s),
      h: Math.ceil(w * s + h * c)
    };
  }

  /** 把归一化裁切框夹进 [0,1] 并保证不越界；w/h 是像素尺寸 */
  function cropClamp(crop, w, h) {
    const minW = Math.min(1, MIN_SIDE / w);
    const minH = Math.min(1, MIN_SIDE / h);
    let x = W.util.clamp(crop.x, 0, 1);
    let y = W.util.clamp(crop.y, 0, 1);
    let cw = W.util.clamp(crop.w, minW, 1 - x);
    let ch = W.util.clamp(crop.h, minH, 1 - y);
    if (cw < minW) { cw = minW; x = Math.max(0, Math.min(x, 1 - cw)); }
    if (ch < minH) { ch = minH; y = Math.max(0, Math.min(y, 1 - ch)); }
    return { x, y, w: cw, h: ch };
  }

  /** 归一化 → 像素整数矩形（至少 1px） */
  function cropToPixels(crop, w, h) {
    const c = cropClamp(crop, w, h);
    const x = Math.round(c.x * w);
    const y = Math.round(c.y * h);
    const pw = Math.max(1, Math.round(c.w * w));
    const ph = Math.max(1, Math.round(c.h * h));
    return { x, y, w: Math.min(pw, w - x), h: Math.min(ph, h - y) };
  }

  /** 有没有裁切（几乎整张就算没裁） */
  function isFullCrop(crop) {
    return !crop || (crop.x <= 1e-4 && crop.y <= 1e-4 && crop.w >= 1 - 1e-4 && crop.h >= 1 - 1e-4);
  }

  W.transform = { MIN_SIDE, rotatedSize, cropClamp, cropToPixels, isFullCrop };
})(window.WA = window.WA || {});
