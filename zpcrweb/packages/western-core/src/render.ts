/**
 * 场景构建 —— 移植自 `apps/western/src/core/render.js`。
 *
 * 把文档 + 版式 + 六类标注变成一串绘图指令（单位 pt，原点左上）。canvas 预览与 SVG
 * 导出共用这一份，保证所见即所得。
 *
 * 绘制顺序与 GelFigure 的版式一致：
 *   组名 + 分组线 → 泳道名（可旋转）→ 泳道编号 / Marker 徽标 → 图片 → Marker 轴（图内左侧）
 *   → 边框 → 目标条带/区域框/侧边括号/侧边文字 → 条件行
 */
import { byKind } from "./annotations.js";
import type { DocMarker, WesternDoc } from "./doc.js";
import { markersOf } from "./doc.js";
import { layout } from "./figure.js";
import type { Layout } from "./figure.js";
import { get as getLadder } from "./ladders.js";
import { assignSizes, formatLabel } from "./marker.js";
import type { AssignedBand } from "./marker.js";
import { escapeXml } from "./util.js";

interface ItemBase {
  /** 描边/文字颜色；不给就按黑。 */
  color?: string | null;
}

export interface TextItem extends ItemBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  align?: "left" | "center" | "right";
  anchor?: "alphabetic" | "middle";
  bold?: boolean;
  italic?: boolean;
  family?: string | null;
  rotate?: number;
  halo?: boolean;
  haloColor?: string;
}

export interface LineItem extends ItemBase {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export interface RectItem extends ItemBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  radius?: number;
  fill?: string;
}

export interface CircleItem extends ItemBase {
  kind: "circle";
  x: number;
  y: number;
  r: number;
  width: number;
  fill?: string;
}

