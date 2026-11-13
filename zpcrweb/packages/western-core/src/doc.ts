/**
 * 文档模型：一张膜 = 一份文档。所有字段都可 JSON 化，这里只做数据与纯变换，不碰 DOM。
 *
 * 移植自 `apps/western/src/core/doc.js`。`deserialize` 的老字段迁移（`laneEdges` → `laneCenters`、
 * 单 `marker` → `markers`）原样保留，升级后仍能打开旧文件。
 */
import type { Crop } from "./transform.js";

export const DOC_VERSION = 1;

/** 成图可选字体（系统自带；导出 SVG/PDF 时写进 `font-family`）。 */
export const FONTS: readonly string[] = [
  "Arial",
  "Helvetica",
  "Arial Narrow",
  "Times New Roman",
  "Georgia",
  "Calibri",
  "Cambria",
  "PingFang SC",
  "Heiti SC",
  "Songti SC",
];

export interface DocStyle {
  /** 默认字号（pt）—— 论文图常用 8–10。 */
  fontPt: number;
  fontFamily: string;
  border: boolean;
  lineWidthPt: number;
  /** 泳道名旋转角度（度）；0 = 水平。 */
  laneNameAngle: number;
  sampleNamePos: string;
  /** 是否画泳道编号圆圈。 */
  showNumbers: boolean;
  /** 图片右下角的抗体说明，如 `anti-SUMO2/3`。 */
  antibody: string;
  /** 组线两端加小竖脚。 */
  groupTicks: boolean;
  /** 组名放不下时：`wrap` 折行 / `shrink` 缩字 / `none` 溢出。 */
  groupFit: "wrap" | "shrink" | "none";
  minFontPt: number;
  laneNamePt: number | null;
  markerPt: number | null;
  laneNamesAbove: boolean;
  /** 面板字母（A/B/C），画在成图左上角。 */
  panelLetter: string;
}

export const DEFAULT_STYLE: Readonly<DocStyle> = Object.freeze({
  fontPt: 9,
  fontFamily: "Arial",
  border: true,
  lineWidthPt: 0.5,
  laneNameAngle: 0,
  sampleNamePos: "above",
  showNumbers: false,
  antibody: "",
  groupTicks: false,
  groupFit: "wrap",
  minFontPt: 5,
  laneNamePt: null,
  markerPt: null,
  laneNamesAbove: true,
  panelLetter: "",
});

/** 图像显示参数（明暗、旋转、翻转、伪彩）。 */
export interface DocView {
  rotate: number;
  autoAngle: number;
  lo: number;
  hi: number;
  gamma: number;
  invert: boolean;
  flipX: boolean;
  flipY: boolean;
  grid: boolean;
  markClip: boolean;
  panX: number;
  panY: number;
  zoom: number;
}

export function defaultView(): DocView {
  return {
    rotate: 0,
    autoAngle: 0,
    lo: 1,
    hi: 99,
    gamma: 1,
    invert: false,
    flipX: false,
    flipY: false,
    grid: false,
    markClip: false,
    panX: 0,
    panY: 0,
    zoom: 1,
  };
}

/** 文档里记录的源图元信息（图像本体另存项目文件）。 */
export interface DocImageMeta {
  name: string;
  width: number;
  height: number;
  bitsPerSample?: number;
  sha256?: string;
}

/** 一孔 ladder：用户点的条带 + 选中那条 ladder 的分子量。 */
export interface DocMarker {
  id: string | null;
  ladderId: string | null;
  lane: number | null;
  points: { x: number; y: number }[];
  sizes: number[];
}

/** 泳道分组横线。 */
export interface DocGroup {
  name: string;
  lanes: number[];
}

/** 条件行（药物 / 标记）。 */
export interface DocConditionRow {
  drug: string;
  marks: boolean[];
}

export interface DocExportOptions {
  dpi: number;
  widthMm: number;
}

export type DocMode = "blot" | "gel";

