/**
 * ladder 列表：复用 `vendor/wbladders.js`（原挂在 `window.ProteinLadders`）与 `window.DNALadders`，
 * 拿不到时给一份兜底表；用户自定义的 ladder 存在 localStorage 的 `wa-custom-ladders`。
 *
 * 移植自 `apps/western/src/core/ladders.js`。原实现直接读全局与 `localStorage`；这里改成
 * `LadderEnv` 注入 —— 同一个行为，但可以在 Node 里测，也让“库从哪来”变成显式依赖。
 */
import type { ThemeStorage } from "./theme.js";

export interface Ladder {
  id: string;
  vendor: string;
  name: string;
  sizes: number[];
  ref?: number[];
  custom?: boolean;
}

/** 蛋白 ladder 源（`vendor/wbladders.js` 暴露的 `ProteinLadders.all()`）。 */
export interface ProteinLadderSource {
  all(): Ladder[];
}

export interface LadderEnv {
  protein?: ProteinLadderSource | null;
  /** DNA ladder 库（`window.DNALadders`）。 */
  dna?: Ladder[] | null;
  storage?: ThemeStorage | null;
}

/** 兜底：没有任何 ladder 库时至少有一条通用预染。 */
export const FALLBACK: readonly Ladder[] = [
  {
    id: "generic_10",
    vendor: "通用",
    name: "通用预染 10–180 kDa",
    sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10],
  },
];

export const CUSTOM_KEY = "wa-custom-ladders";

function memoryStorage(): ThemeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function storageOf(env?: LadderEnv): ThemeStorage {
  return env?.storage ?? (globalThis as { localStorage?: ThemeStorage }).localStorage ?? memoryStorage();
}

/** DNA ladder 库（复制成新对象，避免调用方改到源）。 */
export function dnaList(env?: LadderEnv): Ladder[] {
  const list = env?.dna ?? [];
  return list.map((l) => ({
    id: l.id,
    vendor: "DNA ladder",
    name: l.name,
    sizes: (l.sizes ?? []).slice(),
    ref: (l.ref ?? []).slice(),
  }));
}

export function loadCustom(env?: LadderEnv): Ladder[] {
  try {
    const raw = storageOf(env).getItem(CUSTOM_KEY);
    const list = raw ? (JSON.parse(raw) as Ladder[]) : [];
    return Array.isArray(list) ? list.filter((l) => l && l.id && Array.isArray(l.sizes)) : [];
  } catch {
    return [];
  }
}

export function saveCustom(env: LadderEnv | undefined, list: Ladder[] | null | undefined): void {
  try {
    storageOf(env).setItem(CUSTOM_KEY, JSON.stringify(list ?? []));
  } catch {
    /* 存不进去就算了：自定义 ladder 是便利设施 */
  }
}

/** 内置库：来自 `env.protein`，拿不到时用 {@link FALLBACK}。 */
export function builtinAll(env?: LadderEnv): Ladder[] {
  const api = env?.protein;
  if (!api || typeof api.all !== "function") return FALLBACK.map((l) => ({ ...l, sizes: l.sizes.slice() }));
  try {
    const list = api.all();
    if (!Array.isArray(list) || !list.length) {
      return FALLBACK.map((l) => ({ ...l, sizes: l.sizes.slice() }));
    }
    return list.map((l) => ({
      id: l.id,
      vendor: l.vendor || "其他",
      name: l.name || l.id,
      sizes: (l.sizes ?? []).slice(),
      ref: (l.ref ?? []).slice(),
    }));
  } catch {
    return FALLBACK.map((l) => ({ ...l, sizes: l.sizes.slice() }));
  }
}

/** 自定义在前、内置在后。 */
export function all(env?: LadderEnv): Ladder[] {
  const custom = loadCustom(env).map((l) => ({
    id: l.id,
    vendor: l.vendor || "自定义",
    name: l.name || l.id,
    sizes: (l.sizes ?? []).slice(),
    custom: true,
  }));
  return [...custom, ...builtinAll(env)];
}

/** `mode: 'blot'` → 蛋白（kDa）；`'gel'` → DNA（bp）。 */
export function allFor(mode: string, env?: LadderEnv): Ladder[] {
  if (mode === "gel") {
    const list = dnaList(env);
    return list.length ? list : FALLBACK.map((l) => ({ ...l, sizes: l.sizes.slice() }));
  }
  return all(env);
}

export function unitFor(mode: string): "bp" | "kDa" {
  return mode === "gel" ? "bp" : "kDa";
}

/** 按 id 查（蛋白库与 DNA 库都查，id 在库里唯一）。 */
export function get(id: string, env?: LadderEnv): Ladder | null {
  const list = [...all(env), ...dnaList(env)];
  for (const l of list) if (l.id === id) return l;
  return null;
}

/** 按 vendor 分组，供下拉框用。 */
export function groups(env?: LadderEnv): Record<string, Ladder[]> {
  const out: Record<string, Ladder[]> = {};
  for (const l of all(env)) (out[l.vendor] = out[l.vendor] ?? []).push(l);
  return out;
}
