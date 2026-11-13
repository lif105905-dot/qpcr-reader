import { describe, expect, test } from "vitest";
import {
  crc32,
  pdfFromJpeg,
  pdfVector,
  pngWithDpi,
  pptxFromPng,
  tiffGray8,
  utf8,
  zipStore,
} from "../src/export.js";

const bytes = (s: string) => utf8(s);
const str = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("crc32 / zip", () => {
  test("CRC32 与已知值一致", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  test("zip 能被读回（本地头 + 中央目录）", () => {
    const zip = Buffer.from(
      zipStore([
        { name: "a.txt", data: bytes("hello") },
        { name: "b/c.xml", data: bytes("<x/>") },
      ]),
    );
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const n = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + n).toString()).toBe("a.txt");
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
  });
});

describe("TIFF", () => {
  test("头部与 IFD 正确，像素能读回", () => {
    const w = 4;
    const h = 3;
    const gray = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
    const t = Buffer.from(tiffGray8(w, h, gray, 600));
    expect(t[0]).toBe(0x49);
    expect(t[1]).toBe(0x49);
    expect(t.readUInt16LE(2)).toBe(42);
    const ifd = t.readUInt32LE(4);
    const count = t.readUInt16LE(ifd);
    expect(count).toBe(12);
    const tags: Record<number, number> = {};
    for (let i = 0; i < count; i += 1) {
      const p = ifd + 2 + i * 12;
      tags[t.readUInt16LE(p)] = t.readUInt32LE(p + 8);
    }
    expect(tags[256]).toBe(w);
    expect(tags[257]).toBe(h);
    expect(tags[259]).toBe(1);
    expect(tags[262]).toBe(1);
    const stripOff = tags[273]!;
    expect([...t.subarray(stripOff, stripOff + 12)]).toEqual([...gray]);
    expect(tags[279]).toBe(w * h);
    // 分辨率必须是 RATIONAL（偏移指向 8 字节的 分子/分母），否则看图软件按 72 猜、比例会歪
    const xr = tags[282]!;
    expect(xr).toBeGreaterThan(0);
    expect(xr + 8).toBeLessThanOrEqual(t.length);
    expect(t.readUInt32LE(xr)).toBe(600);
    expect(t.readUInt32LE(xr + 4)).toBe(1);
    expect(t.readUInt32LE(tags[283]!)).toBe(600);
    expect(tags[296]).toBe(2); // inch
    // 默认 72 dpi
    const t72 = Buffer.from(tiffGray8(w, h, gray));
    const ifd72 = t72.readUInt32LE(4);
    const tags72: Record<number, number> = {};
    const c72 = t72.readUInt16LE(ifd72);
    for (let i = 0; i < c72; i += 1) {
      const p = ifd72 + 2 + i * 12;
      tags72[t72.readUInt16LE(p)] = t72.readUInt32LE(p + 8);
    }
    expect(t72.readUInt32LE(tags72[282]!)).toBe(72);
  });
});

describe("PNG pHYs", () => {
  test("插在 IHDR 之后且 dpi 换算成 ppm", () => {
    const head = new Uint8Array(33);
    head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    head.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
    const tail = bytes("TAIL");
    const src = new Uint8Array([...head, ...tail]);
    const out = Buffer.from(pngWithDpi(src, 600));
    expect(out.length).toBe(head.length + 21 + tail.length);
    expect(out.subarray(head.length + 4, head.length + 8).toString()).toBe("pHYs");
    expect(out.readUInt32BE(head.length + 8)).toBe(Math.round(600 / 0.0254));
    expect(out.readUInt32BE(head.length + 12)).toBe(Math.round(600 / 0.0254));
    expect(out[head.length + 16]).toBe(1); // unit = meter
    expect(out.subarray(head.length + 21).toString()).toBe("TAIL");
  });
});

describe("PDF", () => {
  test('页数/尺寸/图像都用得上', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const s = str(pdfFromJpeg(jpeg, 240.94, 120.5));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/MediaBox [0 0 240.94 120.50]");
    expect(s).toContain("/Filter /DCTDecode");
    expect(s).toContain("startxref");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  test("矢量版把文字/线/框写成 PDF 指令", () => {
    const sc = [
      { kind: "image", x: 10, y: 10, w: 100, h: 50 },
      { kind: "line", x1: 0, y1: 0, x2: 10, y2: 10, width: 0.5 },
      { kind: "rect", x: 5, y: 5, w: 20, h: 20, width: 0.5, fill: "none" },
      { kind: "text", x: 12, y: 30, text: "anti-(X)", size: 9, align: "center" },
    ] as never;
    const s = str(pdfVector(sc, null, 1, 1, 300, 200));
    expect(s).toContain("/Im0 Do");
    expect(s).toContain(" re S Q");
    expect(s).toContain("0.5 w");
    expect(s).toContain("(anti-\\(X\\)) Tj");
    expect(s).toContain("BT /F1 9 Tf");
  });
});

describe("PPTX", () => {
  test("包含必需部件与图片", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const zip = Buffer.from(pptxFromPng(png, 200, 100));
    const names: string[] = [];
    let off = 0;
    while (zip.readUInt32LE(off) === 0x04034b50) {
      const n = zip.readUInt16LE(off + 26);
      const size = zip.readUInt32LE(off + 18);
      names.push(zip.subarray(off + 30, off + 30 + n).toString());
      off += 30 + n + size;
    }
    ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/media/image1.png"].forEach(
      (n) => {
        expect(names).toContain(n);
      },
    );
  });

  test("幻灯片尺寸按 pt 换算成 EMU", () => {
    const zip = Buffer.from(pptxFromPng(new Uint8Array([1]), 100, 50));
    const text = zip.toString("latin1");
    expect(text).toContain('cx="1270000"');
    expect(text).toContain('cy="635000"');
  });
});
