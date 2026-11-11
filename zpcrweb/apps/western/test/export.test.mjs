import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadScripts } from './helpers/load.mjs';

const WA = loadScripts(['core/util.js', 'core/export.js']);
const E = WA.exporter;

describe('crc32 / zip', () => {
  test('CRC32 与已知值一致', () => {
    assert.equal(E.crc32(Buffer.from('123456789')), 0xCBF43926);
  });

  test('zip 能被读回（本地头 + 中央目录）', () => {
    const zip = E.zipStore([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'b/c.xml', data: Buffer.from('<x/>') }
    ]);
    const buf = Buffer.from(zip);
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
    const n = buf.readUInt16LE(26);
    assert.equal(buf.slice(30, 30 + n).toString(), 'a.txt');
    // 文件末尾是 EOCD
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd > 0);
    assert.equal(buf.readUInt16LE(eocd + 10), 2); // 条目数
  });
});

describe('TIFF', () => {
  test('头部与 IFD 正确，像素能读回', () => {
    const w = 4, h = 3;
    const gray = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
    const t = Buffer.from(E.tiffGray8(w, h, gray, 600));
    assert.equal(t[0], 0x49); assert.equal(t[1], 0x49);
    assert.equal(t.readUInt16LE(2), 42);
    const ifd = t.readUInt32LE(4);
    const count = t.readUInt16LE(ifd);
    assert.equal(count, 12);   // 256,257,258,259,262,273,277,278,279,282,283,296
    const tags = {};
    for (let i = 0; i < count; i++) {
      const p = ifd + 2 + i * 12;
      tags[t.readUInt16LE(p)] = t.readUInt32LE(p + 8);
    }
    assert.equal(tags[256], w);
    assert.equal(tags[257], h);
    assert.equal(tags[259], 1);
    assert.equal(tags[262], 1);
    const off = tags[273];
    assert.deepEqual([...t.slice(off, off + 12)], [...gray]);
    assert.equal(tags[279], w * h);
    // 分辨率必须是 RATIONAL（偏移指向 8 字节的 分子/分母），否则看图软件按 72 猜、比例会歪
    const xr = tags[282];
    assert.ok(xr > 0 && xr + 8 <= t.length);
    assert.equal(t.readUInt32LE(xr), 600);
    assert.equal(t.readUInt32LE(xr + 4), 1);
    assert.equal(t.readUInt32LE(tags[283]), 600);
    assert.equal(tags[296], 2); // inch
    // 默认 72 dpi
    const t72 = Buffer.from(E.tiffGray8(w, h, gray));
    const ifd72 = t72.readUInt32LE(4);
    const tags72 = {};
    const c72 = t72.readUInt16LE(ifd72);
    for (let i = 0; i < c72; i++) { const p = ifd72 + 2 + i * 12; tags72[t72.readUInt16LE(p)] = t72.readUInt32LE(p + 8); }
    assert.equal(t72.readUInt32LE(tags72[282]), 72);
  });
});

describe('PDF', () => {
  test('页数/尺寸/图像都用得上', () => {
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
    const pdf = Buffer.from(E.pdfFromJpeg(jpeg, 240.94, 120.5));
    const s = pdf.toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.includes('/MediaBox [0 0 240.94 120.50]'));
    assert.ok(s.includes('/Filter /DCTDecode'));
    assert.ok(s.includes('startxref'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
  });
});

describe('PPTX', () => {
  test('包含必需部件与图片', () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    const zip = Buffer.from(E.pptxFromPng(png, 200, 100));
    const names = [];
    let off = 0;
    while (zip.readUInt32LE(off) === 0x04034b50) {
      const n = zip.readUInt16LE(off + 26);
      const size = zip.readUInt32LE(off + 18);
      names.push(zip.slice(off + 30, off + 30 + n).toString());
      off += 30 + n + size;
    }
    ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
      'ppt/slides/slide1.xml', 'ppt/media/image1.png'].forEach((n) => {
      assert.ok(names.includes(n), n + ' missing in ' + names.join(','));
    });
  });

  test('幻灯片尺寸按 pt 换算成 EMU', () => {
    const zip = Buffer.from(E.pptxFromPng(Buffer.from([1]), 100, 50));
    const text = zip.toString('latin1');
    assert.ok(text.includes('cx="1270000"'));
    assert.ok(text.includes('cy="635000"'));
  });
});
