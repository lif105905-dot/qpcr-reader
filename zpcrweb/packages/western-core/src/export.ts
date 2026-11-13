/**
 * 导出编码 —— 移植自 `apps/western/src/core/export.js`。
 *
 * PNG/TIFF/PDF/SVG/PPTX 的纯字节构造：不碰 DOM，便于单测。字节布局与原实现逐字节一致，
 * 老文件、老测试都能对上。
 */
import type { SceneItem } from "./render.js";

// ---------- CRC32 / zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function utf8(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  const out: number[] = [];
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 最小 zip（store，无压缩）。 */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 0x21; // 1980-01-01
  entries.forEach((e) => {
    const name = utf8(e.name);
    const data = e.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + data.length;
  });
  let cenSize = 0;
  central.forEach((c) => {
    cenSize += c.length;
  });
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cenSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  chunks.forEach((c) => {
    out.set(c, p);
    p += c.length;
  });
  central.forEach((c) => {
    out.set(c, p);
    p += c.length;
  });
  out.set(end, p);
  return out;
}

// ---------- TIFF（8 位灰度，未压缩，单条带） ----------

export function tiffGray8(width: number, height: number, gray: Uint8Array, dpi?: number): Uint8Array {
  const n = width * height;
  const pixels = gray.length >= n ? gray.subarray(0, n) : new Uint8Array(n);
  const d = Math.max(1, Math.round(dpi || 72));
  const entries = 12;
  const ifdOff = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const ratOff = ifdOff + ifdSize; // 两个 RATIONAL 各 8 字节（分子/分母）
  const dataOff = ratOff + 16;
  const total = dataOff + n;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49;
  buf[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOff, true);

  let p = ifdOff;
  dv.setUint16(p, entries, true);
  p += 2;
  const tag = (id: number, type: number, count: number, value: number): void => {
    dv.setUint16(p, id, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    dv.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, 3, 1, width);
  tag(257, 3, 1, height);
  tag(258, 3, 1, 8); // BitsPerSample
  tag(259, 3, 1, 1); // Compression: none
  tag(262, 3, 1, 1); // Photometric: BlackIsZero
  tag(273, 4, 1, dataOff); // StripOffsets
  tag(277, 3, 1, 1); // SamplesPerPixel
  tag(278, 3, 1, height); // RowsPerStrip
  tag(279, 4, 1, n); // StripByteCounts
  tag(282, 5, 1, ratOff); // XResolution → RATIONAL 偏移
  tag(283, 5, 1, ratOff + 8); // YResolution（必须给，否则看图软件按 72 猜，比例会歪）
  tag(296, 3, 1, 2); // ResolutionUnit: inch
  dv.setUint32(p, 0, true); // 下一个 IFD = 0

  dv.setUint32(ratOff, d, true);
  dv.setUint32(ratOff + 4, 1, true); // X = dpi/1
  dv.setUint32(ratOff + 8, d, true);
  dv.setUint32(ratOff + 12, 1, true); // Y = dpi/1
  buf.set(pixels, dataOff);
  return buf;
}

// ---------- PNG：写入 pHYs（物理分辨率） ----------

/**
 * 给 PNG 加上 pHYs 块。
 *
 * 用途：粘贴到 PowerPoint / Word 时，图片会按这个 dpi 换算成物理尺寸。像素数不变
 * （还是导出时选的分辨率），只是「贴进去多大」。
 */
export function pngWithDpi(bytes: Uint8Array | ArrayBuffer, dpi: number): Uint8Array {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ppm = Math.round((dpi || 96) / 0.0254); // 每米像素数
  // 组装 pHYs：length(4) + type(4) + data(9) + crc(4)
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9, false);
  chunk[4] = 0x70;
  chunk[5] = 0x48;
  chunk[6] = 0x59;
  chunk[7] = 0x73; // 'pHYs'
  dv.setUint32(8, ppm, false);
  dv.setUint32(12, ppm, false);
  chunk[16] = 1; // unit = meter
  const crc = crc32(chunk.subarray(4, 17));
  dv.setUint32(17, crc >>> 0, false);

  // 找到 IHDR 结束位置（签名 8 + IHDR 块 25）
  const out: Uint8Array[] = [src.subarray(0, 33), chunk, src.subarray(33)];
  let len = 0;
  out.forEach((a) => {
    len += a.length;
  });
  const res = new Uint8Array(len);
  let o = 0;
  out.forEach((a) => {
    res.set(a, o);
    o += a.length;
  });
  return res;
}

// ---------- PDF（单页、嵌 JPEG） ----------

/**
 * 真矢量 PDF：文字/线/框用 PDF 指令，只有图块是内嵌 JPEG（DCTDecode）。
 *
 * 字体用 base-14 的 Helvetica（不嵌字也安全，期刊普遍接受标准字体）。
 */
