/* 成图布局（纯计算）。
 *
 * 版式（自上而下，参照论文里的 WB 图）：
 *   上级组名（可选，横跨全图） → 组名（带下划线） → 条件行（−/+）
 *   → 样品名（泳道名，默认水平） → 图片（左侧**框外** Marker 刻度与数值） → 抗体说明（右下）
 * 坐标单位 pt。 */
(function (W) {
  'use strict';

  function labelHeight(fontPt, angleDeg, text) {
    const rad = Math.abs((angleDeg || 0) * Math.PI / 180);
    const w = Math.max(1, String(text || 'W').length) * fontPt * 0.6;
    return Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * fontPt * 1.25;
  }

  /** 估算字宽：中文按 1.0 em，西文/数字/空格按 0.55 em（GelFigure 用 canvas 实测，这里保持纯函数） */
  function textWidth(text, fontPt) {
    const t = String(text || '');
    let n = 0;
    for (const ch of t) n += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.55;
    return Math.max(1, n) * fontPt;
  }


  /* 组的分层（照 GelFigure 的 groupTiers 重写）：
   * - 参与比较的是「线的外延」而不是泳道区间：ext0 = min(线起点, 文字左边)，ext1 = max(线终点, 文字右边)。
   *   这样长组名顶出线外也不会和隔壁组的名字撞在一起。
   * - 窄的组优先占靠近胶图的那一层，宽组被顶到上面，于是嵌套自然成阶梯。
   * - 层高按该层最高的那一行文字算，多行组名也不会压到下一层。 */
  function groupTiers(items, pad) {
    const tiers = [];
    items.slice().sort(function (a, b) { return (a.x1 - a.x0) - (b.x1 - b.x0); }).forEach(function (o) {
      let t = 0;
      while ((tiers[t] || []).some(function (q) {
        return !(o.ext1 + pad < q.ext0 || o.ext0 - pad > q.ext1);
      })) t++;
      (tiers[t] = tiers[t] || []).push(o);
      o.tier = t;
    });
    return tiers;
  }

  /** 按宽度折行（贪心，按空格/中文逐字） */
  function wrapText(text, pt, maxW) {
    const out = [];
    const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
    String(text).split('\n').forEach(function (par) {
      const toks = par.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g) || [];
      let cur = '';
      const push = function () { if (cur !== '') { out.push(cur.replace(/\s+$/, '')); cur = ''; } };
      toks.forEach(function (t) {
        if (/^\s+$/.test(t)) { if (cur) cur += ' '; return; }
        if (textWidth(cur + t, pt) <= maxW) { cur += t; return; }
        push();
        if (textWidth(t, pt) <= maxW) { cur = t; return; }
        let piece = '';
        for (const ch of t) {
          if (textWidth(piece + ch, pt) > maxW && piece) { out.push(piece); piece = ''; }
          piece += ch;
        }
        cur = piece;
      });
      push();
    });
    return out.filter(function (l, i, a) { return String(l).trim() || a.length === 1; });
  }

  /**
   * @param {object} o
   *   { cropW, cropH, widthMm, fontPt, laneCenters, laneNames, angle, showLaneNames,
   *     groupCount, condCount, markerLabels, showUnit, unit, antibody }
   */
  function layout(o) {
    const fp = o.fontPt || 9;
    const widthPt = W.util.mmToPt(o.widthMm || 85);
    const centers = o.laneCenters || [];
    const names = o.laneNames || [];
    const angle = o.angle || 0;
    const show = o.showLaneNames !== false && centers.length > 0;

    const fpName = o.laneNamePt || fp;
    const laneStyle = o.laneStyle || {};
    // 每道可以有自己的字号（没设就跟随全局）
    const nameSizes = centers.map(function (_, i) {
      const st = laneStyle[String(i)] || laneStyle[i];
      return (st && st.pt) || fpName;
    });
    const maxLabelH = show
      ? Math.max.apply(null, centers.map(function (_, i) {
        return labelHeight(nameSizes[i], angle, names[i] || String(i + 1));
      }).concat([fpName]))
      : 0;

    // 左侧留给框外 Marker 数值 + 单位
    const markerLabels = (o.markerLabels || []).map(String);
    const fpMark = o.markerPt || fp * 0.85;
    const widest = markerLabels.length ? Math.max.apply(null, markerLabels.map(function (t) { return textWidth(t, fpMark); })) : 0;
    const unitW = o.showUnit ? textWidth('(' + (o.unit || 'kDa') + ')', fp * 0.8) : 0;
    // 条件行：每行可带自己的字号（GelFigure 的 c.pt），行距 = 1.3 × 该行字号
    const condRows = (o.condRows && o.condRows.length)
      ? o.condRows.map(function (r) { return { name: String(r.name || ''), pt: r.pt || fp }; })
      : (o.condCount || 0) > 0
        ? (function () {
          const names = o.condNames || [];
          const out = [];
          for (let i = 0; i < (o.condCount || 0); i++) out.push({ name: String(names[i] || ''), pt: fp });
          return out;
        })()
        : [];
    // 药名画在图框左侧、与 Marker 数值同一条右对齐线
    const condW = condRows.length ? Math.max.apply(null, condRows.map(function (r) { return textWidth(r.name, r.pt); })) : 0;
    // 左侧留白：既要放下最宽的数字/单位/药名，还要留出「文字↔刻度↔图框」两段等宽间隙
    const sideGap = fp * 0.42 * 2 + fp * 0.6;
    const leftPad = Math.max(fp * 0.8, Math.max(widest, unitW, condW) + sideGap + fp * 0.9);

    const titleBand = o.title ? fp * 1.6 : 0;

    // —— 分组：先算线的位置与外延，再分层，最后才知道要留多高 ——
    const groupsIn = (o.groups || []).filter(function (g) { return g && g.lanes && g.lanes.length; });
    const imgW0 = widthPt - leftPad - fp * 0.4;
    const laneX0 = centers.map(function (c) { return leftPad + c * imgW0; });
    const pitch0 = laneX0.length > 1 ? (laneX0[1] - laneX0[0]) : imgW0;
    const half = Math.min(pitch0, imgW0) * 0.42;
    const gItems = groupsIn.map(function (g, i) {
      const a = Math.min.apply(null, g.lanes);
      const b = Math.max.apply(null, g.lanes);
      const x0 = laneX0[a] - half;
      const x1 = laneX0[b] + half;
      const cx = (x0 + x1) / 2;
      const size = g.pt || fp;
      let text = String(g.name == null ? '' : g.name);
      let lines = text ? text.split('\n') : [];
      const room = Math.max(x1 - x0, size * 2);
      const widest = function (pt) { return lines.length ? Math.max.apply(null, lines.map(function (t) { return textWidth(t, pt || size); })) : 0; };
      let size2 = size;
      if (text && o.groupFit !== 'none' && widest() > room) {
        if (o.groupFit === 'shrink') {
          // 缩字号直到塞得下，下限 minFontPt
          const floor = Math.max(3, Math.min(size, o.minFontPt || 5));
          let pt = size;
          while (pt > floor && widest(pt) > room) pt -= 0.5;
          size2 = pt;
        } else {
          lines = wrapText(text, size, room);
        }
      }
      const tw = widest(size2);
      const lineH0 = size * 1.15;
      const h = lines.length ? size * 0.3 + (lines.length - 1) * lineH0 + size : fp;
      return { g: g, i: i, x0: x0, x1: x1, cx: cx, size: size2, lines: lines, tw: tw, h: h,
        ext0: Math.min(x0, cx - tw / 2), ext1: Math.max(x1, cx + tw / 2) };
    });
    const tiers = groupTiers(gItems, fp * 0.25);
    const tierH = tiers.map(function (ts) {
      return Math.max(fp * 1.7, Math.max.apply(null, ts.map(function (o) { return o.h + fp * 0.4; })));
    });
    let groupBand = tierH.reduce(function (a, b) { return a + b; }, 0);
    // 兼容：只给了 groupCount、没给 groups 时，至少留一层的空（老调用方/老测试）
    if (!groupBand && (o.groupCount || 0) > 0) groupBand = fp * 1.7;

    const condPitch = condRows.map(function (r) { return r.pt * 1.3; });
    const condBand = condPitch.reduce(function (a, b) { return a + b; }, 0);
    // 与 GelFigure 一致：泳道名基线离图顶是一个固定小间隙（labelGapPt≈2.5）
    const gapNames = Math.max(2.2, fp * 0.28);
    // 泳道名与条件行之间要像分组行那样留出整行间距，否则两行字会「叠」在一起
    const gapNamesCond = condRows.length ? fp * 1.15 : 0;
    // 整行都没名字时不占高度（导出时不留空行，上面的组名/条件行会跟着下沉）
    const anyName = names.some(function (t) { return String(t == null ? '' : t).trim() !== ''; });
    const namesBand = (show && anyName) ? maxLabelH + gapNames : 0;
    const bottomBand = Math.max(o.antibody ? fp * 1.9 : fp * 0.5, (o.textBelow || 0) > 0 ? (o.antibody ? fp * 4.2 : fp * 2.6) : 0);

    const imgW = widthPt - leftPad - fp * 0.4;
    const imgH = imgW * (o.cropH / o.cropW);
    const imgX = leftPad;
    const namesAbove = o.laneNamesAbove !== false;

    // —— 顶部堆叠：自左栏顶往下排，先算人名/条件行的基线，再定图顶 ——
    const stackTop = fp * 0.6 + titleBand + groupBand;
    const condBaselines = [];
    let namesBaseline = 0, cursor = stackTop;
    const placeConds = function () {
      let acc = 0;
      condRows.forEach(function (r, i) {
        condBaselines[i] = cursor + acc;   // 与 GelFigure 一致：yTop 就是基线，逐行 -= pt*1.3
        acc += condPitch[i];
      });
      cursor += acc;
    };
    if (namesAbove) {
      namesBaseline = cursor + maxLabelH;
      cursor += namesBand + gapNamesCond;
      placeConds();
    } else {
      placeConds();
      cursor += gapNamesCond;
      namesBaseline = cursor + maxLabelH;
      cursor += namesBand;
    }
    const imgY = cursor;
    const img = { x: imgX, y: imgY, w: imgW, h: imgH };

    const lanes = centers.map(function (c, i) {
      const raw = names[i];
      const st = laneStyle[String(i)] || laneStyle[i] || {};
      // undefined/缺项才算「没设过」，空字符串是用户主动清空 → 不显示
      return {
        x: img.x + c * img.w,
        text: raw === undefined || raw === null ? String(i + 1) : String(raw),
        size: nameSizes[i],
        family: st.family || null,
        color: st.color && st.color !== 'auto' ? st.color : null
      };
    });
    const numR = fp * 0.62;
    const pitch = lanes.length > 1 ? (lanes[1].x - lanes[0].x) : img.w;

    // 刻度不再紧贴图框：与图框、与数字各留同样宽的空隙（GelFigure 的观感）
    const axisGap = fp * 0.42;
    const axis = {
      gap: axisGap,                   // 刻度↔图框、刻度↔数字的共同间隙
      x: img.x - axisGap,             // 刻度内侧端点（离图框 axisGap）
      tickOut: fp * 0.6,              // 刻度长度
      labelX: img.x - axisGap * 2 - fp * 0.6,  // 数字右对齐到这里，与刻度同样留 axisGap
      unitX: img.x - axisGap * 2 - fp * 0.6,
      // 单位跟着 Marker 刻度走：贴图顶边的左侧留白里，不与条件行抢位置（GelFigure 的做法）
      unitY: img.y + fp * 0.95
    };

    return {
      widthPt,
      heightPt: img.y + img.h + bottomBand,
      img,
      lanes,
      pitch,
      pad: fp * 0.6,
      leftPad,
      bands: { title: titleBand, group: groupBand, cond: condBand, names: namesBand },
      numberRow: { y: img.y - numR * 0.95, r: numR },
      titleBaseline: fp * 0.6 + fp * 1.15,
      groupBaseline: fp * 0.6 + titleBand + fp * 1.1,
      groupBaselines: (function () {
        // 自上而下编号：0 = 最上面那层
        const out = [];
        const bottom = fp * 0.6 + titleBand + groupBand - fp * 0.15;
        let acc = 0;
        for (let i = 0; i < tierH.length; i++) { out.push(bottom - acc); acc += tierH[i]; }
        return out.reverse();   // 自上而下：0 = 最上面那层
      })(),
      groupLevelCount: tierH.length,
      groupItems: (function () {
        const top = fp * 0.6 + titleBand;
        const areaBottom = top + groupBand - fp * 0.15;
        // tier 0 贴近胶图：从底部往上摊
        const bottoms = [];
        let acc = 0;
        for (let t = 0; t < tierH.length; t++) { bottoms.push(areaBottom - acc); acc += tierH[t]; }
        return gItems.map(function (o) {
          const y = bottoms[o.tier];
          return { k: o.i, x0: o.x0, x1: o.x1, cx: o.cx, size: o.size, lines: o.lines, tw: o.tw, tier: o.tier, y: y };
        });
      })(),
      nameSize: fpName,
      markerSize: fpMark,
      namesAbove: namesAbove,
      namesBaseline: namesBaseline,
      antibodyY: img.y + img.h + fp * 1.25,
      // 条件行基线：数组顺序与 doc 一致（0 = 最上面那行）
      condRows: condRows.map(function (r, i) { return { y: condBaselines[i], pt: r.pt, name: r.name }; }),
      condBaseline: condBaselines.length ? condBaselines[0] : (stackTop + fp * 0.95),
      axis
    };
  }

  W.figure = { layout, labelHeight, textWidth, groupTiers, wrapText };
})(window.WA = window.WA || {});
