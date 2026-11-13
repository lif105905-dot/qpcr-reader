import { describe, expect, it } from "vitest";
import {
  all,
  allFor,
  builtinAll,
  CUSTOM_KEY,
  dnaList,
  FALLBACK,
  get,
  groups,
  loadCustom,
  saveCustom,
  unitFor,
  type LadderEnv,
} from "../src/ladders.js";
import type { ThemeStorage } from "../src/theme.js";

function memory(): ThemeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const protein = {
  all: () => [
    { id: "p1", vendor: "Bio-Rad", name: "Precision Plus", sizes: [250, 150, 100] },
    { id: "p2", vendor: "Thermo", name: "PageRuler", sizes: [180, 130] },
  ],
};

describe("ladders", () => {
  it("没有库时退回兜底表", () => {
    expect(builtinAll().map((l) => l.id)).toEqual(["generic_10"]);
    expect(allFor("blot").length).toBe(1);
  });

  it("有蛋白库时用它", () => {
    const env: LadderEnv = { protein };
    expect(all(env).map((l) => l.id)).toEqual(["p1", "p2"]);
    expect(all(env)[0]!.vendor).toBe("Bio-Rad");
  });

  it("库抛异常时也退回兜底", () => {
    const boom = { all: () => { throw new Error("boom"); } };
    expect(builtinAll({ protein: boom }).map((l) => l.id)).toEqual(["generic_10"]);
  });

  it("自定义 ladder 排在前面并标记 custom", () => {
    const st = memory();
    saveCustom({ storage: st }, [{ id: "c1", vendor: "", name: "", sizes: [100, 70] }]);
    const list = all({ protein, storage: st });
    expect(list[0]!.id).toBe("c1");
    expect(list[0]!.vendor).toBe("自定义");
    expect(list[0]!.name).toBe("c1");
    expect(list[0]!.custom).toBe(true);
  });

  it("坏的自定义数据被跳过", () => {
    const st = memory();
    st.setItem(CUSTOM_KEY, JSON.stringify([{ id: "ok", sizes: [1] }, { sizes: [2] }, null]));
    expect(loadCustom({ storage: st }).map((l) => l.id)).toEqual(["ok"]);
    st.setItem(CUSTOM_KEY, "{not json");
    expect(loadCustom({ storage: st })).toEqual([]);
  });

  it("gel 模式用 DNA 库，没有则兜底", () => {
    expect(allFor("gel", { dna: [] }).map((l) => l.id)).toEqual(["generic_10"]);
    const mine = allFor("gel", { dna: [{ id: "d1", vendor: "", name: "1kb", sizes: [1000, 500] }] });
    expect(mine[0]!.id).toBe("d1");
    expect(mine[0]!.vendor).toBe("DNA ladder");
    expect(unitFor("gel")).toBe("bp");
    expect(unitFor("blot")).toBe("kDa");
  });

  it("dnaList 复制 sizes，改结果不影响源", () => {
    const src = [{ id: "d1", vendor: "", name: "x", sizes: [1000] }];
    const copy = dnaList({ dna: src });
    copy[0]!.sizes.push(500);
    expect(src[0]!.sizes).toEqual([1000]);
  });

  it("get 两个库都查，groups 按 vendor 分组", () => {
    const env: LadderEnv = { protein, dna: [{ id: "d1", vendor: "", name: "1kb", sizes: [1000] }] };
    expect(get("d1", env)!.name).toBe("1kb");
    expect(get("nope", env)).toBeNull();
    expect(Object.keys(groups(env))).toContain("Bio-Rad");
  });

  it("FALLBACK 尺寸没被调用方改掉", () => {
    const first = builtinAll();
    first[0]!.sizes.push(999);
    expect(FALLBACK[0]!.sizes).not.toContain(999);
  });
});
