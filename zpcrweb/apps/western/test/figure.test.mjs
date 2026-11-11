
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/figure.js', 'core/lanes.js']);

describe('成图布局', () => {
  test('85mm 宽换算成 240.94pt，高度按图比例', () => {
    const L = WA.figure.layout({ cropW: 1600, cropH: 200, widthMm: 85, fontPt: 7, laneCenters: [], laneNames: [] });
    assert.ok(Math.abs(L.widthPt - 240.94) < 0.02, L.widthPt);
    const ratio = L.img.h / L.img.w;
    assert.ok(Math.abs(ratio - 200 / 1600) < 1e-6, ratio);
  });

  test('泳道名位置随中点走', () => {
    const centers = WA.lanes.evenCenters(2);
    const L = WA.figure.layout({ cropW: 1000, cropH: 200, widthMm: 85, fontPt: 7, laneCenters: centers, laneNames: ['A', 'B'] });
    assert.equal(L.lanes.length, 2);
    assert.ok(Math.abs((L.lanes[0].x - L.img.x) / L.img.w - 0.25) < 1e-6);
    assert.ok(Math.abs((L.lanes[1].x - L.img.x) / L.img.w - 0.75) < 1e-6);
    assert.equal(L.lanes[0].text, 'A');
  });

  test('关掉泳道名，图上方的名字带消失', () => {
    const L = WA.figure.layout({ cropW: 1000, cropH: 200, widthMm: 85, fontPt: 7, laneCenters: [0.5], laneNames: ['x'], showLaneNames: false });
    assert.equal(L.bands.names, 0);
  });

  test('角度越大，名字带越高（斜排要更多竖直空间）', () => {
    const a = WA.figure.layout({ cropW: 1000, cropH: 200, widthMm: 85, fontPt: 7, laneCenters: [0.5], laneNames: ['LongSampleName'], angle: 0 });
    const b = WA.figure.layout({ cropW: 1000, cropH: 200, widthMm: 85, fontPt: 7, laneCenters: [0.5], laneNames: ['LongSampleName'], angle: 60 });
    assert.ok(b.bands.names > a.bands.names, a.bands.names + ' vs ' + b.bands.names);
  });

  test('论文式版式：上级组名 → 组名 → 样品名 → 条件行 → 图片 → 抗体说明', () => {
    const centers = WA.lanes.evenCenters(3);
    const L = WA.figure.layout({
      cropW: 1000, cropH: 200, widthMm: 85, fontPt: 9, laneCenters: centers,
      laneNames: ['A', 'B', 'C'], angle: 0, groupCount: 1, condCount: 1,
      markerLabels: ['250', '100'], showUnit: true, unit: 'kDa', antibody: 'anti-X'
    });
    assert.ok(L.bands.group > 0, 'group band');
    const LT = WA.figure.layout({
      cropW: 1000, cropH: 200, widthMm: 85, fontPt: 9, laneCenters: centers,
      laneNames: ['A', 'B', 'C'], angle: 0, groupCount: 1, condCount: 1,
      markerLabels: [], showUnit: false, unit: 'kDa', antibody: '', title: 'DAXX-cko mESC'
    });
    assert.ok(LT.bands.title > 0, 'title band');
    assert.ok(LT.groupBaseline > LT.titleBaseline, '组名在上级组名之下');
    assert.ok(LT.img.y > L.img.y, '有上级组名时图片整体下移');
    assert.ok(L.namesBaseline < L.img.y, '样品名在图片上方');
    assert.ok(L.condBaseline < L.img.y, '条件行在图片上方');
    assert.ok(L.namesBaseline < L.condBaseline, '样品名在条件行之上（GelFigure 默认顺序）');
    // 关掉 laneNamesAbove 时两行互换位置
    const swapped = WA.figure.layout({
      cropW: 1000, cropH: 200, widthMm: 85, fontPt: 9, laneCenters: centers,
      laneNames: ['A', 'B', 'C'], angle: 0, groupCount: 1, condCount: 1, laneNamesAbove: false
    });
    assert.ok(swapped.condBaseline < swapped.namesBaseline, 'laneNamesAbove=false 时条件行回到上方');
    // v20 起刻度和图框之间留 axisGap（不再紧贴），且与数字的间隙相同
    assert.ok(L.axis.x < L.img.x, '刻度与图框留有空隙');
    assert.ok(Math.abs((L.img.x - L.axis.x) - L.axis.gap) < 1e-9, 'axis.x 与图框距离等于 axisGap');
    assert.ok(Math.abs((L.axis.x - L.axis.tickOut - L.axis.labelX) - L.axis.gap) < 1e-9, '刻度与数字间隙也等于 axisGap');
    assert.ok(L.axis.labelX < L.img.x, 'Marker 数值在框外左侧');
    assert.ok(L.axis.unitX < L.img.x, '单位也在框外');
    assert.ok(L.antibodyY > L.img.y + L.img.h, '抗体说明在图片下方');
    assert.ok(L.leftPad > 9, '左侧留出空间放数值');
  });
});

