
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/transform.js', 'core/image.js']);

describe('transform', () => {
  test('旋转 0° 尺寸不变', () => {
    assert.deepEqual(WA.transform.rotatedSize(1600, 1100, 0), { w: 1600, h: 1100 });
  });

  test('旋转 90° 宽高互换', () => {
    assert.deepEqual(WA.transform.rotatedSize(1600, 1100, 90), { w: 1100, h: 1600 });
  });

  test('旋转 45° 取外接框', () => {
    const s = WA.transform.rotatedSize(100, 100, 45);
    assert.equal(s.w, Math.ceil(100 * Math.SQRT2));
    assert.equal(s.h, Math.ceil(100 * Math.SQRT2));
  });

  test('裁切框被夹在 0..1 内', () => {
    const c = WA.transform.cropClamp({ x: -0.2, y: 0.5, w: 0.5, h: 0.9 }, 1600, 1100);
    assert.equal(c.x, 0);
    assert.ok(c.y + c.h <= 1 + 1e-9);
    assert.ok(c.w > 0 && c.w <= 1);
  });

  test('裁切框有最小尺寸', () => {
    const c = WA.transform.cropClamp({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 1600, 1100);
    assert.ok(c.w >= 8 / 1600 - 1e-9);
    assert.ok(c.h >= 8 / 1100 - 1e-9);
  });

  test('归一化 → 像素整数矩形', () => {
    const r = WA.transform.cropToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1600, 1100);
    assert.deepEqual(r, { x: 400, y: 550, w: 800, h: 275 });
  });

  test('像素矩形不越界', () => {
    const r = WA.transform.cropToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1600, 1100);
    assert.ok(r.x + r.w <= 1600);
    assert.ok(r.y + r.h <= 1100);
  });

  test('整张=没裁', () => {
    assert.equal(WA.transform.isFullCrop(null), true);
    assert.equal(WA.transform.isFullCrop({ x: 0, y: 0, w: 1, h: 1 }), true);
    assert.equal(WA.transform.isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 }), false);
  });
});

describe('image 等级与 LUT', () => {
  // 造一段 0..1 的斜坡
  const sig = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) sig[i] = i / 999;

  test('1%/99% 分位接近 0.01/0.99', () => {
    const lv = WA.image.levels(sig);
    assert.ok(Math.abs(lv.black - 0.01) < 0.02, 'black=' + lv.black);
    assert.ok(Math.abs(lv.white - 0.99) < 0.02, 'white=' + lv.white);
  });

  test('常数图不会除零', () => {
    const flat = new Float32Array(100).fill(0.3);
    const lv = WA.image.levels(flat);
    assert.ok(lv.white > lv.black);
  });

  test('亮度滑块把黑白场一起平移', () => {
    const base = { black: 0.1, white: 0.9 };
    const up = WA.image.applyAdjust(base, 60, 50);
    const down = WA.image.applyAdjust(base, 40, 50);
    assert.ok((up.black + up.white) / 2 > (base.black + base.white) / 2);
    assert.ok((down.black + down.white) / 2 < (base.black + base.white) / 2);
    assert.equal(Math.round((up.white - up.black) * 1000), Math.round((base.white - base.black) * 1000));
  });

  test('对比度滑块改变跨度', () => {
    const base = { black: 0.1, white: 0.9 };
    const wide = WA.image.applyAdjust(base, 50, 80);
    const narrow = WA.image.applyAdjust(base, 50, 20);
    assert.ok((wide.white - wide.black) < (base.white - base.black));
    assert.ok((narrow.white - narrow.black) > (base.white - base.black));
  });

  test('LUT 两端夹紧、反相翻转', () => {
    const lut = WA.image.lutFor(0.2, 0.8, false);
    assert.equal(lut[0], 0);
    assert.equal(lut[4096], 255);
    assert.equal(lut[Math.round(0.5 * 4096)], 127);
    const inv = WA.image.lutFor(0.2, 0.8, true);
    assert.equal(inv[0], 255);
    assert.equal(inv[4096], 0);
  });

  test('gradeValue 与 LUT 一致（允许 1 级量化误差）', () => {
    // LUT 是 4096 级量化表：索引 i 实际代表的输入是 i/4096，与任意 v 相比最多差 1/4096 个色阶，
    // 因此这里允许 ±1 的差，不是放松标准，而是量化本身的精度上限。
    const black = 0.15, white = 0.65;
    const lut = WA.image.lutFor(black, white, false);
    for (const v of [0, 0.15, 0.4, 0.65, 1]) {
      const expect = Math.round(WA.image.gradeValue(v, black, white, false) * 255);
      const got = lut[(v * 4096) | 0];
      assert.ok(Math.abs(got - expect) <= 1, 'v=' + v + ' got=' + got + ' expect=' + expect);
    }
  });
});
