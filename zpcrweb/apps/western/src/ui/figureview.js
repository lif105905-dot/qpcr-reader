/* 右侧成图：把 WA.render.scene 的绘图指令画到 canvas（与 SVG 导出同一份数据）。 */
(function (W) {
  'use strict';

  const FigureView = {
    mount(container, app) {
      this.app = app;
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'fig-wrap';
      const cv = document.createElement('canvas');
      cv.className = 'fig-canvas';
      wrap.appendChild(cv);
      const meta = document.createElement('div');
      meta.className = 'fig-meta';
      wrap.appendChild(meta);
      container.appendChild(wrap);
      this.canvas = cv;
      this.meta = meta;
      new ResizeObserver(() => this.draw()).observe(wrap);
      this.wrap = wrap;
      this.bindPointer();
      this.draw();
    },

    /** 当前裁切后的像素尺寸与显示画布 */
    source() {
      const app = this.app;
      const rot = W.image.rotatedCanvas(app.img, app.doc.view.rotate, app.levels(), 2048, app.doc.view.flipX, app.doc.view.flipY);
      const px = app.doc.crop
        ? W.transform.cropToPixels(app.doc.crop, rot.width, rot.height)
        : { x: 0, y: 0, w: rot.width, h: rot.height };
      return { rot, px };
    },

    scene() {
      if (!this.app.img || !this.app.doc) return null;
      const { rot, px } = this.source();
      const sc = W.render.scene(this.app.doc, { cropW: px.w, cropH: px.h, axisInk: this.axisInk() });
      return { sc, rot, px };
    },

    /** 图上墨色：图偏暗用白字，偏亮用黑字（按裁切区采样亮度） */
    axisInk() {
      const { rot, px } = this.source();
      return W.figureview.inkFor(rot, px);
    },

    draw() {
      const app = this.app;
      const cv = this.canvas;
      if (!cv) return;
      const box = cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const availW = Math.max(160, box.width - 24);
      // 高度不再依赖容器（容器高度由画布撑开，会互相追）：给成图一个稳定的上限
      const availH = Math.max(160, Math.min(560, Math.round(window.innerHeight * 0.46)));

      if (!app.img || !app.doc) {
        cv.style.width = availW + 'px';
        cv.style.height = '120px';
        cv.width = Math.floor(availW * dpr);
        cv.height = Math.floor(120 * dpr);
        const c0 = cv.getContext('2d');
        c0.setTransform(dpr, 0, 0, dpr, 0, 0);
        c0.clearRect(0, 0, availW, 120);
        this.meta.textContent = '';
        return;
      }

      const { sc, rot, px } = this.scene();
      const scale = Math.min(availW / sc.widthPt, availH / sc.heightPt);
      const cw = sc.widthPt * scale, ch = sc.heightPt * scale;
      cv.width = Math.floor(cw * dpr);
      cv.height = Math.floor(ch * dpr);
      cv.style.width = cw + 'px';
      cv.style.height = ch + 'px';

      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);

      const st = app.doc.style;
      const font = (st.fontFamily || 'Arial') + ', sans-serif';
      ctx.imageSmoothingQuality = 'high';

      ctx.imageSmoothingQuality = 'high';
      const img = sc.items.find((i) => i.kind === 'image');
      if (img) ctx.drawImage(rot, px.x, px.y, px.w, px.h, img.x * scale, img.y * scale, img.w * scale, img.h * scale);
      paintVector(ctx, sc.items, scale, font);
      this.meta.textContent = px.w + '×' + px.h + ' px · ' + (sc.widthPt / (72 / 25.4)).toFixed(1) + ' mm';
      this.view = { sc, scale };
    }
  };

  /** 屏幕坐标 → 图片归一化坐标（0..1，含裁切） */
  function normAt(self, e) {
    const v = self.view;
    if (!v) return null;
    const r = self.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / v.scale;
    const py = (e.clientY - r.top) / v.scale;
    const img = v.sc.layout.img;
    const nx = (px - img.x) / img.w;
    const ny = (py - img.y) / img.h;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    return { nx, ny, sx: e.clientX, sy: e.clientY, img };
  }

  /** 成图区的交互：拖选泳道加分组、点条件行单元格循环 · → − → +、双击组/条件行改名 */
  function bindPointer() {
    const self = this;
    const cv = this.canvas;
    cv.style.cursor = 'default';
    cv.addEventListener('mousedown', (e) => {
      const tool = self.app.annotationTool;
      if (tool) {
        const p2 = normAt(self, e);
        if (p2) {
          const lane = (function () {
            const lanes = self.view.sc.layout.lanes || [];
            let best = 0, bd = 1e9;
            lanes.forEach((l, i) => { const d = Math.abs(l.x - (p2.img.x + self.app.doc.laneCenters[i] * p2.img.w)); if (d < bd) { bd = d; best = i; } });
            return best;
          })();
          if (tool === 'band') {
            const mk = self.app.doc.marker || {};
            let text = '';
            try {
              const sc = self.view.sc;
              const ticks = (sc.items || []).filter((i) => i.kind === 'line' && i.x2 === self.view.sc.layout.img.x && i.x1 < i.x2);
              let bestD = 1e9, bestText = '';
              (sc.items || []).forEach((it) => {
                if (it.kind !== 'text' || !/^[0-9]+$/.test(String(it.text))) return;
                const ty = (it.y - p2.img.y) / p2.img.h;
                const d = Math.abs(ty - p2.ny);
                if (it.x < p2.img.x && d < bestD) { bestD = d; bestText = it.text; }
              });
              text = bestText;
            } catch (err) { text = ''; }
            self.app.addAnnotation({ kind: 'band', lanes: [lane], y: p2.ny, text: text, arrow: true });
          } else if (tool === 'text') {
            const ann = self.app.addAnnotation({ kind: 'text', x: p2.nx, y: p2.ny, text: '', side: 'below', offsetPct: p2.nx * 100 });
            self.app.annotationTool = null;
            if (self.app.annotationHintRefresh) self.app.annotationHintRefresh();
            self.app.refresh();
            self.openTextPop(ann);
          } else if (tool === 'box' || tool === 'bracket') {
            self.dragAnn = { tool, x0: p2.nx, y0: p2.ny, x: p2.nx, y: p2.ny, sx: p2.sx, sy: p2.sy, lane: lane };
            e.preventDefault();
          }
          return;
        }
      }
      const hit = self.hitAt(e);
      if (!hit) return;
      if (hit.type === 'cond') {
        self.app.cycleCondition(hit.row, hit.lane);
        return;
      }
      if (hit.type === 'drug') {
        // 记下来，等 mouseup 之后再开输入框：否则同一次点击的 blur 会立刻把它提交掉
        self.pendingEdit = { kind: 'drug', row: hit.row, rect: hit.rect };
        return;
      }
      if (hit.type === 'text') {
        const v0 = self.app && self.app.doc ? null : null;
        self.dragText = { ann: hit.ann, startX: e.clientX, startY: e.clientY, moved: false };
        e.preventDefault();
        return;
      }
      if (hit.type === 'group') {
        self.pendingEdit = { kind: 'group', ann: hit.ann, rect: hit.rect };
        return;
      }
      if (hit.type === 'lane') {
        self.drag = { a: hit.lane, b: hit.lane };
        e.preventDefault();
      }
    });
    cv.addEventListener('mousemove', (e) => {
      if (self.dragText) {
        const d = self.dragText;
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) > 2) d.moved = true;
        if (d.moved) {
          const v = self.view;
          const r = cv.getBoundingClientRect();
          const img = v.sc.img || v.sc.layout.img;
          const xPt = (e.clientX - r.left) / v.scale;
          const yPt = (e.clientY - r.top) / v.scale;
          const side = d.ann.side || 'below';
          let pct;
          if (side === 'left' || side === 'right') pct = ((yPt - img.y) / img.h) * 100;
          else pct = ((xPt - img.x) / img.w) * 100;
          // 不允许拖出图片区域
          d.ann.offsetPct = Math.max(0, Math.min(100, pct));
          self.app.refresh();
          return;
        }
      }
      if (self.dragAnn) {
        const p2 = normAt(self, e);
        if (p2) {
          self.dragAnn.x = p2.nx; self.dragAnn.y = p2.ny;
          self.drawAnnPreview && self.drawAnnPreview();
        }
        return;
      }
      if (!self.drag) {
        const h = self.hitAt(e);
        cv.style.cursor = h && h.type === 'text' ? 'grab' : (h && (h.type === 'cond' || h.type === 'drug' || h.type === 'group') ? 'pointer' : (h ? 'ew-resize' : 'default'));
        return;
      }
      const h = self.hitAt(e);
      if (h && h.type === 'lane' && h.lane !== self.drag.b) {
        self.drag.b = h.lane;
        self.drawSelection();
      }
    });
    const finish = () => {
      if (self.dragText) {
        const d = self.dragText;
        self.dragText = null;
        if (!d.moved) self.openTextPop(d.ann);
        else self.app.refresh();
        return;
      }
      if (self.dragAnn) {
        const d = self.dragAnn;
        self.dragAnn = null;
        const x = Math.min(d.x0, d.x), y = Math.min(d.y0, d.y);
        const w = Math.abs(d.x - d.x0), h = Math.abs(d.y - d.y0);
        if (d.tool === 'box' && w > 0.02 && h > 0.02) {
          self.app.addAnnotation({ kind: 'box', x, y, w, h, text: '' });
        } else if (d.tool === 'bracket') {
          self.app.addAnnotation({ kind: 'bracket', x: Math.min(d.x0, d.x), y0: Math.min(d.y0, d.y), y1: Math.max(d.y0, d.y), text: '' });
        }
        self.app.annotationTool = null;
        if (self.app.annotationHintRefresh) self.app.annotationHintRefresh();
        self.app.refresh();
        return;
      }
      const pending = self.pendingEdit;
      self.pendingEdit = null;
      if (pending) {
        if (pending.kind === 'drug') {
          const cur = (self.app.doc.annotations[pending.row] || {}).drug || '';
          self.editInline(pending.rect, '药物名称', cur, (v) => self.app.setConditionDrug(pending.row, v));
        } else if (pending.kind === 'group') {
          self.editInline(pending.rect, '组名', pending.ann.name || '', (v) => self.app.renameGroup(pending.ann, v));
        }
        return;
      }
      if (!self.drag) return;
      // 单击（没有拖动）泳道名 = 改名；拖动过 = 建分组
      if (self.drag.a === self.drag.b) {
        const lane = self.drag.a;
        self.drag = null;
        self.drawSelection && self.draw();
        self.openLanePop(lane);
        return;
      }
      const { a, b } = self.drag;
      self.drag = null;
      self.draw();
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const g = self.app.addGroup(lo, hi, '');
      const sc = self.view && self.view.sc;
      if (!sc) return;
      const lane = sc.layout.lanes[lo] || sc.layout.lanes[0];
      const x = (lane ? lane.x : sc.layout.img.x) * self.view.scale - 30;
      const y = (sc.layout.namesBaseline - self.app.doc.style.fontPt * 1.5) * self.view.scale;
      self.editInline({ x, y, w: 120, h: 22 }, '组名（如 Ctrl）', '', (v) => self.app.renameGroup(g, v));
    };
    /** 打开第 lane 道的改名输入框；回车提交后自动跳到下一道 */
    const openLaneEdit = function openLaneEdit(lane) {
      const self = this;
      const view = self.view;
      if (!view || !self.app.doc) return;
      const lay = view.sc.layout, v = view;
      const x = (lay.img.x + (self.app.doc.laneCenters[lane] || 0) * lay.img.w) * v.scale;
      const rect = { x: x - 60, y: (lay.namesBaseline - 9) * v.scale, w: 120, h: 22 };
      const cur = (self.app.doc.laneNames || [])[lane];
      const last = (self.app.doc.laneCount || 0) - 1;
      const next = lane < last ? function () { openLaneEdit.call(self, lane + 1); } : null;
      self.editInline(
        rect,
        '泳道名（留空 = 不显示）',
        cur == null ? '' : cur,
        function (txt) { self.app.setLaneName(lane, txt); },
        next
      );
    };
    window.addEventListener('mouseup', finish);
    cv.addEventListener('dblclick', (e) => {
      const h = self.hitAt(e);
      if (!h) return;
      if (h.type === 'group') self.editInline(h.rect, '组名', h.ann.name || '', (v) => self.app.renameGroup(h.ann, v));
      if (h.type === 'drug') self.editInline(h.rect, '药物名称', self.app.doc.annotations[h.row].drug || '', (v) => self.app.setConditionDrug(h.row, v));
    });
  }

  /** 成图里的命中测试（返回 lane / group / drug / cond） */
  function hitAt(e) {
    const v = this.view;
    if (!v || !this.app.doc) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / v.scale;
    const y = (e.clientY - rect.top) / v.scale;
    const sc = v.sc;
    const lay = sc.layout;
    const fp = this.app.doc.style.fontPt || 9;
    const img = lay.img;
    const laneIdx = (px) => {
      let best = 0, bd = Infinity;
      lay.lanes.forEach((l, i) => { const d = Math.abs(l.x - px); if (d < bd) { bd = d; best = i; } });
      return best;
    };

    const conds = this.app.doc.annotations.filter((a) => a.kind === 'condition');

    // 样品名与条件行挨得很近：按「离哪条基线更近」判断，而不是靠两段区间硬切
    let bestCond = -1, bestCondY = 0, bestCondD = Infinity;
    const condRows = lay.condRows || [];
    conds.forEach((c, i) => {
      const ry = condRows[i] ? condRows[i].y : (lay.condBaseline - (conds.length - 1 - i) * fp * 1.3);
      const d = Math.abs(y - ry);
      if (d < bestCondD) { bestCondD = d; bestCond = i; bestCondY = ry; }
    });
    const dName = Math.abs(y - lay.namesBaseline);
    if (dName < fp * 1.3 && dName <= bestCondD) {
      return { type: 'lane', lane: laneIdx(x) };
    }
    if (bestCond >= 0 && bestCondD < fp * 0.9) {
      if (x < img.x - 2) {
        return { type: 'drug', row: bestCond, rect: { x: 0, y: (bestCondY - fp) * v.scale, w: Math.max(60, img.x * v.scale), h: fp * 1.6 * v.scale } };
      }
      return { type: 'cond', row: bestCond, lane: laneIdx(x) };
    }

    // 已有侧边文字：点到文字附近就打开属性卡
    const stx = this.app.doc.style || {};
    const txts = this.app.doc.annotations.filter((a) => a.kind === 'text');
    for (let i = 0; i < txts.length; i++) {
      const t = txts[i];
      const size = t.fontPt || fp;
      const pct = (t.offsetPct == null ? 50 : t.offsetPct) / 100;
      let tx = img.x + img.w * pct;
      let ty = img.y + img.h + fp * (stx.antibody ? 2.6 : 1.5);
      if (t.side === 'above') ty = lay.namesBaseline - fp * 1.4;
      else if (t.side === 'left') { tx = img.x - lay.leftPad + fp * 0.2; ty = img.y + img.h * pct; }
      else if (t.side === 'right') { tx = img.x + img.w + fp * 0.4; ty = img.y + img.h * pct; }
      const w = Math.max(24, String(t.text || '').length * size * 0.55);
      const h = size * 1.6;
      const centered = t.side === 'below' || t.side === 'above';
      const left = centered ? tx - w / 2 : tx;
      if (x > left - 6 && x < left + w + 6 && y > ty - h && y < ty + h) {
        return { type: 'text', ann: t, rect: { x: tx * v.scale, y: (ty - h) * v.scale, w: w * v.scale, h: h * v.scale } };
      }
    }

    // 已有分组的组名 / 横线
    const groups = this.app.doc.annotations.filter((a) => a.kind === 'group');
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!g.lanes.length) continue;
      const l0 = lay.lanes[g.lanes[0]], l1 = lay.lanes[g.lanes[g.lanes.length - 1]];
      if (!l0 || !l1) continue;
      if (y > fp * 0.4 && y < fp * 1.6 && x > l0.x - lay.pitch / 2 && x < l1.x + lay.pitch / 2) {
        return {
          type: 'group', ann: g,
          rect: { x: (l0.x - lay.pitch / 2) * v.scale, y: 0, w: (l1.x - l0.x + lay.pitch) * v.scale, h: fp * 1.8 * v.scale }
        };
      }
    }
    return null;
  }

  /** 拖选过程中的高亮 */
  function drawSelection() {
    this.draw();
    const v = this.view;
    if (!v || !this.drag) return;
    const lay = v.sc.layout;
    const lo = Math.min(this.drag.a, this.drag.b), hi = Math.max(this.drag.a, this.drag.b);
    const l0 = lay.lanes[lo], l1 = lay.lanes[hi];
    if (!l0 || !l1) return;
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(76,140,255,.22)';
    const x0 = (l0.x - lay.pitch / 2) * v.scale;
    const x1 = (l1.x + lay.pitch / 2) * v.scale;
    ctx.fillRect(x0, 0, x1 - x0, (lay.img.y) * v.scale);
    ctx.restore();
  }

  /** 成图上的就地输入框 */
  function editInline(rect, placeholder, value, onDone, onEnter) {
    const self = this;
    if (this.inlineEl) { try { this.inlineEl.remove(); } catch (e) {} this.inlineEl = null; }
    const input = document.createElement('input');
    input.className = 'fig-inline';
    input.placeholder = placeholder;
    input.value = value || '';
    input.style.left = Math.max(2, rect.x) + 'px';
    input.style.top = Math.max(2, rect.y) + 'px';
    input.style.width = Math.max(90, rect.w || 120) + 'px';
    this.wrap.appendChild(input);
    this.inlineEl = input;
    input.focus();
    input.select();
    const openedAt = Date.now();
    let done = false;
    const commit = (force, then) => {
      if (done) return;
      // 刚打开的输入框不该被同一次点击的 blur 提交掉；回车/失焦时间够久则正常提交
      if (!force && Date.now() - openedAt < 80) return;
      done = true;
      const v = input.value.trim();
      try { if (input.isConnected) input.remove(); } catch (e) {}
      self.inlineEl = null;
      if (v !== '' || value !== '') onDone(v);
      self.draw();
      if (then) setTimeout(then, 0);   // 回车 → 跳到下一个样品
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true, onEnter); }
      if (ev.key === 'Escape') { ev.preventDefault(); done = true; try { input.remove(); } catch (e) {} self.inlineEl = null; self.draw(); }
    });
    input.addEventListener('blur', () => commit(false));
  }

  /** 依据裁切区平均亮度选墨色：暗图白字、亮图黑字 */
  function inkFor(canvas, px) {
    try {
      if (!canvas || !px) return '#000';
      const ctx = canvas.getContext('2d');
      const w = Math.max(1, Math.min(px.w, 512));
      const h = Math.max(1, Math.min(px.h, 512));
      const d = ctx.getImageData(px.x, px.y, w, h).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 37) { sum += d[i]; n++; }
      return (sum / Math.max(1, n)) < 110 ? '#fff' : '#000';
    } catch (e) { return '#000'; }
  }

  /** 画所有矢量元素（rect/circle/line/text），image 由调用方自己贴。
   *  预览与导出必须共用这一份，否则“所见即所得”就失效了。 */
  function paintVector(ctx, items, scale, font) {
    items.forEach((it) => {
      if (it.kind === 'image') return;
      if (it.kind === 'rect') {
        ctx.strokeStyle = it.color || '#000';
        ctx.lineWidth = Math.max(0.5, it.width * scale);
        if (it.fill && it.fill !== 'none') { ctx.fillStyle = it.fill; ctx.fillRect(it.x * scale, it.y * scale, it.w * scale, it.h * scale); }
        ctx.strokeRect(it.x * scale, it.y * scale, it.w * scale, it.h * scale);
      } else if (it.kind === 'circle') {
        ctx.strokeStyle = it.color || '#000';
        ctx.lineWidth = Math.max(0.5, it.width * scale);
        ctx.beginPath();
        ctx.arc(it.x * scale, it.y * scale, it.r * scale, 0, Math.PI * 2);
        if (it.fill && it.fill !== 'none') { ctx.fillStyle = it.fill; ctx.fill(); }
        ctx.stroke();
      } else if (it.kind === 'line') {
        ctx.strokeStyle = it.color || '#000';
        ctx.lineWidth = Math.max(0.5, it.width * scale);
        ctx.beginPath();
        ctx.moveTo(it.x1 * scale, it.y1 * scale);
        ctx.lineTo(it.x2 * scale, it.y2 * scale);
        ctx.stroke();
      } else if (it.kind === 'text') {
        ctx.save();
        ctx.font = (it.italic ? 'italic ' : '') + (it.size * scale) + 'px ' + (it.family || font);
        ctx.textAlign = it.align === 'center' ? 'center' : (it.align === 'right' ? 'right' : 'left');
        ctx.textBaseline = it.anchor === 'middle' ? 'middle' : 'alphabetic';
        ctx.translate(it.x * scale, it.y * scale);
        if (it.rotate) ctx.rotate(it.rotate * Math.PI / 180);
        if (it.halo) {
          ctx.strokeStyle = it.haloColor || '#fff';
          ctx.lineWidth = Math.max(1, it.size * scale * 0.18);
          ctx.strokeText(it.text, 0, 0);
        }
        ctx.fillStyle = it.color || '#000';
        ctx.fillText(it.text, 0, 0);
        ctx.restore();
      }
    });
  }

  FigureView.inkFor = inkFor;
  FigureView.paintVector = paintVector;
  FigureView.bindPointer = bindPointer;
  FigureView.hitAt = hitAt;
  FigureView.drawSelection = drawSelection;
  FigureView.editInline = editInline;
  /** 侧边文字的属性卡（成图区内弹出，样式对齐参考图） */
  /** 泳道名属性卡：字号 / 字体 / 颜色都可以单独调，回车跳到下一道 */
  FigureView.openLanePop = function (lane) {
    const self = this;
    const doc = self.app && self.app.doc;
    if (!doc || !self.wrap) return;
    if (self._pop) { self._pop.remove(); self._pop = null; }
    doc.laneStyle = doc.laneStyle || {};
    const key = String(lane);
    const st = doc.laneStyle[key] || {};
    const names = doc.laneNames || [];
    const total = doc.laneCount || names.length;

    const pop = document.createElement('div');
    pop.className = 'fig-pop';
    const fontOpts = ['<option value="">跟随全局</option>'].concat(
      (W.doc.FONTS || ['Arial']).map(function (f) { return '<option value="' + f + '">' + f + '</option>'; })
    ).join('');
    pop.innerHTML = ''
      + '<h4>泳道名 · 第 ' + (lane + 1) + ' 道</h4>'
      + '<input type="text" data-role="pop-lane-text" placeholder="留空 = 这一道不显示">'
      + '<label class="pop-row"><span>字号</span> <input type="number" class="num-sm" min="4" max="24" step="0.5" data-role="pop-lane-pt"> <span>pt</span>'
      + '<span class="tip small">留空 = 跟随全局</span></label>'
      + '<label class="pop-row">字体 <select data-role="pop-lane-font">' + fontOpts + '</select></label>'
      + '<label class="pop-row">颜色 <select data-role="pop-lane-color">'
      + '<option value="auto">默认</option><option value="#000000">黑</option><option value="#ffffff">白</option>'
      + '<option value="#b00020">深红</option><option value="#103a70">深蓝</option></select></label>'
      + '<div class="pop-actions">'
      + '<button type="button" class="btn tiny" data-act="pop-prev">上一道</button>'
      + '<button type="button" class="btn tiny" data-act="pop-next">下一道</button>'
      + '<button type="button" class="btn tiny" data-act="pop-clear">恢复默认</button>'
      + '<button type="button" class="btn tiny primary" data-act="pop-done">完成</button></div>';
    self.wrap.appendChild(pop);
    self._pop = pop;

    // 卡片贴着这一道的名字放
    const v = self.view;
    if (v) {
      const lay = v.sc.layout;
      const x = (lay.img.x + (doc.laneCenters[lane] || 0) * lay.img.w) * v.scale;
      const y = (lay.namesBaseline - 10) * v.scale;
      pop.style.left = Math.max(8, Math.min(self.wrap.clientWidth - 300, x - 140)) + 'px';
      pop.style.top = Math.max(8, y + 26) + 'px';
    }

    const q = (sel) => pop.querySelector(sel);
    const text = q('[data-role=pop-lane-text]');
    const ptEl = q('[data-role=pop-lane-pt]');
    const fontEl = q('[data-role=pop-lane-font]');
    const colorEl = q('[data-role=pop-lane-color]');
    text.value = names[lane] == null ? '' : names[lane];
    ptEl.value = st.pt ? String(st.pt) : '';
    fontEl.value = st.family || '';
    colorEl.value = st.color || 'auto';

    const apply = () => {
      self.app.setLaneName(lane, text.value);
      const next = {};
      if (ptEl.value !== '') next.pt = Number(ptEl.value);
      if (fontEl.value) next.family = fontEl.value;
      if (colorEl.value && colorEl.value !== 'auto') next.color = colorEl.value;
      if (Object.keys(next).length) doc.laneStyle[key] = next; else delete doc.laneStyle[key];
      self.app.refresh();
    };
    text.addEventListener('input', apply);
    ptEl.addEventListener('change', apply);
    fontEl.addEventListener('change', apply);
    colorEl.addEventListener('change', apply);
    text.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        apply();
        const nextLane = lane + 1;
        pop.remove(); self._pop = null;
        if (nextLane < total) self.openLanePop(nextLane);
      }
      if (ev.key === 'Escape') { pop.remove(); self._pop = null; }
    });
    q('[data-act=pop-prev]').addEventListener('click', () => { apply(); pop.remove(); self._pop = null; if (lane > 0) self.openLanePop(lane - 1); });
    q('[data-act=pop-next]').addEventListener('click', () => { apply(); pop.remove(); self._pop = null; if (lane + 1 < total) self.openLanePop(lane + 1); });
    q('[data-act=pop-clear]').addEventListener('click', () => {
      delete doc.laneStyle[key];
      ptEl.value = ''; fontEl.value = ''; colorEl.value = 'auto';
      self.app.refresh();
    });
    q('[data-act=pop-done]').addEventListener('click', () => { apply(); pop.remove(); self._pop = null; });
    text.focus();
    text.select();
  };

  FigureView.openTextPop = function (ann) {
    const self = this;
    if (!ann || !self.wrap) return;
    if (self._pop) { self._pop.remove(); self._pop = null; }
    const pop = document.createElement('div');
    pop.className = 'fig-pop';
    pop.innerHTML = ''
      + '<h4>\u4fa7\u8fb9\u6587\u5b57</h4>'
      + '<input type="text" data-role="pop-text" placeholder="\u5982 Coomassie\u3001EtBr\u3001IB: anti-HA\u3001">'
      + '<label class="pop-row">\u4f4d\u7f6e <select data-role="pop-side">'
      + '<option value="below">\u80f6\u56fe\u4e0b\u65b9</option><option value="above">\u80f6\u56fe\u4e0a\u65b9</option>'
      + '<option value="left">\u56fe\u5de6\u4fa7</option><option value="right">\u56fe\u53f3\u4fa7</option></select></label>'
      + '<div class="pop-row">\u5de6\u53f3\u4f4d\u7f6e <input type="range" min="0" max="100" step="1" data-role="pop-offset"><b data-role="pop-pct">50%</b></div>'
      + '<p class="tip small">\u7528\u4e8e\u6ce8\u660e\u67d3\u8272\u65b9\u6cd5\u3001\u6297\u4f53\u6216\u66dd\u5149\u65f6\u95f4\uff1b\u62d6\u52a8\u6ed1\u5757\u53ef\u8ba9\u5b83\u907f\u5f00 Marker \u6570\u5b57\u6216\u5176\u5b83\u6587\u5b57\u3002</p>'
      + '<label class="pop-row"><span>\u5b57\u53f7</span> <input type="number" class="num-sm" min="4" max="24" step="0.5" data-role="pop-size"> <span>pt</span>'
      + '<span class="tip small">\u7559\u7a7a = \u8ddf\u968f\u5168\u5c40\u5b57\u53f7</span></label>'
      + '<label class="pop-row">\u989c\u8272 <select data-role="pop-color">'
      + '<option value="auto">\u9ed8\u8ba4</option><option value="#000000">\u9ed1</option><option value="#ffffff">\u767d</option>'
      + '<option value="#b00020">\u6df1\u7ea2</option><option value="#103a70">\u6df1\u84dd</option></select></label>'
      + '<div class="pop-actions"><button type="button" class="btn tiny danger" data-act="pop-del">\u5220\u9664</button>'
      + '<button type="button" class="btn tiny primary" data-act="pop-done">\u5b8c\u6210</button></div>';
    self.wrap.appendChild(pop);
    self._pop = pop;
    const q = (sel) => pop.querySelector(sel);
    const text = q('[data-role=pop-text]');
    const side = q('[data-role=pop-side]');
    const off = q('[data-role=pop-offset]');
    const pctEl = q('[data-role=pop-pct]');
    const size = q('[data-role=pop-size]');
    const color = q('[data-role=pop-color]');
    text.value = ann.text || '';
    side.value = ann.side || 'below';
    const pct = ann.offsetPct == null ? 50 : ann.offsetPct;
    off.value = String(Math.round(pct));
    pctEl.textContent = Math.round(pct) + '%';
    size.value = ann.fontPt == null ? '' : String(ann.fontPt);
    color.value = ann.color || 'auto';

    const apply = () => {
      ann.text = text.value;
      ann.side = side.value;
      ann.offsetPct = Number(off.value);
      ann.fontPt = size.value === '' ? null : Number(size.value);
      ann.color = color.value;
      pctEl.textContent = Math.round(Number(off.value)) + '%';
      if (self.app.paintAnnotations) self.app.paintAnnotations();
      self.draw();
      try { self.app.paintIssues && self.app.paintIssues(); } catch (e) {}
    };
    text.addEventListener('input', apply);
    side.addEventListener('change', apply);
    off.addEventListener('input', apply);
    size.addEventListener('change', apply);
    color.addEventListener('change', apply);
    q('[data-act=pop-del]').addEventListener('click', () => {
      W.annotations.remove(self.app.doc, ann.id);
      pop.remove(); self._pop = null;
      self.app.refresh();
    });
    q('[data-act=pop-done]').addEventListener('click', () => { pop.remove(); self._pop = null; self.app.refresh(); });
    text.focus();
    const r = self.canvas.getBoundingClientRect();
    const wr = self.wrap.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(wr.width - 280, r.left - wr.left + 40)) + 'px';
    pop.style.top = Math.max(8, r.top - wr.top + 24) + 'px';
    return pop;
  };

  /** 当前成图的缩略图（dataURL），暂存列表用 */
  FigureView.thumbnail = function (maxW) {
    const c = this.canvas;
    if (!c || !c.width) return '';
    const w = Math.max(24, Math.min(maxW || 160, c.width));
    const h = Math.max(1, Math.round(c.height * (w / c.width)));
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, 0, 0, w, h);
    return t.toDataURL('image/png');
  };

  W.figureview = FigureView;
})(window.WA = window.WA || {});
