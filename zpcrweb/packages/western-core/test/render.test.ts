import { describe, expect, test } from "vitest";
import { add, setGroup } from "../src/annotations.js";
import type { WesternDoc } from "../src/doc.js";
import { create } from "../src/doc.js";
import { scene, toSvg } from "../src/render.js";
import { setCount } from "../src/lanes.js";

function base(): WesternDoc {
  const d = create("blot");
  setCount(d, 4);
  return d;
}
const sc = (d: WesternDoc) => scene(d, { cropW: 1200, cropH: 220 });

describe("场景基础", () => {
  test("有图块和边框", () => {
    const s = sc(base());
    expect(s.items.filter((i) => i.kind === "image")).toHaveLength(1);
    expect(s.items.filter((i) => i.kind === "rect")).toHaveLength(1);
  });

  test("关掉边框就没有 rect", () => {
    const d = base();
    d.style.border = false;
    expect(sc(d).items.filter((i) => i.kind === "rect")).toHaveLength(0);
  });

  test("泳道名在图片上方，且数量与条数一致", () => {
    const s = sc(base());
    const img = s.layout.img;
    const want = s.layout.lanes.map((l) => l.text);
    const names = s.items.filter(
      (i): i is Extract<typeof i, { kind: "text" }> =>
        i.kind === "text" && want.indexOf(i.text) >= 0 && i.y < img.y,
    );
    expect(names).toHaveLength(want.length);
    names.forEach((t) => expect(t.y).toBeLessThan(img.y));
  });

  test("打开编号开关才画泳道编号圆点", () => {
    expect(sc(base()).items.filter((i) => i.kind === "circle")).toHaveLength(0);
    const d = base();
    d.style.showNumbers = true;
    const s = sc(d);
    const circles = s.items.filter((i) => i.kind === "circle");
    expect(circles).toHaveLength(s.layout.lanes.length);
    circles.forEach((c) => expect(c.y).toBeLessThan(s.layout.img.y));
  });

  test("高度不小于图块高度", () => {
    const s = sc(base());
    expect(s.heightPt).toBeGreaterThan(s.layout.img.h);
  });
});

describe("标注进场景", () => {
  test("分组横线：文字 + 线，且把下方内容推下去", () => {
    const d = base();
    const before = sc(d).heightPt;
    setGroup(d, [0, 1], "Ctrl");
    const s = sc(d);
    expect(s.items.filter((i) => i.kind === "line")).toHaveLength(1);
    expect(s.items.some((i) => i.kind === "text" && i.text === "Ctrl")).toBe(true);
    expect(s.heightPt).toBeGreaterThan(before);
  });

  test("条件行：药名 + 三态（· / − / +）", () => {
    const d = base();
    add(d, { kind: "condition", drug: "EGF", marks: [2, 1, 0, 2] });
    const s = sc(d);
    expect(s.items.some((i) => i.kind === "text" && i.text === "EGF")).toBe(true);
    const marks = s.items
      .filter((i) => i.kind === "text" && ["+", "\u2212", "\u00b7"].indexOf(i.text) >= 0)
      .map((i) => (i.kind === "text" ? i.text : ""));
    expect(marks).toEqual(["+", "\u2212", "\u00b7", "+"]);
  });

  test("目标条带：刻度线 + 文字", () => {
    const d = base();
    add(d, { kind: "band", lane: 2, y: 0.4, text: "p-ERK" });
    const s = sc(d);
    expect(s.items.some((i) => i.kind === "text" && i.text === "p-ERK")).toBe(true);
    expect(s.items.filter((i) => i.kind === "line")).toHaveLength(1);
  });

  test("区域框与侧边括号画的都是矩形/线", () => {
    const d = base();
    add(d, { kind: "box", x: 0.1, y: 0.1, w: 0.3, h: 0.3, text: "zoom" });
    expect(sc(d).items.filter((i) => i.kind === "rect")).toHaveLength(2); // 边框 + 区域框

    const d2 = base();
    add(d2, { kind: "bracket", x: 0.05, y0: 0.2, y1: 0.7, text: "tail" });
    const s2 = sc(d2);
    expect(s2.items.filter((i) => i.kind === "line")).toHaveLength(3); // 竖线 + 两个横臂
    expect(s2.items.some((i) => i.kind === "text" && i.text === "tail")).toBe(true);
  });

  test("侧边文字按位置贴在四周（v9 版式）", () => {
    const d = base();
    add(d, { kind: "text", x: 0.1, y: 0.5, text: "L", side: "left", offsetPct: 50 });
    add(d, { kind: "text", x: 0.9, y: 0.5, text: "R", side: "right", offsetPct: 50 });
    add(d, { kind: "text", x: 0.5, y: 0.5, text: "B", side: "below", offsetPct: 50 });
    const s = sc(d);
    const img = s.layout.img;
    const pick = (t: string) =>
      s.items.find((i): i is Extract<typeof i, { kind: "text" }> => i.kind === "text" && i.text === t)!;
    const L = pick("L");
    const R = pick("R");
    const B = pick("B");
    expect(L.x).toBeLessThan(img.x);
    expect(R.x).toBeGreaterThan(img.x + img.w);
    expect(B.y).toBeGreaterThan(img.y + img.h);
    expect(B.align).toBe("center");
  });
});

describe("SVG 导出", () => {
  test("含 svg 根、文字与转义", () => {
    const d = base();
    add(d, { kind: "text", x: 0.5, y: 0.5, text: "a<b&c", side: "left" });
    const svg = toSvg(d, sc(d), {});
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("a&lt;b&amp;c");
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  test("给了 imageHref 就嵌图", () => {
    const d = base();
    const s = sc(d);
    expect(toSvg(d, s, { imageHref: "data:image/png;base64,AAA" })).toContain("<image");
    expect(toSvg(d, s, {})).not.toContain("<image");
  });

  test("字体族进 SVG", () => {
    const d = base();
    d.style.fontFamily = "Times New Roman";
    expect(toSvg(d, sc(d), {})).toContain("Times New Roman");
  });
});
