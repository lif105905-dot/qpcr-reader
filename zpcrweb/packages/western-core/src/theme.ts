/**
 * 主题偏好：`light` / `dark` / `system`。
 *
 * 移植自 `apps/western/src/core/theme.js`。原实现默认读写 `window.localStorage`，这里把存储
 * 改成显式参数（默认返回浏览器存储，判空后回退到内存实现），这样 Node 里也能测，行为不变。
 */

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "wa-theme";
export const THEME_PREFS: readonly ThemePref[] = ["light", "dark", "system"];

/** 用到的存储接口 —— 与 `localStorage` 兼容的最小子集。 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalize(pref: unknown): ThemePref {
  return THEME_PREFS.includes(pref as ThemePref) ? (pref as ThemePref) : "system";
}

/** 偏好 + 系统明暗 → 实际主题。 */
export function resolve(pref: unknown, systemDark: boolean): ResolvedTheme {
  const p = normalize(pref);
  if (p === "light" || p === "dark") return p;
  return systemDark ? "dark" : "light";
}

/** 内存版存储：没有 `localStorage` 时（Node、隐私模式）用它兜底。 */
function memoryStorage(): ThemeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function defaultStorage(): ThemeStorage {
  const candidate = (globalThis as { localStorage?: ThemeStorage }).localStorage;
  return candidate ?? memoryStorage();
}

export function load(storage?: ThemeStorage): ThemePref {
  try {
    return normalize((storage ?? defaultStorage()).getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function save(storage: ThemeStorage | undefined, pref: unknown): void {
  try {
    (storage ?? defaultStorage()).setItem(THEME_KEY, normalize(pref));
  } catch {
    /* 存不进去就算了：主题是偏好，不是数据 */
  }
}
