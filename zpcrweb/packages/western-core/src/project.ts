/**
 * 项目文件：文档 + 原始图片打包成一个 `.wan`（JSON）。
 *
 * 移植自 `apps/western/src/core/project.js`。原实现依赖全局 `W.doc` 与浏览器 `btoa/atob`；
 * 这里由调用方显式传序列化/反序列化函数，base64 用 `globalThis`（Node 18+ 与浏览器都有）。
 */
import type { WesternDoc } from "./doc.js";

export const PROJECT_MAGIC = "western-analysis";
export const PROJECT_VERSION = 1;

/** 项目文件里带的图片。 */
export interface ProjectImage {
  name: string;
  bytes: Uint8Array;
}

export interface ProjectPayload {
  doc: WesternDoc;
  image: ProjectImage | null;
}

/** 序列化/反序列化文档的函数（解耦 `doc.ts`，也方便测试里塞桩）。 */
export interface DocCodec {
  serialize(doc: WesternDoc): string;
  deserialize(text: string): WesternDoc;
}

/** 逐块转字符串再 base64，避免大图一次展开成巨型参数列表。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode(...Array.from(bytes.subarray(i, i + CH)));
  }
  return globalThis.btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 打包成 `.wan` 文本。 */
export function pack(
  codec: DocCodec,
  doc: WesternDoc,
  image?: ProjectImage | null,
  now: () => Date = () => new Date(),
): string {
  const payload: Record<string, unknown> = {
    magic: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    savedAt: now().toISOString(),
    doc: JSON.parse(codec.serialize(doc)),
  };
  if (image && image.bytes && image.bytes.length) {
    payload.image = { name: image.name || "image.tif", data: bytesToBase64(image.bytes) };
  }
  return JSON.stringify(payload);
}

/** 解包；格式不对时抛出带中文说明的错误（原实现的文案保留）。 */
export function unpack(codec: DocCodec, text: string): ProjectPayload {
  let v: {
    magic?: string;
    doc?: unknown;
    image?: { name?: string; data?: string };
  };
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("不是有效的项目文件（JSON 解析失败）");
  }
  if (!v || v.magic !== PROJECT_MAGIC) throw new Error("不是 Western analysis 的项目文件");
  const doc = codec.deserialize(JSON.stringify(v.doc));
  let image: ProjectImage | null = null;
  if (v.image && typeof v.image.data === "string") {
    image = { name: v.image.name || "image.tif", bytes: base64ToBytes(v.image.data) };
  }
  return { doc, image };
}
