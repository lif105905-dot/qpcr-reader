import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts([
  'core/util.js', 'core/doc.js', 'core/annotations.js',
  'core/lanes.js', 'core/figure.js', 'core/ladders.js', 'core/marker.js', 'core/render.js'
]);

function base() {
  const d = WA.doc.create('blot');
  WA.lanes.setCount(d, 4);
  return d;
}
const scene = (d) => WA.render.scene(d, { cropW: 1200, cropH: 220 });

describe('场景基础', () => {
  test('有图块和边框', () => {
    const sc = scene(base());
    assert.equal(sc.items.filter((i) => i.kind === 'image').length, 1);
    assert.equal(sc.items.filter((i) => i.kind === 'rect').length, 1);
  });

  test('关掉边框就没有 rect', () => {
    const d = base(); d.style.border = false;
    assert.equal(scene(d).items.filter((i) => i.kind === 'rect').length, 0);
  });

  test('泳道名在图片上方，且数量与条数一致', () => {
    const sc = scene(base());
    const img = sc.layout.img;
    const want = sc.layout.lanes.map((l) => l.text);
    const names = sc.items.filter((i) => i.kind === 'text' && want.indexOf(i.text) >= 0 && i.y < img.y);
    assert.equal(names.length, want.length);
    names.forEach((t) => assert.ok(t.y < img.y, '泳道名应在图上方'));
  });

  test('打开编号开关才画泳道编号圆点', () => {
    assert.equal(scene(base()).items.filter((i) => i.kind === 'circle').length, 0);
    const d = base();
    d.style.showNumbers = true;
    const sc = scene(d);
    const circles = sc.items.filter((i) => i.kind === 'circle');
    assert.equal(circles.length, sc.layout.lanes.length);
    circles.forEach((c) => assert.ok(c.y < sc.layout.img.y, '编号圆点应压在图顶边'));
  });

  test('高度不小于图块高度', () => {
    const sc = scene(base());
    assert.ok(sc.heightPt > sc.layout.img.h, sc.heightPt + ' vs ' + sc.layout.img.h);
  });
});

describe('标注进场景', () => {
  test('分组横线：文字 + 线，且把下方内容推下去', () => {
    const d = base();
    const before = scene(d).heightPt;
    WA.annotations.setGroup(d, [0, 1], 'Ctrl');
    const sc = scene(d);
    const line = sc.items.filter((i) => i.kind === 'line');
    assert.equal(line.length, 1);
    assert.ok(sc.items.some((i) => i.kind === 'text' && i.text === 'Ctrl'));
    assert.ok(sc.heightPt > before);
  });

  test('条件行：药名 + 三态（· / − / +）', () => {
    const d = base();
    WA.annotations.add(d, { kind: 'condition', drug: 'EGF', marks: [2, 1, 0, 2] });
    const sc = scene(d);
    assert.ok(sc.items.some((i) => i.kind === 'text' && i.text === 'EGF'));
    const marks = sc.items.filter((i) => i.kind === 'text' && ['+', '\u2212', '\u00b7'].indexOf(i.text) >= 0).map((i) => i.text);
    assert.deepEqual(marks, ['+', '\u2212', '\u00b7', '+']);
  });

  test('目标条带：刻度线 + 文字', () => {
    const d = base();
    WA.annotations.add(d, { kind: 'band', lane: 2, y: 0.4, text: 'p-ERK' });
    const sc = scene(d);
    assert.ok(sc.items.some((i) => i.kind === 'text' && i.text === 'p-ERK'));
    assert.equal(sc.items.filter((i) => i.kind === 'line').length, 1);
  });

  test('区域框与侧边括号画的都是矩形/线', () => {
    const d = base();
    WA.annotations.add(d, { kind: 'box', x: 0.1, y: 0.1, w: 0.3, h: 0.3, text: 'zoom' });
    const sc1 = scene(d);
    assert.equal(sc1.items.filter((i) => i.kind === 'rect').length, 2); // 边框 + 区域框

    const d2 = base();
    WA.annotations.add(d2, { kind: 'bracket', x: 0.05, y0: 0.2, y1: 0.7, text: 'tail' });
    const sc2 = scene(d2);
    assert.equal(sc2.items.filter((i) => i.kind === 'line').length, 3); // 竖线 + 两个横臂
    assert.ok(sc2.items.some((i) => i.kind === 'text' && i.text === 'tail'));
  });

  test('侧边文字按位置贴在四周（v9 版式）', () => {
    const d = base();
    WA.annotations.add(d, { kind: 'text', x: 0.1, y: 0.5, text: 'L', side: 'left', offsetPct: 50 });
    WA.annotations.add(d, { kind: 'text', x: 0.9, y: 0.5, text: 'R', side: 'right', offsetPct: 50 });
    WA.annotations.add(d, { kind: 'text', x: 0.5, y: 0.5, text: 'B', side: 'below', offsetPct: 50 });
    const sc = scene(d);
    const img = sc.layout.img;
    const L = sc.items.filter((i) => i.kind === 'text' && i.text === 'L')[0];
    const R = sc.items.filter((i) => i.kind === 'text' && i.text === 'R')[0];
    const B = sc.items.filter((i) => i.kind === 'text' && i.text === 'B')[0];
    assert.ok(L.x < img.x, '左侧文字在图框左边');
    assert.ok(R.x > img.x + img.w, '右侧文字在图框右边');
    assert.ok(B.y > img.y + img.h, '下方文字在图框下面');
    assert.equal(B.align, 'center');
  });
});

describe('SVG 导出', () => {
  test('含 svg 根、文字与转义', () => {
    const d = base();
    WA.annotations.add(d, { kind: 'text', x: 0.5, y: 0.5, text: 'a<b&c', side: 'left' });
    const sc = scene(d);
    const svg = WA.render.toSvg(d, sc, {});
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('a&lt;b&amp;c'));
    assert.ok(svg.trim().endsWith('</svg>'));
  });

  test('给了 imageHref 就嵌图', () => {
    const d = base();
    const sc = scene(d);
    assert.ok(WA.render.toSvg(d, sc, { imageHref: 'data:image/png;base64,AAA' }).includes('<image'));
    assert.ok(!WA.render.toSvg(d, sc, {}).includes('<image'));
  });

  test('字体族进 SVG', () => {
    const d = base(); d.style.fontFamily = 'Times New Roman';
    const svg = WA.render.toSvg(d, scene(d), {});
    assert.ok(svg.includes('Times New Roman'));
  });
});
