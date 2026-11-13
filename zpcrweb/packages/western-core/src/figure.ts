/**
 * 成图布局（纯计算）—— 移植自 `apps/western/src/core/figure.js`。
 *
 * 版式自上而下：上级组名（可选）→ 组名（带下划线）→ 条件行（−/+）→ 样品名（泳道名）
 * → 图片（左侧框外 Marker 刻度与数值）→ 抗体说明（右下）。坐标单位 pt。
 */
import { mmToPt } from "./util.js";

export interface GroupInput {
  lanes: number[];
  name: string;
  pt?: number | null;
}

export interface CondRowInput {
  name: string;
  pt?: number | null;
}

export interface LaneStyleInput {
  pt?: number | null;
  family?: string | null;
  color?: string | null;
}

export interface LayoutInput {
  cropW: number;
  cropH: number;
  widthMm?: number;
  fontPt?: number;
  laneCenters?: number[];
  laneNames?: string[];
  angle?: number;
  showLaneNames?: boolean;
  groups?: GroupInput[];
  /** 只给条数、不给具体分组时的空层（老调用方）。 */
  groupCount?: number;
  condRows?: CondRowInput[];
  condCount?: number;
  condNames?: string[];
  markerLabels?: (string | number)[];
  showUnit?: boolean;
  unit?: string;
  markerPt?: number | null;
  laneNamePt?: number | null;
  laneStyle?: Record<string, LaneStyleInput>;
  title?: string;
  /** 面板字母（A/B/C）—— 只由调用方画，版式不支持时布局忽略。 */
  panelLetter?: string;
  antibody?: string;
  textBelow?: number;
  laneNamesAbove?: boolean;
  groupFit?: "wrap" | "shrink" | "none";
  minFontPt?: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutLane {
  x: number;
  text: string;
  size: number;
  family: string | null;
  color: string | null;
}

export interface LayoutGroupItem {
  k: number;
  x0: number;
  x1: number;
  cx: number;
  size: number;
  lines: string[];
  tw: number;
  tier: number;
  y: number;
}

export interface LayoutAxis {
  gap: number;
  x: number;
  tickOut: number;
  labelX: number;
  unitX: number;
  unitY: number;
}

export interface Layout {
  widthPt: number;
  heightPt: number;
  img: LayoutRect;
  lanes: LayoutLane[];
  pitch: number;
  pad: number;
  leftPad: number;
  bands: { title: number; group: number; cond: number; names: number };
  numberRow: { y: number; r: number };
  titleBaseline: number;
  groupBaseline: number;
  groupBaselines: number[];
  groupLevelCount: number;
  groupItems: LayoutGroupItem[];
  nameSize: number;
  markerSize: number;
  namesAbove: boolean;
  namesBaseline: number;
  antibodyY: number;
  condRows: { y: number; pt: number; name: string }[];
  condBaseline: number;
  axis: LayoutAxis;
}

/** 一个标签占的高度（考虑旋转角）。 */
export function labelHeight(fontPt: number, angleDeg = 0, text?: string): number {
  const rad = Math.abs(((angleDeg || 0) * Math.PI) / 180);
  const w = Math.max(1, String(text || "W").length) * fontPt * 0.6;
  return Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * fontPt * 1.25;
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

/** 估算字宽：中文按 1.0 em，西文/数字/空格按 0.55 em。 */
export function textWidth(text: string, fontPt: number): number {
  let n = 0;
  for (const ch of String(text || "")) n += CJK.test(ch) ? 1.0 : 0.55;
  return Math.max(1, n) * fontPt;
}

interface TierItem {
  x0: number;
  x1: number;
  ext0: number;
  ext1: number;
  /** 由 {@link groupTiers} 填写：层号，0 是贴近胶图那层。 */
  tier?: number;
}

/**
 * 组的分层：比较的是「线的外延」而不是泳道区间，窄组贴近胶图、宽组被顶到上面，
 * 于是嵌套自然成阶梯。
 */
export function groupTiers<T extends TierItem>(items: T[], pad: number): T[][] {
  const tiers: T[][] = [];
  items
    .slice()
    .sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0))
    .forEach((o) => {
      let t = 0;
      while ((tiers[t] ?? []).some((q) => !(o.ext1 + pad < q.ext0 || o.ext0 - pad > q.ext1))) t += 1;
      (tiers[t] = tiers[t] ?? []).push(o);
      o.tier = t;
    });
  return tiers;
}

