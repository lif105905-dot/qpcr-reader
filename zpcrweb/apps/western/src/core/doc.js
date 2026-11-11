
/* 文档模型：一张膜 = 一份文档。所有字段都是可 JSON 化的普通对象。
 * 这里只做数据与纯变换，不碰 DOM。 */
(function (W) {
  'use strict';

  const VERSION = 1;

  // 成图可选的字体（系统自带；导出 SVG/PDF 时写成 font-family）
  const FONTS = ['Arial', 'Helvetica', 'Arial Narrow', 'Times New Roman', 'Georgia',
    'Calibri', 'Cambria', 'PingFang SC', 'Heiti SC', 'Songti SC'];

  const DEFAULT_STYLE = Object.freeze({
    fontPt: 9,               // 默认字号（pt）——论文图常用 8~10
    fontFamily: 'Arial',
    border: true,
    lineWidthPt: 0.5,
    laneNameAngle: 0,        // 泳道名旋转角度（度）；0 = 水平
    sampleNamePos: 'above',  // 泳道名一律放图片上方
    showNumbers: false,      // 是否画泳道编号圆圈
    antibody: '',            // 图片右下角的抗体说明，如 anti-SUMO2/3
    groupTicks: false,       // 组线两端加小竖脚（GelFigure 的 groupTicks）
    groupFit: 'wrap',        // 组名放不下时：wrap 折行 / shrink 缩字 / none 溢出
    minFontPt: 5,            // shrink 与自动缩字的下限
    laneNamePt: null,        // 泳道名字号；null = 跟随全局
    markerPt: null,          // Marker 刻度字号；null = 跟随全局
    laneNamesAbove: true,    // true = 样品名在条件行上方（GelFigure 默认）
    panelLetter: ''          // 面板字母（A/B/C），画在成图左上角
  });

  function defaultView() {
    return { rotate: 0, autoAngle: 0, lo: 1, hi: 99, gamma: 1, invert: false, flipX: false, flipY: false, grid: false, markClip: false, panX: 0, panY: 0, zoom: 1 };
  }

  function create(mode) {
    const doc = {
      version: VERSION,
      mode: mode === 'gel' ? 'gel' : 'blot',
      title: '',
      image: null,          // { name, width, height, bitsPerSample, sha256 }
      view: defaultView(),
      crop: null,           // 归一化 { x, y, w, h }，相对于旋转后的图；null = 未裁
      laneCount: 0,
      laneLinked: false,   // 首尾等距联动
      laneCenters: [],      // 归一化中线位置（每道一根），长度 = laneCount
      laneNames: [],        // 与 laneEdges 等长；'' = 这一道不显示
      laneStyle: {},        // 每道单独样式 { '0': { pt, family, color } }，缺省跟随全局
      groups: [],           // { name, lanes: [i...] } 选中几条泳道 → 自动加组名横线
      conditionRows: [],    // { drug, marks: [bool...] }
      markers: [emptyMarker()],  // 一图可有多孔 ladder（markers[0] 即旧版 marker）
      annotations: [],      // 六类标注，见 annotations.js
      style: Object.assign({}, DEFAULT_STYLE),
      exportOptions: { dpi: 600, widthMm: 85 }
    };
    doc.marker = doc.markers[0];   // 兼容旧字段
    return doc;
  }

  function clone(doc) { return JSON.parse(JSON.stringify(doc)); }

  function isDoc(v) {
    return !!v && typeof v === 'object' && v.version === VERSION
      && (v.mode === 'blot' || v.mode === 'gel') && !!v.view && !!v.style;
  }

  function serialize(doc) { return JSON.stringify(doc); }

  function deserialize(text) {
    const v = JSON.parse(text);
    if (!isDoc(v)) throw new Error('不是有效的工作文档');
    // 老字段补默认值，避免升级后打不开
    // 旧字段 laneEdges 迁移成 laneCenters
    if (!Array.isArray(v.laneCenters)) v.laneCenters = Array.isArray(v.laneEdges) ? v.laneEdges : [];
    delete v.laneEdges;
    v.laneNames = Array.isArray(v.laneNames) ? v.laneNames : [];
    v.laneStyle = (v.laneStyle && typeof v.laneStyle === 'object') ? v.laneStyle : {};
    v.groups = Array.isArray(v.groups) ? v.groups : [];
    v.conditionRows = Array.isArray(v.conditionRows) ? v.conditionRows : [];
    v.annotations = Array.isArray(v.annotations) ? v.annotations : [];
    v.style = Object.assign({}, DEFAULT_STYLE, v.style || {});
    v.view = Object.assign(defaultView(), v.view || {});
    v.markers = Array.isArray(v.markers) && v.markers.length
      ? v.markers.map(function (m) { return Object.assign(emptyMarker(), m); })
      : [Object.assign(emptyMarker(), v.marker || {})];
    // 兼容旧字段：始终把第一孔镜像成 marker
    v.marker = v.markers[0];
    v.exportOptions = Object.assign({ dpi: 600, widthMm: 85 }, v.exportOptions || {});
    return v;
  }

  function emptyMarker() {
    return { id: null, ladderId: null, lane: null, points: [], sizes: [] };
  }

  /** 取全部 marker 孔（旧文档可能只有 v.marker） */
  function markersOf(doc) {
    if (!doc) return [];
    if (Array.isArray(doc.markers) && doc.markers.length) return doc.markers;
    return doc.marker ? [doc.marker] : [];
  }

  /** 泳道名默认值：1 2 3 ... */
  function defaultLaneNames(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(String(i + 1));
    return out;
  }

  W.doc = {
    VERSION, DEFAULT_STYLE, FONTS, defaultView, defaultLaneNames, emptyMarker, markersOf,
    create, clone, isDoc, serialize, deserialize
  };
})(window.WA = window.WA || {});
