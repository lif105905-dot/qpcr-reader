import { describe, expect, it } from "vitest";
import { groupTiers, labelHeight, layout, textWidth, wrapText } from "../src/figure.js";
import { mmToPt } from "../src/util.js";

describe("figure 文字度量", () => {
  it("中文按 1 em、西文按 0.55 em", () => {
    expect(textWidth("AB", 10)).toBeCloseTo(11, 6);
    expect(textWidth("膜", 10)).toBeCloseTo(10, 6);
    expect(textWidth("", 10)).toBe(10); // 至少 1 em，避免 0 宽
  });

  it("labelHeight 随旋转角变化", () => {
    const flat = labelHeight(10, 0, "IgG");
    const turned = labelHeight(10, 90, "IgG");
    expect(flat).toBeCloseTo(12.5, 6);
    expect(turned).toBeCloseTo(3 * 10 * 0.6, 6);
  });
});

describe("wrapText", () => {
  it("按给定宽度折行", () => {
    const lines = wrapText("alpha beta gamma", 10, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(40.001);
  });

  it("中文逐字断行", () => {
    const lines = wrapText("实验组对照组", 10, 25);
    expect(lines.join("")).toBe("实验组对照组");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe("layout", () => {
  const base = {
    cropW: 1600,
    cropH: 1100,
    widthMm: 85,
    fontPt: 9,
    laneCenters: [0.2, 0.5, 0.8],
    laneNames: ["IgG", "SUMO2/3", "input"],
  };

  it("宽度按 mm 换算成 pt", () => {
    const l = layout(base);
    expect(l.widthPt).toBeCloseTo(mmToPt(85), 6);
    expect(l.heightPt).toBeGreaterThan(l.img.y + l.img.h);
  });

  it("图片等比贴合、泳道中线落在图内", () => {
    const l = layout(base);
    expect(l.img.w / l.img.h).toBeCloseTo(1600 / 1100, 6);
    for (const lane of l.lanes) {
      expect(lane.x).toBeGreaterThan(l.img.x);
      expect(lane.x).toBeLessThan(l.img.x + l.img.w);
    }
  });

  it("组名占掉顶部空间，图往下移", () => {
    const plain = layout(base);
    const grouped = layout({ ...base, groups: [{ lanes: [0, 1], name: "处理组" }] });
    expect(grouped.bands.group).toBeGreaterThan(0);
    expect(grouped.img.y).toBeGreaterThan(plain.img.y);
    expect(grouped.groupLevelCount).toBe(1);
    expect(grouped.groupItems[0]!.x0).toBeLessThan(grouped.groupItems[0]!.x1);
  });

  it("组名过长时按 wrap 折行，shrink 则缩字号", () => {
    const long = "一个非常非常长的分组名称需要折行";
    const wrapped = layout({ ...base, groups: [{ lanes: [0], name: long }] });
    expect(wrapped.groupItems[0]!.lines.length).toBeGreaterThan(1);
    const shrunk = layout({ ...base, groups: [{ lanes: [0], name: long }], groupFit: "shrink" });
    expect(shrunk.groupItems[0]!.size).toBeLessThan(9);
  });

  it("条件行占高度，基线自上而下递增", () => {
    const l = layout({ ...base, condRows: [{ name: "DOX" }, { name: "TNF" }] });
    expect(l.condRows).toHaveLength(2);
    expect(l.condRows[1]!.y).toBeGreaterThan(l.condRows[0]!.y);
    expect(l.bands.cond).toBeGreaterThan(0);
  });

  it("marker 数值越宽，左侧留白越大", () => {
    const narrow = layout(base);
    const wide = layout({ ...base, markerLabels: ["180", "130", "100"] });
    expect(wide.leftPad).toBeGreaterThanOrEqual(narrow.leftPad);
    expect(wide.markerSize).toBeGreaterThan(0);
  });

  it("泳道名在条件行之下时（namesAbove=false）顺序反过来", () => {
    const l = layout({ ...base, laneNamesAbove: false, condRows: [{ name: "DOX" }] });
    expect(l.namesAbove).toBe(false);
    expect(l.namesBaseline).toBeGreaterThan(l.condRows[0]!.y);
  });

  it("全部泳道名为空时不占高度", () => {
    const empty = layout({ ...base, laneNames: ["", "", ""] });
    const named = layout(base);
    expect(empty.bands.names).toBe(0);
    expect(named.bands.names).toBeGreaterThan(0);
  });

  it("antibody 文字加出底部留白", () => {
    const l = layout({ ...base, antibody: "anti-SUMO2/3" });
    expect(l.antibodyY).toBeGreaterThan(l.img.y + l.img.h);
    expect(l.heightPt).toBeGreaterThan(l.img.y + l.img.h);
  });

  it("groupTiers 把重叠的组分到不同层", () => {
    const items = [
      { x0: 0, x1: 100, ext0: 0, ext1: 100, tier: 0 },
      { x0: 50, x1: 150, ext0: 50, ext1: 150, tier: 0 },
      { x0: 200, x1: 300, ext0: 200, ext1: 300, tier: 0 },
    ];
    const tiers = groupTiers(items, 1);
    expect(tiers).toHaveLength(2);
  });
});