export interface ImageItem {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SceneItem = TextItem | LineItem | RectItem | CircleItem | ImageItem;

export interface Scene {
  widthPt: number;
  heightPt: number;
  layout: Layout;
  items: SceneItem[];
}

export interface SceneInput {
  cropW: number;
  cropH: number;
}

interface Hole {
  hole: DocMarker;
  assigned: AssignedBand[];
}

/** 文字里的 *斜体* 标记：整条去掉星号并按斜体画（v1 简化处理）。 */
function fmt(t: unknown): { text: string; italic: boolean } {
  const s = String(t == null ? "" : t);
  const italic = /\*[^*]+\*/.test(s);
  return { text: s.replace(/\*/g, ""), italic };
}

/** 条件行高度（供调用方预留空间）。 */
export const condRowH = (n: number): number => 0.3 + n * 1.15;

export function scene(doc: WesternDoc, o: SceneInput): Scene {
  const st = doc.style;
  const fp = st.fontPt || 9;
  const showLaneNames = st.sampleNamePos !== "none";
  const unit = doc.mode === "gel" ? "bp" : "kDa";

  const groups = byKind(doc, "group");
  const conds = byKind(doc, "condition");
  // 一图可有多孔 ladder：每孔独立泳道 / 型号 / 勾选的条带
  const holes: Hole[] = markersOf(doc)
    .map((h) => {
      const ladder = getLadder(h.ladderId || "") ?? { sizes: [] as number[] };
      const chosen = Array.isArray(h.sizes) ? h.sizes : ladder.sizes;
      return { hole: h, assigned: assignSizes(h.points ?? [], chosen) };
    })
    .filter((x) => x.assigned.length > 0);
  const assigned = holes.length ? holes[0]!.assigned : [];
  const markerLabels = assigned.map((p) => formatLabel(p.kDa, unit));

  const lay = layout({
    cropW: o.cropW,
    cropH: o.cropH,
    widthMm: doc.exportOptions.widthMm,
    fontPt: fp,
    laneCenters: doc.laneCenters,
    laneNames: doc.laneNames,
    angle: st.laneNameAngle,
    showLaneNames,
    groups: groups.map((g) => ({ lanes: g.lanes, name: g.name, pt: g.pt })),
    groupFit: st.groupFit || "wrap",
    minFontPt: st.minFontPt || 5,
    laneNamesAbove: st.laneNamesAbove !== false,
    panelLetter: st.panelLetter || "",
    condCount: conds.length,
    condNames: conds.map((c) => c.drug || ""),
    condRows: conds.map((c) => ({ name: c.drug || "", pt: c.pt || null })),
    title: doc.title || "",
    markerLabels,
    showUnit: markerLabels.length > 0,
    unit,
    laneNamePt: st.laneNamePt || null,
    markerPt: st.markerPt || null,
    laneStyle: doc.laneStyle as never,
    antibody: st.antibody || "",
    textBelow: byKind(doc, "text").filter((t) => (t.side || "below") === "below").length,
  });

  const items: SceneItem[] = [];
  const img = lay.img;

  // ⓪ 上级组名：横跨全图的一条线
  if (doc.title) {
    const y0 = lay.titleBaseline;
    items.push({
      kind: "text",
      x: img.x + img.w / 2,
      y: y0,
      text: doc.title,
      size: fp * 1.05,
      align: "center",
      anchor: "alphabetic",
    });
    items.push({
      kind: "line",
      x1: img.x,
      y1: y0 + fp * 0.34,
      x2: img.x + img.w,
      y2: y0 + fp * 0.34,
      width: Math.max(0.4, fp * 0.07),
    });
  }

  // ① 组名 + 横线（分层由 layout 里的 groupTiers 决定）
  if (lay.groupItems && lay.groupItems.length) {
    lay.groupItems.forEach((g) => {
      const lineY = g.y + g.size * 0.3;
      const lwid = Math.max(0.4, fp * 0.07);
      items.push({ kind: "line", x1: g.x0, y1: lineY, x2: g.x1, y2: lineY, width: lwid });
      if (st.groupTicks) {
        const tick = fp * 0.45;
        items.push({ kind: "line", x1: g.x0, y1: lineY, x2: g.x0, y2: lineY + tick, width: lwid });
        items.push({ kind: "line", x1: g.x1, y1: lineY, x2: g.x1, y2: lineY + tick, width: lwid });
      }
      g.lines.forEach((t, li) => {
        items.push({
          kind: "text",
          x: g.cx,
          y: g.y - (g.lines.length - 1 - li) * g.size * 1.15,
          text: t,
          size: g.size,
          align: "center",
          anchor: "alphabetic",
        });
      });
    });
  }

  // 面板字母（A/B/C）—— 贴在成图左上角
  if (st.panelLetter) {
    items.push({
      kind: "text",
      x: fp * 0.4,
      y: fp * 1.4,
      text: st.panelLetter,
      size: fp * 1.5,
      align: "left",
      anchor: "alphabetic",
      bold: true,
    });
  }

  // ② 样品名（图上方，默认水平）
  if (showLaneNames) {
    const markerLanes: Record<number, boolean> = {};
    holes.forEach((x) => {
      if (x.hole.lane != null) markerLanes[x.hole.lane] = true;
    });
    lay.lanes.forEach((l, i) => {
      const label = markerLanes[i] ? "M" : l.text;
      // 名字挤在一起时按道宽自动缩小字号（参考图里样品名也是小字）
      const cjk = (String(label).match(/[\u4e00-\u9fa5]/g) || []).length;
      const own = l.size || lay.nameSize || fp; // 这一道自己的字号（没设就跟随全局）
      const wEst = (cjk * 1.0 + (String(label).length - cjk) * 0.55) * own;
      const fit = wEst > lay.pitch * 0.92 ? (lay.pitch * 0.92) / (wEst / own) : own;
      items.push({
        kind: "text",
        x: l.x,
        y: lay.namesBaseline,
        text: fmt(label).text,
        italic: fmt(label).italic,
        size: Math.max(5, Math.min(own, fit)),
        family: l.family || st.fontFamily || null,
        color: l.color || null,
        align: st.laneNameAngle ? "left" : "center",
        anchor: "alphabetic",
        rotate: st.laneNameAngle ? -st.laneNameAngle : 0,
      });
    });
  }

  // ③ 条件行（图**上方**）：药名在图框左侧、与 Marker 数值同一条右对齐线；
  //    行距 = 1.3 × 该行字号（GelFigure 的算法），每行可单独设字号
  const condRows = lay.condRows || [];
  conds.forEach((c, ri) => {
    const row = condRows[ri] ?? { y: img.y - fp * 0.55, pt: fp };
    const cp = row.pt || fp;
    const base = row.y;
    if (c.drug) {
      items.push({
        kind: "text",
        x: lay.axis.labelX,
        y: base,
        text: c.drug,
        size: cp,
        align: "right",
        anchor: "alphabetic",
        color: c.color && c.color !== "auto" ? c.color : null,
      });
    }
    lay.lanes.forEach((l, i) => {
      const v = c.marks[i] ?? 0;
      const mark = v === 2 ? "+" : v === 1 ? "\u2212" : "\u00b7";
      items.push({ kind: "text", x: l.x, y: base, text: mark, size: cp, align: "center", anchor: "alphabetic" });
    });
  });

  // ④ 可选：泳道编号（压在图顶边）
  if (st.showNumbers) {
    const nr = lay.numberRow;
    lay.lanes.forEach((l, i) => {
      if (String(l.text || "").trim() === "") return; // 这一道被清空 → 不显示
      items.push({ kind: "circle", x: l.x, y: nr.y, r: nr.r, width: Math.max(0.4, fp * 0.05), fill: "none" });
      items.push({ kind: "text", x: l.x, y: nr.y, text: String(i + 1), size: fp * 0.7, align: "center", anchor: "middle" });
    });
  }

  // ⑤ 图片
  items.push({ kind: "image", x: img.x, y: img.y, w: img.w, h: img.h });

  // ⑥ Marker：每孔一条刻度轴。第 1 道画在框外左侧（带数值），其余孔画在该道中线处
  if (holes.length) {
    const ax0 = lay.axis;
    let unitDrawn = false;
    holes.forEach((x, hi) => {
      // 第一孔固定画在图框左边缘（数值在框外）；其余孔画在各自泳道中线处
      const lane = x.hole.lane == null ? undefined : lay.lanes[x.hole.lane];
      const ax = hi === 0 || !lane ? { x: ax0.x, inside: false } : { x: lane.x, inside: true };
      const tickOut = ax.inside ? fp * 1.05 : ax0.tickOut;
      const labelX = ax.inside ? ax.x - tickOut - fp * 0.35 : ax0.labelX;
      x.assigned.forEach((p) => {
        const yy = img.y + p.y * img.h;
        items.push({
          kind: "line",
          x1: ax.x - tickOut,
          y1: yy,
          x2: ax.x,
          y2: yy,
          width: Math.max(0.5, fp * 0.07),
          color: ax.inside ? "#c8a200" : "#000000",
        });
        items.push({
          kind: "text",
          x: labelX,
          y: yy + fp * 0.3,
          text: formatLabel(p.kDa, unit),
          size: lay.markerSize || fp * 0.85,
          align: "right",
          anchor: "alphabetic",
          halo: ax.inside,
          haloColor: ax.inside ? "rgba(0,0,0,0.85)" : "#fff",
          color: ax.inside ? "#f2f2f2" : null,
        });
      });
      if (!unitDrawn) {
        const ys = x.assigned.map((p) => img.y + p.y * img.h);
        const topY = ys.length ? Math.min(...ys) : img.y + fp * 1.2;
        items.push({
          kind: "text",
          x: ax0.unitX,
          y: Math.min(topY - fp * 1.05, img.y + fp * 1.1),
          text: `(${unit})`,
          size: fp * 0.85,
          align: "right",
          anchor: "alphabetic",
        });
        unitDrawn = true;
      }
    });
  }

  // ⑦ 边框
  if (st.border) items.push({ kind: "rect", x: img.x, y: img.y, w: img.w, h: img.h, width: st.lineWidthPt });

  // ⑧ 图内标注
  byKind(doc, "band").forEach((b) => {
    const lane = lay.lanes[b.lane];
    const x = lane ? lane.x : img.x + img.w / 2;
    const yy = img.y + b.y * img.h;
    items.push({ kind: "line", x1: x - fp * 0.9, y1: yy, x2: x + fp * 0.9, y2: yy, width: Math.max(0.4, fp * 0.07) });
    items.push({
      kind: "text",
      x: x + fp * 1.1,
      y: yy,
      text: b.text,
      size: fp * 0.92,
      align: "left",
      anchor: "middle",
      halo: true,
      haloColor: "#fff",
    });
  });

  byKind(doc, "box").forEach((b) => {
    items.push({
      kind: "rect",
      x: img.x + b.x * img.w,
      y: img.y + b.y * img.h,
      w: b.w * img.w,
      h: b.h * img.h,
      width: Math.max(0.4, fp * 0.07),
    });
    if (b.text) {
      items.push({
        kind: "text",
        x: img.x + b.x * img.w,
        y: img.y + (b.y + b.h) * img.h + fp * 0.9,
        text: b.text,
        size: fp * 0.88,
        align: "left",
        anchor: "alphabetic",
        halo: true,
        haloColor: "#fff",
      });
    }
  });

  byKind(doc, "bracket").forEach((b) => {
    const x = img.x + b.x * img.w;
    const y0 = img.y + b.y0 * img.h;
    const y1 = img.y + b.y1 * img.h;
    const cap = fp * 0.55;
    const w = Math.max(0.4, fp * 0.08);
    items.push({ kind: "line", x1: x, y1: y0, x2: x, y2: y1, width: w });
    items.push({ kind: "line", x1: x - cap, y1: y0, x2: x, y2: y0, width: w });
    items.push({ kind: "line", x1: x - cap, y1: y1, x2: x, y2: y1, width: w });
    if (b.text) {
      items.push({
        kind: "text",
        x: x - cap - fp * 0.4,
        y: (y0 + y1) / 2,
        text: b.text,
        size: fp * 0.85,
        align: "right",
        anchor: "middle",
        halo: true,
        haloColor: "#fff",
      });
    }
  });

  byKind(doc, "text").forEach((t) => {
    const size = t.fontPt || fp;
    const pct = (t.offsetPct == null ? (t.side === "left" || t.side === "right" ? t.y : t.x) * 100 : t.offsetPct) / 100;
    let x = img.x + img.w * pct;
    let yy = img.y + img.h * pct;
    let align: TextItem["align"] = "center";
    let anchor: TextItem["anchor"] = "alphabetic";
    if (t.side === "below") {
      yy = img.y + img.h + fp * (st.antibody ? 3.5 : 1.5);
    } else if (t.side === "above") {
      yy = lay.namesBaseline - fp * 1.4;
    } else if (t.side === "left") {
      x = img.x - lay.leftPad + fp * 0.2;
      align = "left";
      anchor = "middle";
    } else if (t.side === "right") {
      x = img.x + img.w + fp * 0.4;
      align = "left";
      anchor = "middle";
    }
    items.push({
      kind: "text",
      x,
      y: yy,
      text: t.text,
      size,
      align,
      anchor,
      color: t.color === "auto" || !t.color ? undefined : t.color,
      halo: true,
      haloColor: "#fff",
    });
  });

  // ⑨ 抗体说明（图右下角；DNA 凝胶不画）
  if (st.antibody && doc.mode !== "gel") {
    items.push({
      kind: "text",
      x: img.x + img.w,
      y: lay.antibodyY,
      text: st.antibody,
      size: fp,
      align: "right",
      anchor: "alphabetic",
    });
  }

  return { widthPt: lay.widthPt, heightPt: lay.heightPt, layout: lay, items };
}

export interface SvgOptions {
  imageHref?: string;
}

/** SVG 字符串（导出用）。 */
export function toSvg(doc: WesternDoc, sc: Scene, o?: SvgOptions): string {
  const st = doc.style;
  const n = (v: number): string => Number(v).toFixed(2);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(sc.widthPt)}pt" height="${n(sc.heightPt)}pt" viewBox="0 0 ${n(sc.widthPt)} ${n(sc.heightPt)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${n(sc.widthPt)}" height="${n(sc.heightPt)}" fill="#fff"/>`);
  const font = `${st.fontFamily || "Arial"}, sans-serif`;
  sc.items.forEach((it) => {
    if (it.kind === "image") {
      if (o && o.imageHref) {
        parts.push(
          `<image x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none" href="${o.imageHref}"/>`,
        );
      }
    } else if (it.kind === "rect") {
      const stroke = it.color || "#000";
      parts.push(
        `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${n(it.radius || 0)}" fill="${it.fill || "none"}" stroke="${stroke}" stroke-width="${n(it.width)}"/>`,
      );
    } else if (it.kind === "circle") {
      const stroke = it.color || "#000";
      parts.push(
        `<circle cx="${n(it.x)}" cy="${n(it.y)}" r="${n(it.r)}" fill="${it.fill || "none"}" stroke="${stroke}" stroke-width="${n(it.width)}"/>`,
      );
    } else if (it.kind === "line") {
      const stroke = it.color || "#000";
      parts.push(
        `<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${stroke}" stroke-width="${n(it.width)}"/>`,
      );
    } else {
      const anchor = it.align === "center" ? "middle" : it.align === "right" ? "end" : "start";
      const rot = it.rotate ? ` transform="rotate(${it.rotate} ${n(it.x)} ${n(it.y)})"` : "";
      const halo = it.halo
        ? ` stroke="${it.haloColor || "#fff"}" stroke-width="${n(it.size * 0.18)}" paint-order="stroke" stroke-linejoin="round"`
        : "";
      parts.push(
        `<text x="${n(it.x)}" y="${n(it.y)}" font-family="${escapeXml(it.family || font)}" font-size="${n(it.size)}" fill="${it.color || "#000"}" text-anchor="${anchor}" dominant-baseline="${it.anchor === "middle" ? "middle" : "auto"}"${rot}${halo}${it.italic ? ' font-style="italic"' : ""}>${escapeXml(it.text)}</text>`,
      );
    }
  });
  parts.push("</svg>");
  return parts.join("\n");
}