export interface WesternDoc {
  version: number;
  mode: DocMode;
  title: string;
  image: DocImageMeta | null;
  view: DocView;
  /** 归一化裁切框（相对旋转后的图）；`null` = 未裁。 */
  crop: Crop | null;
  laneCount: number;
  /** 首尾等距联动。 */
  laneLinked: boolean;
  /** 归一化中线位置（每道一根），长度 = `laneCount`。 */
  laneCenters: number[];
  /** 与 `laneCenters` 等长；`''` = 这一道不显示。 */
  laneNames: string[];
  /** 每道单独样式 `{ '0': { pt, family, color } }`，缺省跟随全局。 */
  laneStyle: Record<string, { pt?: number; family?: string; color?: string }>;
  groups: DocGroup[];
  conditionRows: DocConditionRow[];
  /** 一图可有多孔 ladder（`markers[0]` 即旧版 `marker`）。 */
  markers: DocMarker[];
  /** 六类标注，见 `annotations.ts`。 */
  annotations: unknown[];
  style: DocStyle;
  exportOptions: DocExportOptions;
  /** 兼容旧字段，始终镜像 `markers[0]`。 */
  marker?: DocMarker;
}

export function emptyMarker(): DocMarker {
  return { id: null, ladderId: null, lane: null, points: [], sizes: [] };
}

export function create(mode?: DocMode): WesternDoc {
  const doc: WesternDoc = {
    version: DOC_VERSION,
    mode: mode === "gel" ? "gel" : "blot",
    title: "",
    image: null,
    view: defaultView(),
    crop: null,
    laneCount: 0,
    laneLinked: false,
    laneCenters: [],
    laneNames: [],
    laneStyle: {},
    groups: [],
    conditionRows: [],
    markers: [emptyMarker()],
    annotations: [],
    style: { ...DEFAULT_STYLE },
    exportOptions: { dpi: 600, widthMm: 85 },
  };
  doc.marker = doc.markers[0]!;
  return doc;
}

export function clone(doc: WesternDoc): WesternDoc {
  return JSON.parse(JSON.stringify(doc)) as WesternDoc;
}

/** 泳道名默认值：`1 2 3 …`。 */
export function defaultLaneNames(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(String(i + 1));
  return out;
}

export function isDoc(v: unknown): v is WesternDoc {
  const d = v as WesternDoc | null;
  return (
    !!d &&
    typeof d === "object" &&
    d.version === DOC_VERSION &&
    (d.mode === "blot" || d.mode === "gel") &&
    !!d.view &&
    !!d.style
  );
}

export function serialize(doc: WesternDoc): string {
  return JSON.stringify(doc);
}

/** 反序列化并补齐老字段；不是本格式时抛错。 */
export function deserialize(text: string): WesternDoc {
  const v = JSON.parse(text) as WesternDoc & { laneEdges?: number[] };
  if (!isDoc(v)) throw new Error("不是有效的工作文档");
  // 旧字段 `laneEdges` 迁移成 `laneCenters`
  if (!Array.isArray(v.laneCenters)) v.laneCenters = Array.isArray(v.laneEdges) ? v.laneEdges : [];
  delete v.laneEdges;
  v.laneNames = Array.isArray(v.laneNames) ? v.laneNames : [];
  v.laneStyle = v.laneStyle && typeof v.laneStyle === "object" ? v.laneStyle : {};
  v.groups = Array.isArray(v.groups) ? v.groups : [];
  v.conditionRows = Array.isArray(v.conditionRows) ? v.conditionRows : [];
  v.annotations = Array.isArray(v.annotations) ? v.annotations : [];
  v.style = { ...DEFAULT_STYLE, ...(v.style || {}) };
  v.view = { ...defaultView(), ...(v.view || {}) };
  v.markers =
    Array.isArray(v.markers) && v.markers.length
      ? v.markers.map((m) => ({ ...emptyMarker(), ...m }))
      : [{ ...emptyMarker(), ...(v.marker || {}) }];
  v.marker = v.markers[0]!;
  const defaults: DocExportOptions = { dpi: 600, widthMm: 85 };
  v.exportOptions = { ...defaults, ...(v.exportOptions || {}) };
  return v;
}

/** 取全部 marker 孔（旧文档可能只有 `marker`）。 */
export function markersOf(doc: WesternDoc | null | undefined): DocMarker[] {
  if (!doc) return [];
  if (Array.isArray(doc.markers) && doc.markers.length) return doc.markers;
  return doc.marker ? [doc.marker] : [];
}
