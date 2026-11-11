
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, fakeStorage } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/theme.js', 'core/doc.js']);

describe('util', () => {
  test('clamp 夹住边界', () => {
    assert.equal(WA.util.clamp(5, 0, 1), 1);
    assert.equal(WA.util.clamp(-5, 0, 1), 0);
    assert.equal(WA.util.clamp(0.4, 0, 1), 0.4);
  });

  test('mm 与 pt 互转（85mm = 240.94pt）', () => {
    assert.equal(Math.round(WA.util.mmToPt(85) * 100) / 100, 240.94);
    assert.equal(Math.round(WA.util.ptToMm(72) * 100) / 100, 25.4);
  });

  test('escapeXml 转义特殊字符', () => {
    assert.equal(WA.util.escapeXml('a<b>&"c\''), 'a&lt;b&gt;&amp;&quot;c&apos;');
  });
});

describe('theme', () => {
  test('normalize 兜底为 system', () => {
    assert.equal(WA.theme.normalize('bogus'), 'system');
    assert.equal(WA.theme.normalize(undefined), 'system');
    assert.equal(WA.theme.normalize('dark'), 'dark');
  });

  test('resolve 支持 system 跟随', () => {
    assert.equal(WA.theme.resolve('light', true), 'light');
    assert.equal(WA.theme.resolve('dark', false), 'dark');
    assert.equal(WA.theme.resolve('system', true), 'dark');
    assert.equal(WA.theme.resolve('system', false), 'light');
  });

  test('存读偏好', () => {
    const st = fakeStorage();
    assert.equal(WA.theme.load(st), 'system');
    WA.theme.save(st, 'dark');
    assert.equal(st.getItem('wa-theme'), 'dark');
    assert.equal(WA.theme.load(st), 'dark');
  });
});

describe('doc 模型', () => {
  test('create 生成默认文档', () => {
    const d = WA.doc.create('blot');
    assert.equal(d.version, 1);
    assert.equal(d.mode, 'blot');
    assert.equal(d.image, null);
    assert.equal(d.crop, null);
    assert.equal(d.laneCount, 0);
    assert.deepEqual(d.laneCenters, []);
    assert.deepEqual(d.annotations, []);
    assert.equal(d.style.fontPt, 9);
    assert.equal(d.style.laneNameAngle, 0);
    assert.equal(d.style.sampleNamePos, 'above');
    assert.equal(d.style.showNumbers, false);
    assert.equal(d.style.antibody, '');
    assert.equal(d.style.border, true);
    assert.equal(d.style.lineWidthPt, 0.5);
    assert.equal(d.exportOptions.dpi, 600);
  });

  test('未知模式退回 blot', () => {
    assert.equal(WA.doc.create('xxx').mode, 'blot');
    assert.equal(WA.doc.create('gel').mode, 'gel');
  });

  test('默认泳道名是 1 2 3', () => {
    assert.deepEqual(WA.doc.defaultLaneNames(3), ['1', '2', '3']);
    assert.deepEqual(WA.doc.defaultLaneNames(0), []);
  });

  test('序列化后可原样读回', () => {
    const d = WA.doc.create('gel');
    d.laneCount = 2;
    d.laneCenters = [0.25, 0.75];
    d.laneNames = ['Ctrl', 'Treat'];
    const back = WA.doc.deserialize(WA.doc.serialize(d));
    assert.deepEqual(back, d);
  });

  test('缺字段的旧文档能补全后读回', () => {
    const legacy = JSON.stringify({ version: 1, mode: 'blot', view: {}, style: {} });
    const back = WA.doc.deserialize(legacy);
    assert.deepEqual(back.laneCenters, []);
    assert.deepEqual(back.annotations, []);
    assert.equal(back.style.fontFamily, 'Arial');
    assert.equal(back.view.zoom, 1);
    assert.equal(back.marker.points.length, 0);
  });

  test('非文档内容会被拒绝', () => {
    assert.throws(() => WA.doc.deserialize(JSON.stringify({ hello: 1 })), /不是有效的工作文档/);
    assert.throws(() => WA.doc.deserialize('not json'), SyntaxError);
  });
});