/** 按宽度折行（贪心；中文逐字，西文按词）。 */
export function wrapText(text: string, pt: number, maxW: number): string[] {
  const out: string[] = [];
  String(text)
    .split("\n")
    .forEach((par) => {
      const toks =
        par.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g) ?? [];
      let cur = "";
      const push = () => {
        if (cur !== "") {
          out.push(cur.replace(/\s+$/, ""));
          cur = "";
        }
      };
      toks.forEach((t) => {
        if (/^\s+$/.test(t)) {
          if (cur) cur += " ";
          return;
        }
        if (textWidth(cur + t, pt) <= maxW) {
          cur += t;
          return;
        }
        push();
        if (textWidth(t, pt) <= maxW) {
          cur = t;
          return;
        }
        let piece = "";
        for (const ch of t) {
          if (textWidth(piece + ch, pt) > maxW && piece) {
            out.push(piece);
            piece = "";
          }
          piece += ch;
        }
        cur = piece;
      });
      push();
    });
  return out.filter((l, i, a) => String(l).trim() !== "" || a.length === 1);
}

/** 内部用的组条目：几何 + 折行结果，`tier` 由 {@link groupTiers} 补上。 */
interface GroupItemInternal extends TierItem {
  g: GroupInput;
  i: number;
  cx: number;
  size: number;
  lines: string[];
  tw: number;
  h: number;
}

