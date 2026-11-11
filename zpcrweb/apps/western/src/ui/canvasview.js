
/* 图片处理区：画布、缩放平移、裁切框、旋转把手。 */
(function (W) {
  'use strict';

  const HANDLE_PX = 9;      // 把手半径（屏幕像素）
  const ROTATE_OFFSET = 34; // 旋转把手离裁切框顶边的屏幕距离

  const CanvasView = {
    el: null, canvas: null, ctx: null, app: null,
    drag: null,
    _pending: false,

    mount(container, app) {
      this.app = app;
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'canvas-wrap';
      const canvas = document.createElement('canvas');
      canvas.className = 'edit-canvas';
      wrap.appendChild(canvas);
      const hint = document.createElement('div');
      hint.className = 'canvas-hint';
      hint.textContent = '把膜图拖进来，或点左侧「打开图片」';
      wrap.appendChild(hint);
      container.appendChild(wrap);

      this.el = wrap;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.hint = hint;

      // 空格 = 平移视图（看图用）
      this.spaceDown = false;
      if (!this._spaceBound) {
        this._spaceBound = true;
        window.addEventListener('keydown', (e) => {
          const tag = (e.target && e.target.tagName) || '';
          if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/i.test(tag)) {
            this.spaceDown = true;
            if (!this.drag && this.canvas) this.canvas.style.cursor = 'grab';
            e.preventDefault();
          }
        });
        window.addEventListener('keyup', (e) => {
          if (e.code === 'Space') {
            this.spaceDown = false;
            if (this.canvas) this.canvas.style.cursor = 'default';
          }
        });
      }

      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', (e) => this.onUp(e));
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

      // 整块区域都能接住拖进来的文件
      [wrap, container].forEach((node) => {
        node.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
        node.addEventListener('dragleave', () => wrap.classList.remove('drop'));
        node.addEventListener('drop', (e) => {
          e.preventDefault();
          wrap.classList.remove('drop');
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            app.openFile(e.dataTransfer.files[0]);
          }
        });
      });

      const ro = new ResizeObserver(() => this.resize());
      ro.observe(wrap);
      this.resize();
      return this;
    },

    resize() {
      const r = this.el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.viewW = Math.max(1, Math.floor(r.width));
      this.viewH = Math.max(1, Math.floor(r.height));
      this.canvas.width = Math.floor(this.viewW * dpr);
      this.canvas.height = Math.floor(this.viewH * dpr);
      this.canvas.style.width = this.viewW + 'px';
      this.canvas.style.height = this.viewH + 'px';
      this.dpr = dpr;
      this.draw();
    },

    /** 当前图像的旋转画布 */
    rotCanvas() {
      const app = this.app;
      if (!app || !app.img) return null;
      return W.image.rotatedCanvas(app.img, app.doc.view.rotate, app.levels(), 2048, app.doc.view.flipX, app.doc.view.flipY);
    },

    /** 当前几何：fit + zoom/pan（单位：图像像素 → CSS 像素） */

    /** 当前 marker 刻度的屏幕位置（供绘制与命中复用） */
    markerHandles(rect, t) {
      const doc = this.app.doc;
      const mk = doc.marker || {};
      const ladder = W.ladders.get(mk.ladderId || '') || { sizes: [] };
      const sizes = Array.isArray(mk.sizes) ? mk.sizes : ladder.sizes;
      const pts = (mk.points || []).slice().sort(function (a, b) { return a.y - b.y; });
      if (!pts.length || mk.lane == null || doc.laneCenters[mk.lane] == null) return [];
      const unit = doc.mode === 'gel' ? 'bp' : 'kDa';
      const p0 = W.canvasmath.toScreen({ x: rect.x, y: rect.y }, t);
      const p1 = W.canvasmath.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h }, t);
      const laneX = W.canvasmath.toScreen({ x: rect.x + doc.laneCenters[mk.lane] * rect.w, y: rect.y }, t).x;
      const out = [];
      for (let i = 0; i < pts.length && i < sizes.length; i++) {
        out.push({
          ref: pts[i], x: laneX, y: p0.y + pts[i].y * (p1.y - p0.y),
          label: W.marker.formatLabel(sizes[i], unit),
        });
      }
      return out;
    },

    geometry() {
      const cv = this.rotCanvas();
      if (!cv) return null;
      const fit = W.canvasmath.fit(cv.width, cv.height, this.viewW, this.viewH, 28);
      const v = this.app.doc.view;
      return W.canvasmath.transform(fit, v.zoom, v.panX, v.panY);
    },

    cropPx() {
      const cv = this.rotCanvas();
      const crop = this.app.doc.crop;
      if (!cv) return null;
      if (!crop) return { x: 0, y: 0, w: cv.width, h: cv.height };
      const px = W.transform.cropToPixels(crop, cv.width, cv.height);
      return px;
    },

    rotatePointScreen(t, rect) {
      const p = W.canvasmath.toScreen({ x: rect.x + rect.w / 2, y: rect.y }, t);
      return { x: p.x, y: p.y - ROTATE_OFFSET };
    },

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const app = this.app;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      const cv = this.rotCanvas();
      if (!cv || !app.img) {
        ctx.restore();
        if (this.hint) this.hint.style.display = '';
        return;
      }
      if (this.hint) this.hint.style.display = 'none';
      const t = this.geometry();
      ctx.imageSmoothingQuality = 'high';

      // 棋盘格底，透明处可见
      ctx.fillStyle = 'rgba(127,137,153,.10)';
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      ctx.drawImage(cv, t.dx, t.dy, cv.width * t.scale, cv.height * t.scale);

      // 标红过曝像素（按显示画布缓存一张蒙版）
      if (app.doc.view.markClip && cv.width) {
        if (cv._clipMask === undefined || cv._clipMaskSrc !== cv._rk) {
          const m = document.createElement('canvas');
          m.width = cv.width; m.height = cv.height;
          const mc = m.getContext('2d');
          const src = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
          const imgData = mc.createImageData(cv.width, cv.height);
          const out = imgData.data;
          for (let i = 0; i < out.length; i += 4) {
            const v = src[i];
            if (v >= 254) { out[i] = 255; out[i + 1] = 40; out[i + 2] = 40; out[i + 3] = 235; }
          }
          mc.putImageData(imgData, 0, 0);
          cv._clipMask = m;
          cv._clipMaskSrc = cv._rk;
        }
        ctx.drawImage(cv._clipMask, t.dx, t.dy, cv.width * t.scale, cv.height * t.scale);
      }

      // 参考网格
      if (app.doc.view.grid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(240,196,0,.5)';
        ctx.lineWidth = 1;
        const gw = cv.width * t.scale, gh = cv.height * t.scale;
        for (let i = 1; i < 10; i++) {
          ctx.beginPath();
          ctx.moveTo(t.dx + (gw / 10) * i, t.dy);
          ctx.lineTo(t.dx + (gw / 10) * i, t.dy + gh);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(t.dx, t.dy + (gh / 10) * i);
          ctx.lineTo(t.dx + gw, t.dy + (gh / 10) * i);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 裁切框：框外压暗
      const rect = this.cropPx();
      const p0 = W.canvasmath.toScreen({ x: rect.x, y: rect.y }, t);
      const p1 = W.canvasmath.toScreen({ x: rect.x + rect.w, y: rect.y + rect.h }, t);
      ctx.fillStyle = 'rgba(10,14,20,.42)';
      ctx.fillRect(t.dx, t.dy, cv.width * t.scale, Math.max(0, p0.y - t.dy));
      ctx.fillRect(t.dx, p1.y, cv.width * t.scale, Math.max(0, (cv.height * t.scale + t.dy) - p1.y));
      ctx.fillRect(t.dx, p0.y, Math.max(0, p0.x - t.dx), Math.max(0, p1.y - p0.y));
      ctx.fillRect(p1.x, p0.y, Math.max(0, (cv.width * t.scale + t.dx) - p1.x), Math.max(0, p1.y - p0.y));

      ctx.strokeStyle = '#2f6fed';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.setLineDash([]);

      // 八个把手
      const hp = W.canvasmath.handlePoints(rect);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#2f6fed';
      ctx.lineWidth = 1.5;
      Object.keys(hp).forEach((k) => {
        const s = W.canvasmath.toScreen(hp[k], t);
        ctx.beginPath();
        ctx.rect(s.x - HANDLE_PX / 2, s.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        ctx.fill();
        ctx.stroke();
      });

      // Marker 刻度（可拖动）
      const handles = this.markerHandles(rect, t);
      if (handles.length) {
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        handles.forEach((h) => {
          ctx.strokeStyle = '#ff5c8a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(h.x - 10, h.y);
          ctx.lineTo(h.x + 10, h.y);
          ctx.stroke();
          ctx.fillStyle = '#ff5c8a';
          ctx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
          ctx.fillText(h.label, h.x + 14, h.y);
        });
      }

      // 泳道中线（在当前裁切框内）
      const centers = this.app.doc.laneCenters || [];
      if (centers.length) {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.2;
        const mkLane = (this.app.doc.marker && this.app.doc.marker.ladderId) ? this.app.doc.marker.lane : -1;
        centers.forEach((c, i) => {
          const x = W.canvasmath.toScreen({ x: rect.x + c * rect.w, y: rect.y }, t).x;
          if (i === mkLane) {
            ctx.strokeStyle = 'rgba(242,196,0,.95)';
            ctx.lineWidth = 2;
          } else {
            ctx.strokeStyle = (this.hoverLane === i) ? '#ff9f1c' : 'rgba(47,111,237,.9)';
            ctx.lineWidth = 1.2;
          }
          ctx.beginPath();
          ctx.moveTo(x, p0.y);
          ctx.lineTo(x, p1.y);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // 旋转把手
      const rp = this.rotatePointScreen(t, rect);
      const topMid = W.canvasmath.toScreen({ x: rect.x + rect.w / 2, y: rect.y }, t);
      ctx.strokeStyle = '#2f6fed';
      ctx.beginPath();
      ctx.moveTo(topMid.x, topMid.y);
      ctx.lineTo(rp.x, rp.y + HANDLE_PX);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, HANDLE_PX + 1, 0, Math.PI * 2);
      ctx.fillStyle = '#2f6fed';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↻', rp.x, rp.y + 0.5);
      ctx.restore();
    },

    cancelPending() {
      this._raf = 0;
      this.drag = null;
    },

    scheduleDraw() {
      if (this._pending) return;
      this._pending = true;
      requestAnimationFrame(() => { this._pending = false; this.draw(); });
    },

    pointerImagePoint(e) {
      const r = this.canvas.getBoundingClientRect();
      const t = this.geometry();
      return W.canvasmath.toImage({ x: e.clientX - r.left, y: e.clientY - r.top }, t);
    },

    /** 命中已有标注：文字/条带/区域框/括号 */
    annotationHit(ip, rect) {
      const doc = this.app.doc;
      const nx = (ip.x - rect.x) / rect.w;
      const ny = (ip.y - rect.y) / rect.h;
      const tolX = 14 / (rect.w || 1);
      const tolY = 14 / (rect.h || 1);
      const list = doc.annotations.slice().reverse();
      for (const a of list) {
        if (a.kind === 'text') {
          if (Math.abs(nx - a.x) < tolX && Math.abs(ny - a.y) < tolY) return a;
        } else if (a.kind === 'band') {
          if (Math.abs(ny - a.y) < tolY) return a;
        } else if (a.kind === 'box') {
          if (nx >= a.x && nx <= a.x + a.w && ny >= a.y && ny <= a.y + a.h) return a;
        } else if (a.kind === 'bracket') {
          if (Math.abs(nx - a.x) < tolX && ny >= a.y0 && ny <= a.y1) return a;
        }
      }
      return null;
    },

    /** 命中泳道中线：返回下标或 -1 */
    laneHit(ip, t, rect) {
      const centers = this.app.doc.laneCenters || [];
      const tol = 7 / t.scale;
      for (let i = 0; i < centers.length; i++) {
        const x = rect.x + centers[i] * rect.w;
        if (Math.abs(ip.x - x) <= tol && ip.y >= rect.y && ip.y <= rect.y + rect.h) return i;
      }
      return -1;
    },

    onDown(e) {
      if (!this.app.img || !this.app.doc) return;
      const t = this.geometry();
      const rect = this.cropPx();
      const ip = this.pointerImagePoint(e);
      // 条带模式：点一下加一个目标条带标注
      if (this.app.bandMode && ip.x >= rect.x && ip.x <= rect.x + rect.w && ip.y >= rect.y && ip.y <= rect.y + rect.h) {
        const nx = (ip.x - rect.x) / rect.w;
        const lane = W.lanes.nearestLane(this.app.doc.laneCenters, nx);
        W.annotations.add(this.app.doc, {
          kind: 'band', lane: Math.max(0, lane), y: (ip.y - rect.y) / rect.h,
          text: (this.app.bandText && this.app.bandText()) || ''
        });
        this.app.refresh();
        return;
      }

      // 按住 Marker 刻度拖动
      const mh = this.markerHandles(rect, t);
      const cp = W.canvasmath.toScreen(ip, t);
      for (let hi = 0; hi < mh.length; hi++) {
        if (Math.abs(cp.x - mh[hi].x) <= 16 && Math.abs(cp.y - mh[hi].y) <= 9) {
          this.canvas.setPointerCapture(e.pointerId);
          this.drag = { marker: mh[hi].ref, rect: rect };
          return;
        }
      }
      // 点中已有标注 → 拖动它
      const annHit = this.annotationHit(ip, rect);
      if (annHit) {
        this.canvas.setPointerCapture(e.pointerId);
        this.drag = { ann: annHit.id, kind: annHit.kind, dx: ip.x - (rect.x + (annHit.x || 0) * rect.w), dy: ip.y - (rect.y + (annHit.y || 0) * rect.h) };
        return;
      }

      const laneIdx = this.laneHit(ip, t, rect);
      const probe = W.canvasmath.hitTest(rect, ip, HANDLE_PX / t.scale);
      const onHandle = probe && probe !== 'move';   // 'move' 表示在框内空白处，应该让位给泳道线
      if (laneIdx >= 0 && !onHandle) {
        this.canvas.setPointerCapture(e.pointerId);
        this.drag = { lane: laneIdx };
        return;
      }
      const rpScreen = this.rotatePointScreen(t, rect);
      const r = this.canvas.getBoundingClientRect();
      const rpImage = W.canvasmath.toImage({ x: rpScreen.x - r.left, y: rpScreen.y - r.top }, t);
      const hit = W.canvasmath.hitTest(rect, ip, HANDLE_PX / t.scale, rpImage);
      // 空格 / 中键 / 点在图片外 = 平移视图（看图用），优先于画框
      if (this.spaceDown || e.button === 1 || hit === null) {
        this.canvas.setPointerCapture(e.pointerId);
        this.drag = {
          pan: true, clientX0: e.clientX, clientY0: e.clientY,
          startPan: { x: this.app.doc.view.panX, y: this.app.doc.view.panY }
        };
        this.canvas.style.cursor = 'grabbing';
        return;
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = {
        hit, startImage: ip, startRect: rect,
        clientX0: e.clientX, clientY0: e.clientY,
        startPan: { x: this.app.doc.view.panX, y: this.app.doc.view.panY }
      };
      if (hit === 'rotate') this.drag.startAngle = this.app.doc.view.rotate;
    },

    onMove(e) {
      if (!this.app.img) return;
      if (!this.drag) {
        // 悬停光标
        const t = this.geometry();
        const ip = this.pointerImagePoint(e);
        const rectHover = this.cropPx();
        const laneHover = this.laneHit(ip, t, rectHover);
        if (laneHover !== this.hoverLane) { this.hoverLane = laneHover; this.scheduleDraw(); }
        if (laneHover >= 0) { this.canvas.style.cursor = 'ew-resize'; return; }
        const hit = W.canvasmath.hitTest(rectHover, ip, HANDLE_PX / t.scale);
        const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: 'grab' };
        this.canvas.style.cursor = hit ? (map[hit] || 'default') : 'grab';
        return;
      }
      const d = this.drag;
      if (d.marker) {
        const t = this.geometry();
        const ip2 = this.pointerImagePoint(e);
        const r = d.rect;
        d.marker.y = Math.min(1, Math.max(0, (ip2.y - r.y) / r.h));
        this.app.refresh();
        if (this.app.paintMarkerStatus) this.app.paintMarkerStatus();
        return;
      }
      if (d.pan) {
        const doc = this.app.doc;
        doc.view.panX = d.startPan.x + (e.clientX - d.clientX0);
        doc.view.panY = d.startPan.y + (e.clientY - d.clientY0);
        this.app.refresh();
        return;
      }
      const ip = this.pointerImagePoint(e);
      const doc = this.app.doc;

      if (d.ann) {
        const rect3 = this.cropPx();
        const nx = W.util.clamp((ip.x - rect3.x) / rect3.w, 0, 1);
        const ny = W.util.clamp((ip.y - rect3.y) / rect3.h, 0, 1);
        const ann = W.annotations.get(doc, d.ann);
        if (ann) {
          if (ann.kind === 'text' || ann.kind === 'box') {
            W.annotations.update(doc, ann.id, { x: nx, y: ny });
          } else if (ann.kind === 'band') {
            const lane = W.lanes.nearestLane(doc.laneCenters, nx);
            W.annotations.update(doc, ann.id, { y: ny, lane: Math.max(0, lane) });
          } else if (ann.kind === 'bracket') {
            const h = ann.y1 - ann.y0;
            const y0 = W.util.clamp(ny - h / 2, 0, 1 - h);
            W.annotations.update(doc, ann.id, { x: nx, y0, y1: y0 + h });
          }
          this.app.refresh();
        }
        return;
      }

      if (d.lane != null) {
        const cv2 = this.rotCanvas();
        const rect2 = this.cropPx();
        const norm = (ip.x - rect2.x) / rect2.w;
        doc.laneCenters = (doc.laneLinked && W.lanes.linkedMove)
          ? W.lanes.linkedMove(doc.laneCenters, d.lane, norm)
          : W.lanes.moveCenter(doc.laneCenters, d.lane, norm);
        this.app.refresh();
        return;
      }
      if (d.hit === 'rotate') {
        const cv = this.rotCanvas();
        const center = { x: cv.width / 2, y: cv.height / 2 };
        const a0 = Math.atan2(d.startImage.y - center.y, d.startImage.x - center.x);
        const a1 = Math.atan2(ip.y - center.y, ip.x - center.x);
        let deg = d.startAngle + (a1 - a0) * 180 / Math.PI;
        deg = Math.round(deg * 10) / 10;
        doc.view.rotate = Math.max(-45, Math.min(45, deg));
        this.app.refresh();
        return;
      }
      if (d.hit === 'move') {
        const cv = this.rotCanvas();
        const nx = d.startRect.x + (ip.x - d.startImage.x);
        const ny = d.startRect.y + (ip.y - d.startImage.y);
        doc.crop = W.canvasmath.toNorm({ x: nx, y: ny, w: d.startRect.w, h: d.startRect.h }, cv.width, cv.height);
        this.app.refresh();
        return;
      }
      if (d.hit) {
        const cv = this.rotCanvas();
        const moved = W.canvasmath.resizeRect(d.startRect, d.hit, ip, 8);
        doc.crop = W.canvasmath.toNorm(moved, cv.width, cv.height);
        this.app.refresh();
        return;
      }
      // 平移：空格/中键按下时的拖动，或点在图片外
      doc.view.panX = d.startPan.x + (e.clientX - d.clientX0);
      doc.view.panY = d.startPan.y + (e.clientY - d.clientY0);
      this.app.refresh();
    },

    onUp(e) {
      if (this.drag) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
      this.drag = null;
    },

    onWheel(e) {
      if (!this.app.img) return;
      e.preventDefault();
      const v = this.app.doc.view;
      const factor = Math.exp(-e.deltaY * 0.0015);
      v.zoom = W.util.clamp(v.zoom * factor, 0.5, 8);
      this.app.refresh();
    }
  };

  W.canvasview = CanvasView;
})(window.WA = window.WA || {});
