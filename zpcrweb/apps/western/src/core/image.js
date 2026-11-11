
/* 图像：解码（复用 vendor/tiff.js）、亮度/对比度映射、显示画布与旋转画布缓存。
 * 纯计算部分（levels / lutFor / gradeValue）不依赖 DOM，可单测。 */
(function (W) {
  'use strict';

  const LUT_N = 4096;
  let canvasSeq = 0;   // 给每张显示画布一个唯一编号，旋转缓存用它做键

  /** 取 lo/hi 分位（百分比）作为黑白场；invert 只影响缓存键，不参与分位计算 */
  function levels(sig, sample, loPct, hiPct) {
    const n = sig.length;
    const step = Math.max(1, Math.floor(n / (sample || 20000)));
    const vals = [];
    for (let i = 0; i < n; i += step) vals.push(sig[i]);
    vals.sort(function (a, b) { return a - b; });
    if (!vals.length) return { black: 0, white: 1 };
    const lo = vals[Math.floor(vals.length * ((loPct == null ? 1 : loPct) / 100))];
    const hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * ((hiPct == null ? 99 : hiPct) / 100)))];
    if (!(hi > lo)) return { black: 0, white: Math.max(1e-6, vals[vals.length - 1] || 1) };
    return { black: lo, white: hi };
  }

  /** 亮度/对比度是给用户的两根滑块（0..100，默认 50），内部换算成黑白场 */
  function applyAdjust(base, brightness, contrast) {
    const b = W.util.clamp((brightness == null ? 50 : brightness), 0, 100);
    const c = W.util.clamp((contrast == null ? 50 : contrast), 0, 100);
    const span0 = base.white - base.black;
    // k 是窗口的压缩倍数：对比度 50 为中性；0 → k=0.4（窗口拉大 2.5 倍，更平）；100 → k=2.5（窗口缩到 0.4 倍，更硬）
    const k = c < 50 ? (0.4 + 0.6 * (c / 50)) : (1 + 1.5 * ((c - 50) / 50));
    const span = span0 / k;
    const mid = (base.black + base.white) / 2 + (b - 50) / 50 * span0 * 0.5;
    return { black: mid - span / 2, white: mid + span / 2 };
  }

  /** 等级映射成 0..1（gamma < 1 提亮中间调） */
  function gradeValue(v, black, white, invert, gamma) {
    let t = W.util.clamp((v - black) / (white - black || 1e-9), 0, 1);
    if (gamma && gamma !== 1) t = Math.pow(t, gamma);
    return invert ? 1 - t : t;
  }

  /** 4096 项查找表，索引 = floor(v * 4096) */
  function lutFor(black, white, invert, gamma) {
    const lut = new Uint8Array(LUT_N + 1);
    for (let i = 0; i <= LUT_N; i++) {
      lut[i] = Math.round(gradeValue(i / LUT_N, black, white, invert, gamma) * 255);
    }
    return lut;
  }

  function levelKey(black, white, invert, gamma) {
    return black.toFixed(6) + '|' + white.toFixed(6) + '|' + (invert ? 1 : 0) + '|' + (gamma || 1).toFixed(3);
  }

  /* ---------- 以下依赖 DOM ---------- */

  /** 复用 vendor/tiff.js（它挂在 window.TIFF 上，不在 WA 命名空间里） */
  function tiffModule() { return W.TIFF || (typeof window !== 'undefined' ? window.TIFF : null); }

  function decodeFile(file) {
    const t = tiffModule();
    if (!t) throw new Error('TIFF 解码模块未加载');
    return t.loadFile(file);
  }

  /** 生成（并缓存）8 位显示画布：只做黑白场映射 + 反相，尺寸不超过 maxSide */
  function displayCanvas(img, levelsNs, maxSide) {
    const black = levelsNs.black, white = levelsNs.white, invert = !!levelsNs.invert, gamma = levelsNs.gamma || 1;
    const key = levelKey(black, white, invert) + '|' + (maxSide || 0);
    if (img._dispKey === key && img._dispCanvas) return img._dispCanvas;

    const scale = Math.min(1, (maxSide || 4096) / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const out = ctx.createImageData(w, h);
    const lut = lutFor(black, white, invert, gamma);
    const src = img.data;
    const px = out.data;
    // 逐像素取样（最近邻）：比双线性快，膜图缩放后仍可用
    const sx = img.width / w, sy = img.height / h;
    for (let y = 0; y < h; y++) {
      const rowBase = Math.floor(y * sy) * img.width;
      for (let x = 0; x < w; x++) {
        const v = src[rowBase + Math.floor(x * sx)] || 0;
        const g = lut[(v * 4096) | 0];
        const o = (y * w + x) * 4;
        px[o] = g; px[o + 1] = g; px[o + 2] = g; px[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    cv._rk = ++canvasSeq;
    img._dispKey = key;
    img._dispCanvas = cv;
    return cv;
  }

  /** 旋转后的画布（角度为 0 时直接用显示画布） */
  function rotatedCanvas(img, deg, levelsNs, maxSide, flipX, flipY) {
    const base = displayCanvas(img, levelsNs, maxSide);
    const angle = ((deg || 0) % 360 + 360) % 360;
    const fx = !!flipX, fy = !!flipY;
    const rk = angle.toFixed(3) + '|' + (fx ? 'x' : '') + (fy ? 'y' : '') + '|' + base._rk;
    if (img._rotKey === rk && img._rotCanvas) return img._rotCanvas;
    if (angle === 0 && !fx && !fy) {
      img._rotKey = rk; img._rotCanvas = base;
      return base;
    }
    const size = W.transform.rotatedSize(base.width, base.height, angle);
    const cv = document.createElement('canvas');
    cv.width = size.w; cv.height = size.h;
    const ctx = cv.getContext('2d');
    ctx.translate(size.w / 2, size.h / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    img._rotKey = rk;
    img._rotCanvas = cv;
    return cv;
  }

  W.image = {
    LUT_N, levels, applyAdjust, gradeValue, lutFor, levelKey,
    decodeFile, displayCanvas, rotatedCanvas
  };
})(window.WA = window.WA || {});
