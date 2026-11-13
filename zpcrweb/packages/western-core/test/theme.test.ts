import { describe, expect, it } from "vitest";
import { load, normalize, resolve, save, THEME_KEY, type ThemeStorage } from "../src/theme.js";

function memory(): ThemeStorage & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    dump: () => map,
  };
}

describe("theme", () => {
  it("normalize 只认三种偏好", () => {
    expect(normalize("bogus")).toBe("system");
    expect(normalize(undefined)).toBe("system");
    expect(normalize("dark")).toBe("dark");
  });

  it("resolve 把 system 交给系统明暗", () => {
    expect(resolve("light", true)).toBe("light");
    expect(resolve("dark", false)).toBe("dark");
    expect(resolve("system", true)).toBe("dark");
    expect(resolve("system", false)).toBe("light");
  });

  it("load/save 走给定存储", () => {
    const st = memory();
    expect(load(st)).toBe("system");
    save(st, "dark");
    expect(st.getItem(THEME_KEY)).toBe("dark");
    expect(load(st)).toBe("dark");
    save(st, "nonsense");
    expect(load(st)).toBe("system");
  });

  it("存储抛异常时不炸", () => {
    const broken: ThemeStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(load(broken)).toBe("system");
    expect(() => save(broken, "dark")).not.toThrow();
  });
});
