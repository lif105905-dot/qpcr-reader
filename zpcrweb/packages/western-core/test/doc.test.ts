import { describe, expect, it } from "vitest";
import { create, DEFAULT_STYLE, defaultLaneNames, defaultView, deserialize, isDoc, markersOf, serialize } from "../src/doc.js";

describe("doc", () => {
  it("新建文档字段齐全，marker 镜像 markers[0]", () => {
    const d = create("blot");
    expect(d.mode).toBe("blot");
    expect(d.style).toEqual(DEFAULT_STYLE);
    expect(d.view).toEqual(defaultView());
    expect(d.markers).toHaveLength(1);
    expect(d.marker).toBe(d.markers[0]);
    expect(d.exportOptions).toEqual({ dpi: 600, widthMm: 85 });
  });

  it("create 只认 blot/gel，其它回落 blot", () => {
    expect(create("gel").mode).toBe("gel");
    expect(create(undefined).mode).toBe("blot");
  });

  it("序列化往返保持一致", () => {
    const d = create("gel");
    d.laneCount = 3;
    d.laneCenters = [0.1, 0.5, 0.9];
    expect(deserialize(serialize(d))).toEqual(d);
  });

  it("旧字段 laneEdges 迁移成 laneCenters", () => {
    const raw = JSON.stringify({ ...create("blot"), laneCenters: undefined, laneEdges: [0.2, 0.8] });
    const d = deserialize(raw);
    expect(d.laneCenters).toEqual([0.2, 0.8]);
    expect("laneEdges" in d).toBe(false);
  });

  it("旧文档只有 marker 时补成 markers", () => {
    const base = create("blot");
    const legacy = { ...base, markers: undefined, marker: { ladderId: "x", points: [{ x: 0, y: 1 }], sizes: [180] } };
    const d = deserialize(JSON.stringify(legacy));
    expect(d.markers).toHaveLength(1);
    expect(d.markers[0]!.ladderId).toBe("x");
    expect(d.marker).toBe(d.markers[0]);
  });

  it("缺样式/视图字段时补默认", () => {
    const d = deserialize(JSON.stringify({ ...create("blot"), style: { fontPt: 12 }, view: { rotate: 90 } }));
    expect(d.style.fontPt).toBe(12);
    expect(d.style.fontFamily).toBe(DEFAULT_STYLE.fontFamily);
    expect(d.view.rotate).toBe(90);
    expect(d.view.gamma).toBe(1);
  });

  it("isDoc 拒绝版本/模式不对的对象", () => {
    expect(isDoc(create("blot"))).toBe(true);
    expect(isDoc({ ...create("blot"), version: 99 })).toBe(false);
    expect(isDoc({ ...create("blot"), mode: "other" })).toBe(false);
    expect(isDoc(null)).toBe(false);
  });

  it("默认泳道名与 markersOf", () => {
    expect(defaultLaneNames(3)).toEqual(["1", "2", "3"]);
    const d = create("blot");
    expect(markersOf(d)).toHaveLength(1);
    expect(markersOf(null)).toEqual([]);
  });
});