/** 计算整张图的版式。 */
export function layout(o: LayoutInput): Layout {
  const fp = o.fontPt || 9;
  const widthPt = mmToPt(o.widthMm || 85);
  const centers = o.laneCenters ?? [];
  const names = o.laneNames ?? [];
  const angle = o.angle || 0;
  const show = o.showLaneNames !== false && centers.length > 0;

  const fpName = o.laneNamePt || fp;
  const laneStyle = o.laneStyle ?? {};
  const nameSizes = centers.map((_, i) => {
    const st = laneStyle[String(i)] ?? laneStyle[i as unknown as string];
    return st?.pt || fpName;
  });
  const maxLabelH = show
    ? Math.max(
        ...centers
          .map((_, i) => labelHeight(nameSizes[i]!, angle, names[i] || String(i + 1)))
          .concat([fpName]),
      )
    : 0;

  const markerLabels = (o.markerLabels ?? []).map(String);
  const fpMark = o.markerPt || fp * 0.85;
  const widest = markerLabels.length
    ? Math.max(...markerLabels.map((t) => textWidth(t, fpMark)))
    : 0;
  const unitW = o.showUnit ? textWidth(`(${o.unit || "kDa"})`, fp * 0.8) : 0;

  const condRows: CondRowInput[] = o.condRows?.length
    ? o.condRows.map((r) => ({ name: String(r.name || ""), pt: r.pt || fp }))
    : (o.condCount || 0) > 0
      ? Array.from({ length: o.condCount || 0 }, (_, i) => ({
          name: String((o.condNames ?? [])[i] || ""),
          pt: fp,
        }))
      : [];
  const condW = condRows.length
    ? Math.max(...condRows.map((r) => textWidth(r.name, r.pt || fp)))
    : 0;
  const sideGap = fp * 0.42 * 2 + fp * 0.6;
  const leftPad = Math.max(fp * 0.8, Math.max(widest, unitW, condW) + sideGap + fp * 0.9);

  const titleBand = o.title ? fp * 1.6 : 0;

  const groupsIn = (o.groups ?? []).filter((g) => g && g.lanes && g.lanes.length);
  const imgW0 = widthPt - leftPad - fp * 0.4;
  const laneX0 = centers.map((c) => leftPad + c * imgW0);
  const pitch0 = laneX0.length > 1 ? laneX0[1]! - laneX0[0]! : imgW0;
  const half = Math.min(pitch0, imgW0) * 0.42;

  const gItems: GroupItemInternal[] = groupsIn.map((g, i) => {
    const a = Math.min(...g.lanes);
    const b = Math.max(...g.lanes);
    const x0 = laneX0[a]! - half;
    const x1 = laneX0[b]! + half;
    const cx = (x0 + x1) / 2;
    const size = g.pt || fp;
    const text = String(g.name == null ? "" : g.name);
    let lines = text ? text.split("\n") : [];
    const room = Math.max(x1 - x0, size * 2);
    const widestOf = (pt: number) =>
      lines.length ? Math.max(...lines.map((t) => textWidth(t, pt))) : 0;
    let size2 = size;
    if (text && o.groupFit !== "none" && widestOf(size) > room) {
      if (o.groupFit === "shrink") {
        const floor = Math.max(3, Math.min(size, o.minFontPt || 5));
        let pt = size;
        while (pt > floor && widestOf(pt) > room) pt -= 0.5;
        size2 = pt;
      } else {
        lines = wrapText(text, size, room);
      }
    }
    const tw = widestOf(size2);
    const lineH0 = size * 1.15;
    const h = lines.length ? size * 0.3 + (lines.length - 1) * lineH0 + size : fp;
    return {
      g,
      i,
      x0,
      x1,
      cx,
      size: size2,
      lines,
      tw,
      h,
      ext0: Math.min(x0, cx - tw / 2),
      ext1: Math.max(x1, cx + tw / 2),
    };
  });
  const tiers = groupTiers(gItems, fp * 0.25);
  const tierH = tiers.map((ts) => Math.max(fp * 1.7, Math.max(...ts.map((o2) => o2.h + fp * 0.4))));
  let groupBand = tierH.reduce((a, b) => a + b, 0);
  if (!groupBand && (o.groupCount || 0) > 0) groupBand = fp * 1.7;

  const condPitch = condRows.map((r) => (r.pt || fp) * 1.3);
  const condBand = condPitch.reduce((a, b) => a + b, 0);
  const gapNames = Math.max(2.2, fp * 0.28);
  const gapNamesCond = condRows.length ? fp * 1.15 : 0;
  const anyName = names.some((t) => String(t == null ? "" : t).trim() !== "");
  const namesBand = show && anyName ? maxLabelH + gapNames : 0;
  const bottomBand = Math.max(
    o.antibody ? fp * 1.9 : fp * 0.5,
    (o.textBelow || 0) > 0 ? (o.antibody ? fp * 4.2 : fp * 2.6) : 0,
  );

  const imgW = widthPt - leftPad - fp * 0.4;
  const imgH = imgW * (o.cropH / o.cropW);
  const imgX = leftPad;
  const namesAbove = o.laneNamesAbove !== false;

  const stackTop = fp * 0.6 + titleBand + groupBand;
  const condBaselines: number[] = [];
  let namesBaseline = 0;
  let cursor = stackTop;
  const placeConds = () => {
    let acc = 0;
    condRows.forEach((_r, i) => {
      condBaselines[i] = cursor + acc;
      acc += condPitch[i]!;
    });
    cursor += acc;
  };
  if (namesAbove) {
    namesBaseline = cursor + maxLabelH;
    cursor += namesBand + gapNamesCond;
    placeConds();
  } else {
    placeConds();
    cursor += gapNamesCond;
    namesBaseline = cursor + maxLabelH;
    cursor += namesBand;
  }
  const imgY = cursor;
  const img: LayoutRect = { x: imgX, y: imgY, w: imgW, h: imgH };

  const lanes: LayoutLane[] = centers.map((c, i) => {
    const raw = names[i];
    const st = laneStyle[String(i)] ?? laneStyle[i as unknown as string] ?? {};
    return {
      x: img.x + c * img.w,
      text: raw === undefined || raw === null ? String(i + 1) : String(raw),
      size: nameSizes[i]!,
      family: st.family ?? null,
      color: st.color && st.color !== "auto" ? st.color : null,
    };
  });
  const numR = fp * 0.62;
  const pitch = lanes.length > 1 ? lanes[1]!.x - lanes[0]!.x : img.w;

  const axisGap = fp * 0.42;
  const axis: LayoutAxis = {
    gap: axisGap,
    x: img.x - axisGap,
    tickOut: fp * 0.6,
    labelX: img.x - axisGap * 2 - fp * 0.6,
    unitX: img.x - axisGap * 2 - fp * 0.6,
    unitY: img.y + fp * 0.95,
  };

  const groupBaselines: number[] = (() => {
    const out: number[] = [];
    const bottom = fp * 0.6 + titleBand + groupBand - fp * 0.15;
    let acc = 0;
    for (let i = 0; i < tierH.length; i += 1) {
      out.push(bottom - acc);
      acc += tierH[i]!;
    }
    return out.reverse();
  })();

  const groupItems: LayoutGroupItem[] = (() => {
    const top = fp * 0.6 + titleBand;
    const areaBottom = top + groupBand - fp * 0.15;
    const bottoms: number[] = [];
    let acc = 0;
    for (let t = 0; t < tierH.length; t += 1) {
      bottoms.push(areaBottom - acc);
      acc += tierH[t]!;
    }
    return gItems.map((o2) => ({
      k: o2.i,
      x0: o2.x0,
      x1: o2.x1,
      cx: o2.cx,
      size: o2.size,
      lines: o2.lines,
      tw: o2.tw,
      tier: o2.tier ?? 0,
      y: bottoms[o2.tier ?? 0]!,
    }));
  })();

  return {
    widthPt,
    heightPt: img.y + img.h + bottomBand,
    img,
    lanes,
    pitch,
    pad: fp * 0.6,
    leftPad,
    bands: { title: titleBand, group: groupBand, cond: condBand, names: namesBand },
    numberRow: { y: img.y - numR * 0.95, r: numR },
    titleBaseline: fp * 0.6 + fp * 1.15,
    groupBaseline: fp * 0.6 + titleBand + fp * 1.1,
    groupBaselines,
    groupLevelCount: tierH.length,
    groupItems,
    nameSize: fpName,
    markerSize: fpMark,
    namesAbove,
    namesBaseline,
    antibodyY: img.y + img.h + fp * 1.25,
    condRows: condRows.map((r, i) => ({ y: condBaselines[i]!, pt: r.pt || fp, name: r.name })),
    condBaseline: condBaselines.length ? condBaselines[0]! : stackTop + fp * 0.95,
    axis,
  };
}
