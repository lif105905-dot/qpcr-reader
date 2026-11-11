
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/lanes.js', 'core/doc.js']);
const L = WA.lanes;

describe('泳道等距', () => {
  test('4 条泳道中点是 1/8 3/8 5/8 7/8', () => {
    assert.deepEqual(L.evenCenters(4), [0.125, 0.375, 0.625, 0.875]);
  });
  test('1 条居中、0 条为空', () => {
    assert.deepEqual(L.evenCenters(1), [0.5]);
    assert.deepEqual(L.evenCenters(0), []);
  });
  test('负数与小数被兜底', () => {
    assert.deepEqual(L.evenCenters(-3), []);
    assert.equal(L.evenCenters(2.9).length, 2);
  });

  test('setCount 建立中线与默认名', () => {
    const d = WA.doc.create('blot');
    L.setCount(d, 3);
    assert.equal(d.laneCount, 3);
    assert.equal(d.laneCenters.length, 3);
    assert.deepEqual(d.laneNames, ['1', '2', '3']);
  });

  test('缩条数时保留已有名字', () => {
    const d = WA.doc.create('blot');
    L.setCount(d, 3);
    d.laneNames = ['Ctrl', 'Treat', 'Veh'];
    L.setCount(d, 2);
    assert.deepEqual(d.laneNames, ['Ctrl', 'Treat']);
    L.setCount(d, 4);
    assert.deepEqual(d.laneNames, ['Ctrl', 'Treat', '3', '4']);
  });
});

describe('拖动中线', () => {
  test('普通拖动直接生效', () => {
    const c = L.evenCenters(3);
    const out = L.moveCenter(c, 1, 0.55);
    assert.ok(Math.abs(out[1] - 0.55) < 1e-9);
  });

  test('不能越过左邻居', () => {
    const c = L.evenCenters(3); // 0.1667 0.5 0.8333
    const out = L.moveCenter(c, 1, 0.0);
    assert.ok(out[1] > out[0], out.join(','));
    assert.ok(out[1] < out[2]);
  });

  test('不能越过右邻居', () => {
    const c = L.evenCenters(3);
    const out = L.moveCenter(c, 1, 1.0);
    assert.ok(out[1] < out[2]);
  });

  test('越界下标原样返回', () => {
    const c = L.evenCenters(2);
    assert.deepEqual(L.moveCenter(c, -1, 0.1), c);
    assert.deepEqual(L.moveCenter(c, 5, 0.1), c);
  });
});

describe('最近泳道', () => {
  test('落在某道上返回该道', () => {
    const c = L.evenCenters(4);
    assert.equal(L.nearestLane(c, 0.13), 0);
    assert.equal(L.nearestLane(c, 0.87), 3);
  });
  test('空数组返回 -1', () => {
    assert.equal(L.nearestLane([], 0.5), -1);
  });
});
