
/* 六类标注的增删改与夹取。纯函数。 */
(function (W) {
  'use strict';

  const KINDS = ['group', 'band', 'condition', 'box', 'bracket', 'text'];

  function nextId(doc) {
    doc._seq = (doc._seq || 0) + 1;
    return 'a' + doc._seq;
  }

  function clamp01(v) { return W.util.clamp(Number(v) || 0, 0, 1); }

  /** 按类型补齐并夹取字段 */
  function normalize(doc, ann) {
    const a = Object.assign({}, ann);
    if (KINDS.indexOf(a.kind) < 0) throw new Error('未知标注类型：' + a.kind);
    if (!a.id) a.id = nextId(doc);
    if (a.kind === 'group') {
      a.lanes = (a.lanes || []).slice().sort(function (x, y) { return x - y; });
      a.name = String(a.name == null ? '' : a.name);
    } else if (a.kind === 'condition') {
      a.drug = String(a.drug == null ? '' : a.drug);
      // 0 = 无处理（·）、1 = 不加（−）、2 = 加（+）
      // 每行可单独设字号（null = 跟随全局），与 GelFigure 的每行 pt 对应
      a.pt = (a.pt == null || a.pt === '') ? null : W.util.clamp(Number(a.pt), 4, 24);
      a.marks = (a.marks || []).map(function (v) {
        if (v === true) return 2;
        if (v === false || v == null) return 0;
        return Math.max(0, Math.min(2, Math.floor(Number(v) || 0)));
      });
    } else if (a.kind === 'band') {
      a.lane = Math.max(0, Math.floor(Number(a.lane) || 0));
      a.y = clamp01(a.y);
      a.text = String(a.text == null ? '' : a.text);
    } else if (a.kind === 'box') {
      a.x = clamp01(a.x); a.y = clamp01(a.y);
      a.w = W.util.clamp(Number(a.w) || 0.05, 0.01, 1 - a.x);
      a.h = W.util.clamp(Number(a.h) || 0.05, 0.01, 1 - a.y);
      a.text = String(a.text == null ? '' : a.text);
    } else if (a.kind === 'bracket') {
      a.x = clamp01(a.x);
      a.y0 = clamp01(a.y0);
      a.y1 = clamp01(a.y1);
      if (a.y1 < a.y0) { const t = a.y0; a.y0 = a.y1; a.y1 = t; }
      a.text = String(a.text == null ? '' : a.text);
    } else if (a.kind === 'text') {
      a.x = clamp01(a.x); a.y = clamp01(a.y);
      a.text = String(a.text == null ? '' : a.text);
      const sides = ['above', 'below', 'left', 'right'];
      a.side = sides.indexOf(a.side) >= 0 ? a.side : 'below';
      a.offsetPct = W.util.clamp(Number(a.offsetPct == null ? a.x * 100 : a.offsetPct), 0, 100);
      a.fontPt = a.fontPt == null || a.fontPt === '' ? null : W.util.clamp(Number(a.fontPt), 4, 24);
      a.color = a.color || 'auto';
    }
    return a;
  }

  function add(doc, ann) {
    const a = normalize(doc, ann);
    doc.annotations.push(a);
    return a;
  }

  function remove(doc, id) {
    const i = doc.annotations.findIndex(function (a) { return a.id === id; });
    if (i >= 0) doc.annotations.splice(i, 1);
    return i >= 0;
  }

  function get(doc, id) {
    return doc.annotations.filter(function (a) { return a.id === id; })[0] || null;
  }

  function update(doc, id, patch) {
    const i = doc.annotations.findIndex(function (a) { return a.id === id; });
    if (i < 0) return null;
    doc.annotations[i] = normalize(doc, Object.assign({}, doc.annotations[i], patch, { id }));
    return doc.annotations[i];
  }

  /** 选几条泳道填组名 → 自动生成/更新分组横线 */
  function setGroup(doc, lanes, name) {
    const existing = doc.annotations.filter(function (a) {
      return a.kind === 'group' && a.lanes.length === lanes.length && a.lanes.every(function (v, i) { return v === lanes[i]; });
    })[0];
    if (existing) return update(doc, existing.id, { name });
    return add(doc, { kind: 'group', lanes, name });
  }

  function byKind(doc, kind) {
    return doc.annotations.filter(function (a) { return a.kind === kind; });
  }

  W.annotations = { KINDS, normalize, add, remove, get, update, setGroup, byKind };
})(window.WA = window.WA || {});
