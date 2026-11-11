
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/marker.js']);
const M = WA.marker;
const SIZES = [180, 130, 100, 70, 55, 40, 35, 25, 15, 10];

describe('Marker 配分子量', () => {
  test('按 y 从上到下依次配', () => {
    const pts = [{ y: 0.1 }, { y: 0.3 }, { y: 0.6 }];
    const out = M.assignSizes(pts, SIZES);
    assert.deepEqual(out.map((p) => p.kDa), [180, 130, 100]);
    assert.deepEqual(out.map((p) => p.y), [0.1, 0.3, 0.6]);
  });

  test('乱序点会先排序', () => {
    const pts = [{ y: 0.6 }, { y: 0.1 }];
    assert.deepEqual(M.assignSizes(pts, SIZES).map((p) => p.kDa), [180, 130]);
  });

  test('点比 ladder 多时丢掉多余的', () => {
    const pts = [];
    for (let i = 0; i < 14; i++) pts.push({ y: i / 14 });
    assert.equal(M.assignSizes(pts, SIZES).length, SIZES.length);
  });

  test('保留泳道信息', () => {
    const out = M.assignSizes([{ y: 0.2, lane: 3 }], SIZES);
    assert.equal(out[0].lane, 3);
  });

  test('空输入不炸', () => {
    assert.deepEqual(M.assignSizes([], SIZES), []);
    assert.deepEqual(M.assignSizes(null, SIZES), []);
    assert.deepEqual(M.assignSizes([{ y: 0.1 }], []), []);
  });
});

describe('格式与插值', () => {
  test('分子量显示', () => {
    assert.equal(M.formatKDa(180), '180');
    assert.equal(M.formatKDa(4.6), '4.6');
    assert.equal(M.formatKDa(4.55), '4.6');
    assert.equal(M.formatKDa(NaN), '');
  });

  test('两点之间按对数插值', () => {
    const assigned = M.assignSizes([{ y: 0 }, { y: 1 }], [100, 10]);
    const f = M.interpolator(assigned);
    const mid = f(0.5);
    assert.ok(mid < 100 && mid > 10, String(mid));
    assert.ok(Math.abs(mid - Math.sqrt(1000)) < 1e-6, String(mid));
  });

  test('区间外取端点', () => {
    const f = M.interpolator(M.assignSizes([{ y: 0.2 }, { y: 0.8 }], [100, 10]));
    assert.equal(f(-1), 100);
    assert.equal(f(2), 10);
  });

  test('不足两点没有插值', () => {
    assert.equal(M.interpolator([]), null);
    assert.equal(M.interpolator([{ y: 0.1, kDa: 100 }]), null);
  });
});