export function pdfVector(
  items: SceneItem[],
  jpeg: Uint8Array | null,
  imgW: number,
  imgH: number,
  pageW: number,
  pageH: number,
): Uint8Array {
  const num = (v: number): string => (Math.round(v * 100) / 100).toString();
  const esc = (t: string): string =>
    String(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const Y = (y: number): number => pageH - y;
  const ops: string[] = [];
  const img = items.find((i) => i.kind === "image");
  if (img) {
    ops.push("q");
    ops.push(`${num(img.w)} 0 0 ${num(img.h)} ${num(img.x)} ${num(Y(img.y + img.h))} cm`);
    ops.push("/Im0 Do");
    ops.push("Q");
  }
  items.forEach((it) => {
    if (it.kind === "line") {
      ops.push(
        `q ${num(it.width || 0.5)} w ${num(it.x1)} ${num(Y(it.y1))} m ${num(it.x2)} ${num(Y(it.y2))} l S Q`,
      );
    } else if (it.kind === "rect") {
      if (it.fill && it.fill !== "none") {
        ops.push(`q ${num(it.x)} ${num(Y(it.y + it.h))} ${num(it.w)} ${num(it.h)} re f Q`);
      }
      if (it.width) {
        ops.push(
          `q ${num(it.width)} w 0 G ${num(it.x)} ${num(Y(it.y + it.h))} ${num(it.w)} ${num(it.h)} re S Q`,
        );
      }
    } else if (it.kind === "circle") {
      const k = 0.5523;
      const cx = it.x;
      const cy = Y(it.y);
      const r = it.r;
      ops.push(`q ${num(it.width || 0.5)} w 0 G ${num(cx + r)} ${num(cy)} m`);
      ops.push(
        `${num(cx + r)} ${num(cy + r * k)} ${num(cx + r * k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
      );
      ops.push(
        `${num(cx - r * k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + r * k)} ${num(cx - r)} ${num(cy)} c`,
      );
      ops.push(
        `${num(cx - r)} ${num(cy - r * k)} ${num(cx - r * k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
      );
      ops.push(
        `${num(cx + r * k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - r * k)} ${num(cx + r)} ${num(cy)} c S Q`,
      );
    } else if (it.kind === "text" && it.text) {
      const size = it.size || 9;
      const w = String(it.text).length * size * 0.55;
      let tx = it.x;
      if (it.align === "center") tx = it.x - w / 2;
      else if (it.align === "right") tx = it.x - w;
      const ang = ((it.rotate || 0) * Math.PI) / 180;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      ops.push(
        `BT /F1 ${num(size)} Tf ${num(c)} ${num(sn)} ${num(-sn)} ${num(c)} ${num(tx)} ${num(Y(it.y))} Tm (${esc(it.text)}) Tj ET`,
      );
    }
  });
  const content = ops.join("\n");

  const parts: Uint8Array[] = [];
  let len = 0;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    len += b.length;
  };
  const pushStr = (s: string): void => push(utf8(s));
  pushStr("%PDF-1.4\n");
  const offsets: Record<number, number> = {};
  const obj = (n: number, body: string, stream?: Uint8Array): void => {
    offsets[n] = len;
    pushStr(`${n} 0 obj\n${body}`);
    if (stream) {
      pushStr("stream\n");
      push(stream);
      pushStr("\nendstream");
    }
    pushStr("\nendobj\n");
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`,
  );
  if (jpeg) {
    obj(
      4,
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    );
  } else {
    obj(
      4,
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length 0 >>",
      new Uint8Array(0),
    );
  }
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(6, `<< /Length ${utf8(content).length} >>`, utf8(content));
  const xrefPos = len;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pushStr(xref);
  pushStr(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let p2 = 0;
  parts.forEach((b) => {
    out.set(b, p2);
    p2 += b.length;
  });
  return out;
}

export function pdfFromJpeg(jpeg: Uint8Array, widthPt: number, heightPt: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let len = 0;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    len += b.length;
  };
  const pushStr = (s: string): void => push(utf8(s));

  pushStr("%PDF-1.4\n");
  const offsets: Record<number, number> = {};
  const obj = (num: number, body: string, stream?: Uint8Array): void => {
    offsets[num] = len;
    pushStr(`${num} 0 obj\n${body}`);
    if (stream) {
      pushStr("stream\n");
      push(stream);
      pushStr("\nendstream");
    }
    pushStr("\nendobj\n");
  };

  const pageW = widthPt.toFixed(2);
  const pageH = heightPt.toFixed(2);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  obj(
    4,
    `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${utf8(content).length} >>`, utf8(content));

  const xrefPos = len;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pushStr(xref);
  pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let p = 0;
  parts.forEach((b) => {
    out.set(b, p);
    p += b.length;
  });
  return out;
}

// ---------- PPTX（最小可用：一页一张图） ----------

export function pptxFromPng(png: Uint8Array, widthPt: number, heightPt: number): Uint8Array {
  const EMU = 12700; // 1pt = 12700 EMU
  const cx = Math.round(widthPt * EMU);
  const cy = Math.round(heightPt * EMU);
  const files: ZipEntry[] = [];
  const add = (name: string, text: string): void => {
    files.push({ name, data: utf8(text) });
  };

  add(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      "</Types>",
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      "</Relationships>",
  );
  add(
    "ppt/presentation.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
      `<p:sldSz cx="${cx}" cy="${cy}" type="custom"/>` +
      '<p:notesSz cx="6096000" cy="4064000"/>' +
      "</p:presentation>",
  );
  add(
    "ppt/_rels/presentation.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
      "</Relationships>",
  );
  add(
    "ppt/slides/slide1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      "<p:cSld><p:spTree>" +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="figure"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      "</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>",
  );
  add(
    "ppt/slides/_rels/slide1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
      "</Relationships>",
  );
  files.push({ name: "ppt/media/image1.png", data: png });
  return zipStore(files);
}
