import { describe, expect, it } from "vitest";
import { add, ANNOTATION_KINDS, byKind, get, normalize, remove, setGroup, update } from "../src/annotations.js";

const emptyDoc = () => ({ annotations: [] as ReturnType<typeof add>[] });

describe("annotations", () => {
  it("六种类型都认，未知类型抛错", () => {
    expect(ANNOTATION_KINDS).toEqual(["group", "band", "condition", "box", "bracket", "text"]);
    expect(() => normalize(emptyDoc(), { kind: "arrow" })).toThrow(/未知标注类型/);
  });

  it("id 按文档序号递增", () => {
    const doc = emptyDoc();
    expect(add(doc, { kind: "band", lane: 0, y: 0.5 }).id).toBe("a1");
    expect(add(doc, { kind: "band", lane: 1, y: 0.5 }).id).toBe("a2");
    expect(doc.annotations).toHaveLength(2);
  });

  it("box 尺寸夹在可见范围内", () => {
    const a = add(emptyDoc(), { kind: "box", x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    expect(a.kind).toBe("box");
    if (a.kind !== "box") throw new Error("type");
    expect(a.w).toBeLessThanOrEqual(1 - a.x + 1e-12);
    expect(a.h).toBeLessThanOrEqual(1 - a.y + 1e-12);
    expect(a.w).toBeGreaterThanOrEqual(0.01);
  });

  it("bracket 的 y0/y1 自动排序", () => {
    const a = add(emptyDoc(), { kind: "bracket", x: 0.5, y0: 0.8, y1: 0.2, text: "" });
    if (a.kind !== "bracket") throw new Error("type");
    expect(a.y0).toBeLessThan(a.y1);
  });

  it("condition 的 marks 归一成 0/1/2，pt 夹在 4–24", () => {
    const a = add(emptyDoc(), {
      kind: "condition",
      drug: "DOX",
      marks: [true, false, null, 3, -1, 1.7],
      pt: 99,
    });
    if (a.kind !== "condition") throw new Error("type");
    expect(a.marks).toEqual([2, 0, 0, 2, 0, 1]);
    expect(a.pt).toBe(24);
  });

  it("text 的 side 非法时回落 below，offsetPct 缺省取 x*100", () => {
    const a = add(emptyDoc(), { kind: "text", x: 0.25, y: 0.5, text: "hi", side: "diagonal" });
    if (a.kind !== "text") throw new Error("type");
    expect(a.side).toBe("below");
    expect(a.offsetPct).toBeCloseTo(25, 10);
    expect(a.color).toBe("auto");
    expect(a.fontPt).toBeNull();
  });

  it("update 保留 id，remove 返回是否删掉", () => {
    const doc = emptyDoc();
    const a = add(doc, { kind: "group", lanes: [2, 0, 1], name: "A" });
    if (a.kind !== "group") throw new Error("type");
    expect(a.lanes).toEqual([0, 1, 2]);
    const updated = update(doc, a.id, { name: "B" });
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(a.id);
    expect((updated as { name: string }).name).toBe("B");
    expect(get(doc, a.id)).toBe(updated);
    expect(remove(doc, a.id)).toBe(true);
    expect(remove(doc, a.id)).toBe(false);
    expect(get(doc, a.id)).toBeNull();
  });

  it("setGroup 对同一组泳道复用一条", () => {
    const doc = emptyDoc();
    setGroup(doc, [0, 1], "组1");
    setGroup(doc, [0, 1], "组2");
    expect(byKind(doc, "group")).toHaveLength(1);
    expect(byKind(doc, "group")[0]!.name).toBe("组2");
  });

  it("byKind 按类型过滤", () => {
    const doc = emptyDoc();
    add(doc, { kind: "band", lane: 0, y: 0.1 });
    add(doc, { kind: "text", x: 0, y: 0, text: "x" });
    expect(byKind(doc, "band")).toHaveLength(1);
    expect(byKind(doc, "text")).toHaveLength(1);
    expect(byKind(doc, "box")).toHaveLength(0);
  });
});
