
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/canvasmath.js']);
const M = WA.canvasmath;

describe('canvasmath.fit', () => {
  test('横向图按宽度贴合，居中', () => {
    const f = M.fit(1600, 1100, 1000, 800, 24);
    assert.ok(Math.abs(f.scale - (1000 - 48) / 1600) < 1e-9 || Math.abs(f.scale - (800 - 48) / 1100) < 1e-9);
    const w = 1600 * f.scale, h = 1100 * f.scale;
    assert.ok(Math.abs(f.dx + w / 2 - 500) < 1e-6);
    assert.ok(Math.abs(f.dy + h / 2 - 400) < 1e-6);
  });

  test('极端视图不出现 NaN/Infinity', () => {
    const f = M.fit(100, 100, 10, 10, 24);
    assert.ok(Number.isFinite(f.scale) && f.scale > 0);
  });
});

describe('坐标往返', () => {
  test('toImage 是 toScreen 的逆运算', () => {
    const t = M.transform(M.fit(1600, 1100, 1000, 800), 1.7, 30, -20);
    const p = { x: 640, y: 420 };
    const back = M.toImage(M.toScreen(p, t), t);
    assert.ok(Math.abs(back.x - p.x) < 1e-6 && Math.abs(back.y - p.y) < 1e-6);
  });
});

describe('命中测试', () => {
  const rect = { x: 100, y: 100, w: 400, h: 200 };

  test('角点命中', () => {
    assert.equal(M.hitTest(rect, { x: 100, y: 100 }, 8), 'nw');
    assert.equal(M.hitTest(rect, { x: 500, y: 300 }, 8), 'se');
  });

  test('边中点命中', () => {
    assert.equal(M.hitTest(rect, { x: 300, y: 100 }, 8), 'n');
    assert.equal(M.hitTest(rect, { x: 500, y: 200 }, 8), 'e');
  });

  test('内部是 move，外部是 null', () => {
    assert.equal(M.hitTest(rect, { x: 300, y: 200 }, 8), 'move');
    assert.equal(M.hitTest(rect, { x: 50, y: 50 }, 8), null);
  });

  test('旋转把手优先于其它命中', () => {
    const rot = { x: 300, y: 80 };
    assert.equal(M.hitTest(rect, { x: 301, y: 81 }, 8, rot), 'rotate');
  });
});

describe('拖拽改写矩形', () => {
  const rect = { x: 100, y: 100, w: 400, h: 200 };

  test('拖右下角变大', () => {
    const r = M.resizeRect(rect, 'se', { x: 560, y: 340 }, 8);
    assert.deepEqual(r, { x: 100, y: 100, w: 460, h: 240 });
  });

  test('拖左上角移动左边界', () => {
    const r = M.resizeRect(rect, 'nw', { x: 60, y: 70 }, 8);
    assert.deepEqual(r, { x: 60, y: 70, w: 440, h: 230 });
  });

  test('最小边被守住', () => {
    const r = M.resizeRect(rect, 'se', { x: 0, y: 0 }, 8);
    assert.equal(r.w, 8);
    assert.equal(r.h, 8);
  });

  test('反向拖不会产生负宽高', () => {
    const r = M.resizeRect(rect, 'nw', { x: 999, y: 999 }, 8);
    assert.ok(r.w >= 8 && r.h >= 8);
  });
});

describe('toNorm', () => {
  test('像素矩形转成 0..1', () => {
    const n = M.toNorm({ x: 160, y: 110, w: 800, h: 550 }, 1600, 1100);
    assert.deepEqual(n, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  test('超出范围会被夹住', () => {
    const n = M.toNorm({ x: -50, y: -50, w: 2000, h: 2000 }, 1600, 1100);
    assert.equal(n.x, 0);
    assert.equal(n.w, 1);
  });
});
