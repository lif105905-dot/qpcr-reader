/* 导出五格式：同一份 scene，按 dpi 栅格化。 */
(function (W) {
  'use strict';

  function rasterize(app, sc, px, rot, dpi, background) {
    const scale = dpi / 72;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sc.widthPt * scale));
    cv.height = Math.max(1, Math.round(sc.heightPt * scale));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = background || '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const st = app.doc.style;
    const font = (st.fontFamily || 'Arial') + ', sans-serif';
    ctx.imageSmoothingQuality = 'high';
    sc.items.forEach((it) => {
      if (it.kind === 'image') {
        ctx.drawImage(rot, px.x, px.y, px.w, px.h, it.x * scale, it.y * scale, it.w * scale, it.h * scale);
      }
    });
    W.figureview.paintVector(ctx, sc.items, scale, font);
    return cv;
  }

  function canvasToBytes(cv, type, quality) {
    return new Promise((resolve) => cv.toBlob((b) => b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))), type, quality));
  }

  function download(name, bytes, mime) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return name;
  }

  function grayFromCanvas(cv) {
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const out = new Uint8Array(cv.width * cv.height);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      out[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    }
    return out;
  }

  async function run(app, fmt, opts) {
    const collect = !!(opts && opts.collect);
    const out = (name, bytes, mime) => (collect ? { name, bytes, mime } : download(name, bytes, mime));
    if (!app.img) throw new Error('还没有图片');
    const { rot, px } = W.figureview.source();
    const sc = W.render.scene(app.doc, { cropW: px.w, cropH: px.h, axisInk: W.figureview.inkFor(rot, px) });
    const dpi = app.doc.exportOptions.dpi || 600;
    // 文件名：优先用右栏「文件名」输入框，其次项目标题，最后图片名
    const imgName = (app.doc.image && app.doc.image.name) || '';
    const raw = (app.exportBaseName && app.exportBaseName()) || app.doc.title || imgName.replace(/\.[^.]+$/, '') || 'figure';
    const base = String(raw).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'figure';

    if (fmt === 'svg') {
      const cv = rasterize(app, sc, px, rot, 300);
      const href = cv.toDataURL('image/png');
      const svg = W.render.toSvg(app.doc, sc, { imageHref: href });
      return out(base + '.svg', W.exporter.utf8(svg), 'image/svg+xml');
    }

    if (fmt === 'png') {
      const cv = rasterize(app, sc, px, rot, dpi);
      const raw = await canvasToBytes(cv, 'image/png');
      // PNG 主要拿去贴 PPT/Word：写 300 dpi 物理尺寸（≈图片像素/300 英寸，85mm 单栏约 17 cm 宽），
      // 免得贴进去只有 3.35 英寸那么小；像素数不变，仍是你选的分辨率。
      const bytes = W.exporter.pngWithDpi(raw, 300);
      return out(base + '_' + dpi + 'dpi.png', bytes, 'image/png');
    }

    if (fmt === 'tiff') {
      const cv = rasterize(app, sc, px, rot, dpi);
      const gray = grayFromCanvas(cv);
      const bytes = W.exporter.tiffGray8(cv.width, cv.height, gray, dpi);
      return out(base + '_' + dpi + 'dpi.tiff', bytes, 'image/tiff');
    }

    if (fmt === 'pdf') {
      // 真矢量：文字/线/框走 PDF 指令，只有图块是内嵌 JPEG
      const cropCv = rasterize(app, { items: sc.items.filter((i) => i.kind === 'image'), widthPt: sc.widthPt, heightPt: sc.heightPt, layout: sc.layout }, px, rot, dpi);
      const jpeg = await canvasToBytes(cropCv, 'image/jpeg', 0.98);
      const bytes = W.exporter.pdfVector(sc.items, jpeg, cropCv.width, cropCv.height, sc.widthPt, sc.heightPt);
      return out(base + '.pdf', bytes, 'application/pdf');
    }

    if (fmt === 'pack') {
      const entries = [];
      const tif = rasterize(app, sc, px, rot, dpi);
      const tifBytes = W.exporter.tiffGray8(tif.width, tif.height, grayFromCanvas(tif), dpi);
      entries.push({ name: base + '_' + dpi + 'dpi.tiff', data: tifBytes });
      const svgCv = rasterize(app, sc, px, rot, 300);
      const svg = W.render.toSvg(app.doc, sc, { imageHref: svgCv.toDataURL('image/png') });
      entries.push({ name: base + '.svg', data: W.exporter.utf8(svg) });
      const pjCv = rasterize(app, sc, px, rot, dpi);
      const pj = await canvasToBytes(pjCv, 'image/jpeg', 0.98);
      entries.push({ name: base + '.pdf', data: W.exporter.pdfVector(sc.items, pj, pjCv.width, pjCv.height, sc.widthPt, sc.heightPt) });
      if (app.rawFile) {
        const raw = new Uint8Array(await app.rawFile.arrayBuffer());
        entries.push({ name: 'original_' + (app.rawFile.name || 'source.tif'), data: raw });
      }
      const log = {
        app: 'LabKit',
        exportedAt: new Date().toISOString(),
        source: app.rawFile ? app.rawFile.name : null,
        mode: app.doc.mode,
        title: app.doc.title || '',
        crop: app.doc.crop,
        view: app.doc.view,
        laneCount: app.doc.laneCount,
        laneNames: app.doc.laneNames,
        marker: app.doc.marker,
        annotations: app.doc.annotations,
        style: app.doc.style,
        exportOptions: app.doc.exportOptions,
        widthPt: sc.widthPt,
        heightPt: sc.heightPt,
        issues: app.submissionIssues ? app.submissionIssues() : []
      };
      entries.push({ name: base + '.json', data: W.exporter.utf8(JSON.stringify(log, null, 2)) });
      entries.push({ name: 'README.txt', data: W.exporter.utf8(checklistText(app, sc)) });
      const zip = W.exporter.zipStore(entries);
      return out(base + '_submission.zip', zip, 'application/zip');
    }

    if (fmt === 'original') {
      // 未裁剪、未调色的原始图，投稿常要「原始全膜图」
      if (!app.rawFile) throw new Error('还没有打开原始图片');
      const bytes = new Uint8Array(await app.rawFile.arrayBuffer());
      const ext = (app.rawFile.name.split('.').pop() || 'tif').toLowerCase();
      return out('original_' + (app.rawFile.name || 'image.' + ext), bytes, 'application/octet-stream');
    }

    if (fmt === 'pptx') {
      const cv = rasterize(app, sc, px, rot, Math.min(dpi, 300));
      const png = await canvasToBytes(cv, 'image/png');
      const bytes = W.exporter.pptxFromPng(png, sc.widthPt, sc.heightPt);
      return out(base + '.pptx', bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    }

    throw new Error('未知导出格式：' + fmt);
  }

  function checklistText(app, sc) {
    const mm = (sc.widthPt / (72 / 25.4)).toFixed(1);
    const dpi = app.doc.exportOptions.dpi || 600;
    return [
      '投稿包内容 / Submission package',
      '',
      '1. ' + (app.doc.title || 'figure') + '_' + dpi + 'dpi.tiff —— 成图，600+ dpi、无损 8-bit 灰度，用于投稿系统上传',
      '2. ' + (app.doc.title || 'figure') + '.pdf —— 真矢量（文字/线/刻度为矢量，仅图块为位图）',
      '3. ' + (app.doc.title || 'figure') + '.svg —— 全矢量编辑用（AI / Inkscape 可直接改字）',
      '4. original_* —— 原始未裁剪图像，用于应对期刊「提供全膜图」的要求',
      '5. *.json —— 处理日志（裁切、对比度、标注、Marker 设置），可复核',
      '',
      '尺寸：' + mm + ' mm 宽；分辨率：' + dpi + ' dpi',
      '字体：Arial/Helvetica 系；线宽与字号见上表（均已通过投稿检查时才导出）',
      '',
      '投稿前请再对照目标期刊 Author Guidelines 核对：',
      '- 宽度（单栏 85–89 mm，1.5 栏 114 mm，双栏 174–183 mm）',
      '- 分辨率（照片 ≥300 dpi，多数要求 600）',
      '- 最小字号（≥5 pt）与最小线宽（≥0.25 pt）',
      '- Western blot 需附全膜图与 Marker，不得拼接不同膜/曝光'
    ].join('\n');
  }

  /** 批量导出选中面板：单张直接下载，多张打包 zip */
  async function runMany(app, fmt, panels) {
    const files = [];
    for (const it of panels) {
      const savedDoc = app.doc;
      const savedActive = app.activeTrayId;
      app.doc = W.doc.clone(it.doc);
      app.activeTrayId = it.id;
      try {
        const one = await run(app, fmt, { collect: true });
        const base = String(it.name || 'panel').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
        const rest = String(one.name).replace(/^[^_]*/, '');
        files.push({ name: base + rest, data: one.bytes });
      } finally {
        app.doc = savedDoc;
        app.activeTrayId = savedActive;
      }
    }
    if (!files.length) throw new Error('还没有选中的面板');
    if (files.length === 1) return download(files[0].name, files[0].data, 'application/octet-stream');
    const zip = W.exporter.zipStore(files.map(function (f) { return { name: f.name, data: f.data }; }));
    return download('figures_' + files.length + '.zip', zip, 'application/zip');
  }

  W.exporters = { rasterize, run, runMany, grayFromCanvas };
})(window.WA = window.WA || {});
