/**
 * 六类标注的增删改与夹取 —— 移植自 `apps/western/src/core/annotations.js`。
 *
 * 与原实现一致：`normalize` 会补齐字段并夹取到合法范围，`add/update` 都经过它；
 * id 由文档上的 `_seq` 递增生成（`a1`、`a2`…），所以同一份文档的 id 可复现。
 */
import { clamp } from "./util.js";

export const ANNOTATION_KINDS = [
  "group",
  "band",
  "condition",
  "box",
  "bracket",
  "text",
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** `condition` 行的标记：0 = 无处理（·）、1 = 不加（−）、2 = 加（+）。 */
export type ConditionMark = 0 | 1 | 2;

interface AnnotationBase {
  id: string;
  kind: AnnotationKind;
}

export interface GroupAnnotation extends AnnotationBase {
  kind: "group";
  /** 选中的泳道下标，升序。 */
  lanes: number[];
  name: string;
}

export interface BandAnnotation extends AnnotationBase {
  kind: "band";
  lane: number;
  /** 0–1 归一化纵坐标。 */
  y: number;
  text: string;
}

export interface ConditionAnnotation extends AnnotationBase {
  kind: "condition";
  drug: string;
  marks: ConditionMark[];
  /** 每行字号；`null` = 跟随全局。 */
  pt: number | null;
}

export interface BoxAnnotation extends AnnotationBase {
  kind: "box";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface BracketAnnotation extends AnnotationBase {
  kind: "bracket";
  x: number;
  y0: number;
  y1: number;
  text: string;
}

export interface TextAnnotation extends AnnotationBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  side: "above" | "below" | "left" | "right";
  offsetPct: number;
  fontPt: number | null;
  color: string;
}

export type Annotation =
  | GroupAnnotation
  | BandAnnotation
  | ConditionAnnotation
  | BoxAnnotation
  | BracketAnnotation
  | TextAnnotation;

/** 标注只能挂在带 `annotations` 与 `_seq` 的文档上。 */
export interface AnnotationDoc {
  annotations: Annotation[];
  _seq?: number;
}

function nextId(doc: AnnotationDoc): string {
  doc._seq = (doc._seq ?? 0) + 1;
  return `a${doc._seq}`;
}

function clamp01(v: unknown): number {
  return clamp(Number(v) || 0, 0, 1);
}

const TEXT_SIDES = ["above", "below", "left", "right"] as const;

/**
 * 按类型补齐字段并夹取。未知类型抛错（原实现文案保留）。
 *
 * 入参是“半成品”——UI 直接传用户输入，所以字段都可能缺。
 */
/** 半成品标注：字段都可能缺、也可能来自用户输入的字符串 —— 先收进来再归一。 */
export type AnnotationInput = { kind?: string } & Record<string, unknown>;

export function normalize(doc: AnnotationDoc, ann: AnnotationInput): Annotation {
  const a = { ...ann } as Record<string, unknown>;
  if (!ANNOTATION_KINDS.includes(a.kind as AnnotationKind)) {
    throw new Error(`未知标注类型：${String(a.kind)}`);
  }
  if (!a.id) a.id = nextId(doc);

  const kind = a.kind as AnnotationKind;
  if (kind === "group") {
    a.lanes = ((a.lanes as number[]) ?? []).slice().sort((x, y) => x - y);
    a.name = String(a.name == null ? "" : a.name);
  } else if (kind === "condition") {
    a.drug = String(a.drug == null ? "" : a.drug);
    a.pt = a.pt == null || a.pt === "" ? null : clamp(Number(a.pt), 4, 24);
    a.marks = ((a.marks as unknown[]) ?? []).map((v) => {
      if (v === true) return 2;
      if (v === false || v == null) return 0;
      return Math.max(0, Math.min(2, Math.floor(Number(v) || 0)));
    });
  } else if (kind === "band") {
    a.lane = Math.max(0, Math.floor(Number(a.lane) || 0));
    a.y = clamp01(a.y);
    a.text = String(a.text == null ? "" : a.text);
  } else if (kind === "box") {
    a.x = clamp01(a.x);
    a.y = clamp01(a.y);
    a.w = clamp(Number(a.w) || 0.05, 0.01, 1 - (a.x as number));
    a.h = clamp(Number(a.h) || 0.05, 0.01, 1 - (a.y as number));
    a.text = String(a.text == null ? "" : a.text);
  } else if (kind === "bracket") {
    a.x = clamp01(a.x);
    a.y0 = clamp01(a.y0);
    a.y1 = clamp01(a.y1);
    if ((a.y1 as number) < (a.y0 as number)) {
      const t = a.y0;
      a.y0 = a.y1;
      a.y1 = t;
    }
    a.text = String(a.text == null ? "" : a.text);
  } else {
    a.x = clamp01(a.x);
    a.y = clamp01(a.y);
    a.text = String(a.text == null ? "" : a.text);
    a.side = TEXT_SIDES.includes(a.side as (typeof TEXT_SIDES)[number]) ? a.side : "below";
    a.offsetPct = clamp(
      Number(a.offsetPct == null ? (a.x as number) * 100 : a.offsetPct),
      0,
      100,
    );
    a.fontPt = a.fontPt == null || a.fontPt === "" ? null : clamp(Number(a.fontPt), 4, 24);
    a.color = a.color || "auto";
  }
  return a as unknown as Annotation;
}

export function add(doc: AnnotationDoc, ann: AnnotationInput): Annotation {
  const a = normalize(doc, ann);
  doc.annotations.push(a);
  return a;
}

/** 删除；返回是否删掉了东西。 */
export function remove(doc: AnnotationDoc, id: string): boolean {
  const i = doc.annotations.findIndex((a) => a.id === id);
  if (i >= 0) doc.annotations.splice(i, 1);
  return i >= 0;
}

export function get(doc: AnnotationDoc, id: string): Annotation | null {
  return doc.annotations.find((a) => a.id === id) ?? null;
}

/** 改一条：合并 patch 后重新 `normalize`（id 保持不变）。 */
export function update(doc: AnnotationDoc, id: string, patch: AnnotationInput): Annotation | null {
  const i = doc.annotations.findIndex((a) => a.id === id);
  if (i < 0) return null;
  doc.annotations[i] = normalize(doc, { ...doc.annotations[i], ...patch, id });
  return doc.annotations[i]!;
}

/** 选几条泳道填组名 → 自动生成/更新分组横线（同一组泳道只留一条）。 */
export function setGroup(doc: AnnotationDoc, lanes: number[], name: string): Annotation {
  const existing = doc.annotations.find(
    (a) =>
      a.kind === "group" &&
      a.lanes.length === lanes.length &&
      a.lanes.every((v, i) => v === lanes[i]),
  );
  if (existing) return update(doc, existing.id, { name })!;
  return add(doc, { kind: "group", lanes, name });
}

export function byKind<K extends AnnotationKind>(
  doc: AnnotationDoc,
  kind: K,
): Extract<Annotation, { kind: K }>[] {
  return doc.annotations.filter((a) => a.kind === kind) as Extract<Annotation, { kind: K }>[];
}
