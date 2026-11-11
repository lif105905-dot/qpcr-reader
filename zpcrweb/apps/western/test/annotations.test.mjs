
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/doc.js', 'core/annotations.js']);
const A = WA.annotations;
const newDoc = () => WA.doc.create('blot');

describe('标注增删改', () => {
  test('六类都能加', () => {
    const d = newDoc();
    A.add(d, { kind: 'group', lanes: [0, 1], name: 'Ctrl' });
    A.add(d, { kind: 'band', lane: 2, y: 0.4, text: 'p-ERK' });
    A.add(d, { kind: 'condition', drug: 'EGF', marks: [true, false] });
    A.add(d, { kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'zoom' });
    A.add(d, { kind: 'bracket', x: 0.05, y0: 0.2, y1: 0.6, text: 'tail' });
    A.add(d, { kind: 'text', x: 0.5, y: 0.9, text: 'anti-pERK', side: 'right' });
    assert.equal(d.annotations.length, 6);
    assert.equal(A.byKind(d, 'text').length, 1);
  });

  test('未知类型会被拒绝', () => {
    assert.throws(() => A.add(newDoc(), { kind: 'arrow' }), /未知标注类型/);
  });

  test('每条都有唯一 id', () => {
    const d = newDoc();
    A.add(d, { kind: 'text', x: 0, y: 0, text: 'a' });
    A.add(d, { kind: 'text', x: 0, y: 0, text: 'b' });
    const ids = d.annotations.map((a) => a.id);
    assert.equal(new Set(ids).size, 2);
  });

  test('删除与更新', () => {
    const d = newDoc();
    const a = A.add(d, { kind: 'text', x: 0, y: 0, text: 'old' });
    const u = A.update(d, a.id, { text: 'new' });
    assert.equal(u.text, 'new');
    assert.equal(A.remove(d, a.id), true);
    assert.equal(A.remove(d, a.id), false);
    assert.equal(d.annotations.length, 0);
  });

  test('更新不存在的 id 返回 null', () => {
    assert.equal(A.update(newDoc(), 'nope', { text: 'x' }), null);
  });
});

describe('字段夹取', () => {
  test('坐标夹在 0..1', () => {
    const d = newDoc();
    const a = A.add(d, { kind: 'box', x: 1.4, y: -1, w: 5, h: 0.3 });
    assert.equal(a.x, 1);
    assert.equal(a.y, 0);
    assert.ok(a.w <= 1 - a.x + 1e-9);
  });

  test('括号上下自动纠正', () => {
    const d = newDoc();
    const a = A.add(d, { kind: 'bracket', x: 0.1, y0: 0.8, y1: 0.2, text: '' });
    assert.ok(a.y0 < a.y1);
  });

  test('分组泳道排序且组名可空', () => {
    const d = newDoc();
    const a = A.add(d, { kind: 'group', lanes: [3, 1, 2] });
    assert.deepEqual(a.lanes, [1, 2, 3]);
    assert.equal(a.name, '');
  });
});

describe('分组横线', () => {
  test('选同样泳道两次是更新不是重复添加', () => {
    const d = newDoc();
    A.setGroup(d, [0, 1], 'Ctrl');
    A.setGroup(d, [0, 1], 'Control');
    assert.equal(A.byKind(d, 'group').length, 1);
    assert.equal(A.byKind(d, 'group')[0].name, 'Control');
  });

  test('不同泳道组合各成一条', () => {
    const d = newDoc();
    A.setGroup(d, [0, 1], 'A');
    A.setGroup(d, [2, 3], 'B');
    assert.equal(A.byKind(d, 'group').length, 2);
  });
});

describe('序列化往返', () => {
  test('标注跟着文档存读', () => {
    const d = newDoc();
    A.add(d, { kind: 'text', x: 0.2, y: 0.3, text: 'hello', side: 'right' });
    const back = WA.doc.deserialize(WA.doc.serialize(d));
    assert.equal(back.annotations.length, 1);
    assert.equal(back.annotations[0].text, 'hello');
    assert.equal(back.annotations[0].side, 'right');
  });
});
