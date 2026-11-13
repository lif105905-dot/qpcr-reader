import { describe, expect, it } from "vitest";
import { clamp, escapeXml, mmToPt, PT_PER_MM, ptToMm, round, uid } from "../src/util.js";

describe("util", () => {
  it("clamp 夹到区间内", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("round 按位数四舍五入", () => {
    expect(round(1.2345)).toBe(1);
    expect(round(1.2345, 2)).toBe(1.23);
    // 原实现走 Math.round，负半值向 +∞ 取整：-12.5 → -12，所以这里是 -1.2。
    expect(round(-1.25, 1)).toBe(-1.2);
    expect(round(-1.26, 1)).toBe(-1.3);
  });

  it("mm/pt 互转", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
    expect(ptToMm(72)).toBeCloseTo(25.4, 10);
    expect(mmToPt(0)).toBe(0);
    expect(PT_PER_MM).toBeCloseTo(72 / 25.4, 12);
  });

  it("escapeXml 转义五个字符并把 null 当空串", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;",
    );
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(undefined)).toBe("");
    expect(escapeXml(42)).toBe("42");
  });

  it("uid 带前缀且每次不同", () => {
    const a = uid();
    const b = uid();
    expect(a).toMatch(/^id-[a-z0-9]{1,7}$/);
    expect(a).not.toBe(b);
    expect(uid("lanes")).toMatch(/^lanes-/);
  });
});