test('分组分层：重叠的组自动分层（大组在上、小组贴着图）', () => {
  const mk = (lanesList) => {
    const groups = lanesList.map((lanes, i) => ({ lanes: lanes, name: 'g' + i }));
    const L = WA.figure.layout({
      cropW: 1000, cropH: 200, widthMm: 85, fontPt: 9,
      laneCenters: [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95],
      laneNames: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      angle: 0, groups: groups, condCount: 0,
    });
    const map = {};
    L.groupItems.forEach((o) => { map[o.k] = o; });
    return { L: L, y: (i) => map[i].y };
  };

  // 嵌套：g0 ⊂ g1 ⊂ g2
  const A = mk([[0, 1], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5, 6, 7]]);
  assert.equal(A.L.groupLevelCount, 3, '三层');
  assert.ok(A.y(2) < A.y(1), '最大组在最上面');
  assert.ok(A.y(1) < A.y(0), '中组在小组之上');
  assert.ok(A.y(0) < A.L.img.y, '最下层也不压到图');

  // 部分重叠（1–3 与 2–4）→ 必须分层
  const P = mk([[0, 1, 2], [1, 2, 3]]);
  assert.equal(P.L.groupLevelCount, 2, '部分重叠分两层');

  // 完全相同的泳道 → 也分层
  const S2 = mk([[0, 1], [0, 1]]);
  assert.equal(S2.L.groupLevelCount, 2);

  // 互不相交 → 同一层
  const D = mk([[0, 1], [4, 5]]);
  assert.equal(D.L.groupLevelCount, 1);

  // 三层阶梯 + 右侧不相交组回到最下层
  const T = mk([[0, 1, 2, 3, 4, 5], [0, 1, 2, 3], [0, 1], [8, 9]]);
  assert.equal(T.L.groupLevelCount, 3);
  const bottom = Math.max.apply(null, T.L.groupItems.map((o) => o.y));
  assert.equal(T.y(3), bottom, '不相交的组回到贴着图的那一层');
});



