/* 场景构建：把文档 + 版式 + 六类标注 变成一串绘图指令（单位 pt，原点左上）。
 * canvas 预览与 SVG 导出共用这一份，保证所见即所得。
 *
 * 绘制顺序与 GelFigure 的版式一致：
 *   组名 + 分组线 → 泳道名（可旋转）→ 泳道编号 / Marker 徽标 → 图片 → Marker 轴（图内左侧）
 *   → 边框 → 目标条带/区域框/侧边括号/侧边文字 → 条件行（图下方） */
(function (W) {
  'use strict';

  const COND_ROW_H = (n) => 0.3 + n * 1.15;

  function scene(doc, o) {
    const st = doc.style;
    const fp = st.fontPt || 9;
    const showLaneNames = st.sampleNamePos !== 'none';
    const unit = doc.mode === 'gel' ? 'bp' : 'kDa';

    const groups = W.annotations.byKind(doc, 'group');
    const conds = W.annotations.byKind(doc, 'condition');
    // 一图可有多孔 ladder：每孔独立泳道 / 型号 / 勾选的条带
    const holes = W.doc.markersOf(doc).map((h) => {
      const ladder = W.ladders.get(h.ladderId || '') || { sizes: [] };
      const chosen = Array.isArray(h.sizes) ? h.sizes : ladder.sizes;
      const assigned = W.marker.assignSizes(h.points || [], chosen);
      return { hole: h, assigned: assigned };
    }).filter((x) => x.assigned.length > 0);
    const assigned = holes.length ? holes[0].assigned : [];
    const markerLabels = assigned.map((p2) => W.marker.formatLabel(p2.kDa, unit));
    // 文字里的 *斜体* 标记：整条去掉星号并按斜体画（v1 简化处理）
    const fmt = function (t) { const s2 = String(t == null ? '' : t); const italic = /\*[^*]+\*/.test(s2); return { text: s2.replace(/\*/g, ''), italic: italic }; };

    const lay = W.figure.layout({
      cropW: o.cropW, cropH: o.cropH, widthMm: doc.exportOptions.widthMm, fontPt: fp,
      laneCenters: doc.laneCenters, laneNames: doc.laneNames,
      angle: st.laneNameAngle, showLaneNames: showLaneNames,
      groups: groups.map((g) => ({ lanes: g.lanes, name: g.name, pt: g.pt })),
      groupFit: st.groupFit || 'wrap',
      minFontPt: st.minFontPt || 5,
      laneNamesAbove: st.laneNamesAbove !== false,
      panelLetter: st.panelLetter || '',
      condCount: conds.length,
      condNames: conds.map(function (c) { return c.drug || ''; }),
      condRows: conds.map(function (c) { return { name: c.drug || '', pt: c.pt || null }; }),
      title: doc.title || '',
      markerLabels: markerLabels, showUnit: markerLabels.length > 0, unit: unit,
      laneNamePt: st.laneNamePt || null, markerPt: st.markerPt || null,
      laneStyle: doc.laneStyle || {},
      antibody: st.antibody || '',
      textBelow: W.annotations.byKind(doc, 'text').filter((t) => (t.side || 'below') === 'below').length
    });

    const items = [];
    const img = lay.img;

    // ⓪ 上级组名：横跨全图的一条线
    if (doc.title) {
      const y0 = lay.titleBaseline;
      items.push({ kind: 'text', x: img.x + img.w / 2, y: y0, text: doc.title, size: fp * 1.05, align: 'center', anchor: 'alphabetic' });
      items.push({ kind: 'line', x1: img.x, y1: y0 + fp * 0.34, x2: img.x + img.w, y2: y0 + fp * 0.34, width: Math.max(0.4, fp * 0.07) });
    }

    // ① 组名 + 横线（分层由 layout 里的 groupTiers 决定）
    if (lay.groupItems && lay.groupItems.length) {
      lay.groupItems.forEach(function (o) {
        const lineY = o.y + o.size * 0.3;
        const lwid = Math.max(0.4, fp * 0.07);
        items.push({ kind: 'line', x1: o.x0, y1: lineY, x2: o.x1, y2: lineY, width: lwid });
        if (st.groupTicks) {
          const tick = fp * 0.45;
          items.push({ kind: 'line', x1: o.x0, y1: lineY, x2: o.x0, y2: lineY + tick, width: lwid });
          items.push({ kind: 'line', x1: o.x1, y1: lineY, x2: o.x1, y2: lineY + tick, width: lwid });
        }
        o.lines.forEach(function (t, li) {
          items.push({
            kind: 'text', x: o.cx, y: o.y - (o.lines.length - 1 - li) * o.size * 1.15,
            text: t, size: o.size, align: 'center', anchor: 'alphabetic'
          });
        });
      });
    }

    // 面板字母（A/B/C）——贴在成图左上角
    if (st.panelLetter) {
      items.push({ kind: 'text', x: fp * 0.4, y: fp * 1.4, text: st.panelLetter, size: fp * 1.5, align: 'left', anchor: 'alphabetic', bold: true });
    }

    // ② 样品名（图上方，默认水平）
    if (showLaneNames) {
      const markerLanes = {};
      holes.forEach((x) => { if (x.hole.lane != null) markerLanes[x.hole.lane] = true; });
      lay.lanes.forEach((l, i) => {
        const label = markerLanes[i] ? 'M' : l.text;
        // 名字挤在一起时按道宽自动缩小字号（参考图里样品名也是小字）
        const cjk = (String(label).match(/[\u4e00-\u9fa5]/g) || []).length;
        const own = l.size || lay.nameSize || fp;    // 这一道自己的字号（没设就跟随全局）
        const wEst = (cjk * 1.0 + (String(label).length - cjk) * 0.55) * own;
        const fit = wEst > lay.pitch * 0.92 ? (lay.pitch * 0.92) / (wEst / own) : own;
        items.push({
          kind: 'text', x: l.x, y: lay.namesBaseline, text: fmt(label).text, italic: fmt(label).italic,
          size: Math.max(5, Math.min(own, fit)), family: l.family || st.fontFamily || null, color: l.color || null,
          align: st.laneNameAngle ? 'left' : 'center', anchor: 'alphabetic',
          rotate: st.laneNameAngle ? -(st.laneNameAngle) : 0
        });
      });
    }

    // ③ 条件行（图**上方**）：药名在图框左侧、与 Marker 数值同一条右对齐线；
    //    行距 = 1.3 × 该行字号（GelFigure 的算法），每行可单独设字号
    const condRows = lay.condRows || [];
    conds.forEach((c, ri) => {
      const row = condRows[ri] || { y: img.y - fp * 0.55, pt: fp };
      const cp = row.pt || fp;
      const base = row.y;
      if (c.drug) {
        items.push({
          kind: 'text', x: lay.axis.labelX, y: base, text: c.drug, size: cp,
          align: 'right', anchor: 'alphabetic', color: c.color && c.color !== 'auto' ? c.color : null
        });
      }
      lay.lanes.forEach((l, i) => {
        const v = c.marks[i] | 0;
        const mark = v === 2 ? '+' : (v === 1 ? '\u2212' : '\u00b7');
        items.push({ kind: 'text', x: l.x, y: base, text: mark, size: cp, align: 'center', anchor: 'alphabetic' });
      });
    });

    // ④ 可选：泳道编号（压在图顶边）
    if (st.showNumbers) {
      const nr = lay.numberRow;
      lay.lanes.forEach((l, i) => {
        if (String(l.text || '').trim() === '') return;   // 这一道被清空 → 不显示
        items.push({ kind: 'circle', x: l.x, y: nr.y, r: nr.r, width: Math.max(0.4, fp * 0.05), fill: 'none' });
        items.push({ kind: 'text', x: l.x, y: nr.y, text: String(i + 1), size: fp * 0.7, align: 'center', anchor: 'middle' });
      });
    }

    // ⑤ 图片
    items.push({ kind: 'image', x: img.x, y: img.y, w: img.w, h: img.h });

    // ⑥ Marker：每孔一条刻度轴。第 1 道画在框外左侧（带数值），其余孔画在该道中线处
    if (holes.length) {
      const ax0 = lay.axis;
      let unitDrawn = false;
      holes.forEach((x, hi) => {
        // 第一孔固定画在图框左边缘（数值在框外）；其余孔画在各自泳道中线处
        const ax = (hi === 0 || x.hole.lane == null || !lay.lanes[x.hole.lane])
          ? { x: ax0.x, inside: false }
          : { x: lay.lanes[x.hole.lane].x, inside: true };
        const tickOut = ax.inside ? fp * 1.05 : ax0.tickOut;
        const labelX = ax.inside ? (ax.x - tickOut - fp * 0.35) : ax0.labelX;
        x.assigned.forEach((p) => {
          const yy = img.y + p.y * img.h;
          items.push({ kind: 'line', x1: ax.x - tickOut, y1: yy, x2: ax.x, y2: yy, width: Math.max(0.5, fp * 0.07), color: ax.inside ? '#c8a200' : '#000000' });
          items.push({
            kind: 'text', x: labelX, y: yy + fp * 0.3,
            text: W.marker.formatLabel(p.kDa, unit),
            size: lay.markerSize || fp * 0.85,
            align: 'right', anchor: 'alphabetic',
            halo: ax.inside, haloColor: ax.inside ? 'rgba(0,0,0,0.85)' : '#fff',
            color: ax.inside ? '#f2f2f2' : null
          });
        });
        if (!unitDrawn) {
          const ys = x.assigned.map((p) => img.y + p.y * img.h);
          const topY = ys.length ? Math.min.apply(null, ys) : (img.y + fp * 1.2);
          items.push({ kind: 'text', x: ax0.unitX, y: Math.min(topY - fp * 1.05, img.y + fp * 1.1), text: '(' + unit + ')', size: fp * 0.85, align: 'right', anchor: 'alphabetic' });
          unitDrawn = true;
        }
      });
    }

    // ⑦ 边框
    if (st.border) items.push({ kind: 'rect', x: img.x, y: img.y, w: img.w, h: img.h, width: st.lineWidthPt });

    // ⑧ 图内标注
    W.annotations.byKind(doc, 'band').forEach((b) => {
      const lane = lay.lanes[b.lane];
      const x = lane ? lane.x : img.x + img.w / 2;
      const yy = img.y + b.y * img.h;
      items.push({ kind: 'line', x1: x - fp * 0.9, y1: yy, x2: x + fp * 0.9, y2: yy, width: Math.max(0.4, fp * 0.07) });
      items.push({ kind: 'text', x: x + fp * 1.1, y: yy, text: b.text, size: fp * 0.92, align: 'left', anchor: 'middle', halo: true, haloColor: '#fff' });
    });

    W.annotations.byKind(doc, 'box').forEach((b) => {
      items.push({
        kind: 'rect', x: img.x + b.x * img.w, y: img.y + b.y * img.h,
        w: b.w * img.w, h: b.h * img.h, width: Math.max(0.4, fp * 0.07)
      });
      if (b.text) items.push({ kind: 'text', x: img.x + b.x * img.w, y: img.y + (b.y + b.h) * img.h + fp * 0.9, text: b.text, size: fp * 0.88, align: 'left', anchor: 'alphabetic', halo: true, haloColor: '#fff' });
    });

    W.annotations.byKind(doc, 'bracket').forEach((b) => {
      const x = img.x + b.x * img.w;
      const y0 = img.y + b.y0 * img.h;
      const y1 = img.y + b.y1 * img.h;
      const cap = fp * 0.55;
      items.push({ kind: 'line', x1: x, y1: y0, x2: x, y2: y1, width: Math.max(0.4, fp * 0.08) });
      items.push({ kind: 'line', x1: x - cap, y1: y0, x2: x, y2: y0, width: Math.max(0.4, fp * 0.08) });
      items.push({ kind: 'line', x1: x - cap, y1: y1, x2: x, y2: y1, width: Math.max(0.4, fp * 0.08) });
      if (b.text) items.push({ kind: 'text', x: x - cap - fp * 0.4, y: (y0 + y1) / 2, text: b.text, size: fp * 0.85, align: 'right', anchor: 'middle', halo: true, haloColor: '#fff' });
    });

    W.annotations.byKind(doc, 'text').forEach((t) => {
      const size = t.fontPt || fp;
      const pct = (t.offsetPct == null ? (t.side === 'left' || t.side === 'right' ? t.y : t.x) * 100 : t.offsetPct) / 100;
      let x = img.x + img.w * pct;
      let yy = img.y + img.h * pct;
      let align = 'center';
      let anchor = 'alphabetic';
      if (t.side === 'below') { yy = img.y + img.h + fp * (st.antibody ? 3.5 : 1.5); }
      else if (t.side === 'above') { yy = lay.namesBaseline - fp * 1.4; }
      else if (t.side === 'left') { x = img.x - lay.leftPad + fp * 0.2; align = 'left'; anchor = 'middle'; }
      else if (t.side === 'right') { x = img.x + img.w + fp * 0.4; align = 'left'; anchor = 'middle'; }
      items.push({
        kind: 'text', x, y: yy, text: t.text, size,
        align, anchor,
        color: t.color === 'auto' || !t.color ? undefined : t.color,
        halo: true, haloColor: '#fff'
      });
    });

    // ⑨ 抗体说明（图右下角；DNA 凝胶不画）
    if (st.antibody && doc.mode !== 'gel') {
      items.push({ kind: 'text', x: img.x + img.w, y: lay.antibodyY, text: st.antibody, size: fp, align: 'right', anchor: 'alphabetic' });
    }

    return { widthPt: lay.widthPt, heightPt: lay.heightPt, layout: lay, items };
  }

  /** SVG 字符串（导出用） */
  function toSvg(doc, sc, o) {
    const st = doc.style;
    const esc = W.util.escapeXml;
    const n = (v) => Number(v).toFixed(2);
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + n(sc.widthPt) + 'pt" height="' + n(sc.heightPt) + 'pt" viewBox="0 0 ' + n(sc.widthPt) + ' ' + n(sc.heightPt) + '">');
    parts.push('<rect x="0" y="0" width="' + n(sc.widthPt) + '" height="' + n(sc.heightPt) + '" fill="#fff"/>');
    const font = (st.fontFamily || 'Arial') + ', sans-serif';
    sc.items.forEach((it) => {
      const stroke = it.color || '#000';
      if (it.kind === 'image') {
        if (o && o.imageHref) {
          parts.push('<image x="' + n(it.x) + '" y="' + n(it.y) + '" width="' + n(it.w) + '" height="' + n(it.h) + '" preserveAspectRatio="none" href="' + o.imageHref + '"/>');
        }
      } else if (it.kind === 'rect') {
        parts.push('<rect x="' + n(it.x) + '" y="' + n(it.y) + '" width="' + n(it.w) + '" height="' + n(it.h) +
          '" rx="' + n(it.radius || 0) + '" fill="' + (it.fill || 'none') + '" stroke="' + stroke + '" stroke-width="' + n(it.width) + '"/>');
      } else if (it.kind === 'circle') {
        parts.push('<circle cx="' + n(it.x) + '" cy="' + n(it.y) + '" r="' + n(it.r) + '" fill="' + (it.fill || 'none') +
          '" stroke="' + stroke + '" stroke-width="' + n(it.width) + '"/>');
      } else if (it.kind === 'line') {
        parts.push('<line x1="' + n(it.x1) + '" y1="' + n(it.y1) + '" x2="' + n(it.x2) + '" y2="' + n(it.y2) +
          '" stroke="' + stroke + '" stroke-width="' + n(it.width) + '"/>');
      } else if (it.kind === 'text') {
        const anchor = it.align === 'center' ? 'middle' : (it.align === 'right' ? 'end' : 'start');
        const rot = it.rotate ? ' transform="rotate(' + it.rotate + ' ' + n(it.x) + ' ' + n(it.y) + ')"' : '';
        const halo = it.halo ? ' stroke="' + (it.haloColor || '#fff') + '" stroke-width="' + n(it.size * 0.18) + '" paint-order="stroke" stroke-linejoin="round"' : '';
        parts.push('<text x="' + n(it.x) + '" y="' + n(it.y) + '" font-family="' + esc(it.family || font) + '" font-size="' + n(it.size) +
          '" fill="' + (it.color || '#000') + '" text-anchor="' + anchor + '" dominant-baseline="' +
          (it.anchor === 'middle' ? 'middle' : 'auto') + '"' + rot + halo + (it.italic ? ' font-style="italic"' : '') + '>' + esc(it.text) + '</text>');
      }
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  W.render = { scene, toSvg };
})(window.WA = window.WA || {});