describe('条件行排版（照 GelFigure）', () => {
  const base = {
    cropW: 1000, cropH: 400, widthMm: 85, fontPt: 9,
    laneCenters: [1 / 6, 3 / 6, 5 / 6], laneNames: ['a', 'b', 'c'], angle: 0
  };
  const rows = [{ name: '4OHT', pt: 9 }, { name: 'Dox', pt: 6 }];

  test('行距 = 各行自己字号的 1.3 倍，块高是行距之和', () => {
    const L = WA.figure.layout(Object.assign({}, base, { condRows: rows }));
    assert.equal(L.condRows.length, 2);
    assert.ok(Math.abs(L.bands.cond - (9 * 1.3 + 6 * 1.3)) < 1e-6, '块高 = 19.5');
    const d = L.condRows[1].y - L.condRows[0].y;
    assert.ok(Math.abs(d - 9 * 1.3) < 1e-6, '第一行到第二行的距离 = 9*1.3，' + d);
  });

  test('泳道名在上时，两行条件行都在名字之下、图片之上', () => {
    const L = WA.figure.layout(Object.assign({}, base, { condRows: rows }));
    assert.ok(L.namesBaseline < L.condRows[0].y, '名字在第一条条件行之上');
    assert.ok(L.condRows[1].y < L.img.y, '最后一条条件行在图片之上');
  });

  test('关掉「样品名在条件行上方」后条件行跑到名字上面', () => {
    const L = WA.figure.layout(Object.assign({}, base, { condRows: rows, laneNamesAbove: false }));
    assert.ok(L.condRows[1].y < L.namesBaseline, '条件行在名字之上');
    assert.ok(L.namesBaseline < L.img.y, '名字仍在图片之上');
  });

  test('药名与 Marker 数值共用同一条右对齐线，且不会顶出画布', () => {
    const L = WA.figure.layout(Object.assign({}, base, { condRows: rows, markerLabels: ['180', '100'], showUnit: true, unit: 'kDa' }));
    assert.ok(L.axis.labelX > 0, '右对齐线在画布内');
    assert.ok(L.axis.labelX >= WA.figure.textWidth('4OHT', 9), '最宽药名放得下');
  });
});

describe('泳道名留空 / 空行折叠', () => {
  const base = { cropW: 1000, cropH: 400, widthMm: 85, fontPt: 9, laneCenters: [1/6,3/6,5/6], angle: 0 };

  test('全部清空名字时不留名字行，图片上移', () => {
    const withNames = WA.figure.layout(Object.assign({}, base, { laneNames: ['a','b','c'] }));
    const noNames = WA.figure.layout(Object.assign({}, base, { laneNames: ['','',''] }));
    assert.ok(withNames.bands.names > 0);
    assert.equal(noNames.bands.names, 0);
    assert.ok(noNames.img.y < withNames.img.y, '图片上移 ' + withNames.img.y + ' → ' + noNames.img.y);
  });

  test('只清空一道不影响那一行的高度', () => {
    const L = WA.figure.layout(Object.assign({}, base, { laneNames: ['a','','c'] }));
    assert.ok(L.bands.names > 0, '还有名字就要留高度');
    assert.equal(L.lanes[1].text, '', '被清空的那道是空串，不是序号');
    assert.equal(L.lanes[0].text, 'a');
  });

  test('缺项（undefined）才回落到序号', () => {
    const L = WA.figure.layout(Object.assign({}, base, { laneNames: ['a'] }));
    assert.equal(L.lanes[1].text, '2');
  });
});

describe('每条泳道单独字号', () => {
  const base = { cropW: 1000, cropH: 400, widthMm: 85, fontPt: 9, laneCenters: [1/6,3/6,5/6], laneNames: ['a','b','c'], angle: 0 };

  test('laneStyle 只改指定那一道的字号，名字行高度取最大', () => {
    const L0 = WA.figure.layout(base);
    const L1 = WA.figure.layout(Object.assign({}, base, { laneStyle: { '1': { pt: 16, family: 'Georgia', color: '#b00020' } } }));
    assert.equal(L0.lanes[0].size, 9);
    assert.equal(L1.lanes[1].size, 16);
    assert.equal(L1.lanes[0].size, 9);
    assert.equal(L1.lanes[1].family, 'Georgia');
    assert.equal(L1.lanes[1].color, '#b00020');
    assert.ok(L1.bands.names > L0.bands.names, '大字要撑高名字行：' + L0.bands.names + ' → ' + L1.bands.names);
  });

  test('颜色写 auto 时不下发（用全局墨色）', () => {
    const L = WA.figure.layout(Object.assign({}, base, { laneStyle: { '0': { pt: 12, color: 'auto' } } }));
    assert.equal(L.lanes[0].size, 12);
    assert.equal(L.lanes[0].color, null);
  });
});
