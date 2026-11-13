import { describe, expect, it } from "vitest";
import { create, deserialize, serialize } from "../src/doc.js";
import { base64ToBytes, bytesToBase64, pack, unpack, PROJECT_MAGIC } from "../src/project.js";

const codec = { serialize, deserialize };

describe("project", () => {
  it("打包再解包，文档原样回来", () => {
    const doc = create("blot");
    doc.title = "膜-1";
    doc.laneCount = 2;
    const text = pack(codec, doc);
    const parsed = JSON.parse(text);
    expect(parsed.magic).toBe(PROJECT_MAGIC);
    expect(parsed.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const back = unpack(codec, text);
    expect(back.doc.title).toBe("膜-1");
    expect(back.image).toBeNull();
  });

  it("带图片时 base64 往返无损", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const text = pack(codec, create("gel"), { name: "a.tif", bytes });
    const back = unpack(codec, text);
    expect(back.image!.name).toBe("a.tif");
    expect(Array.from(back.image!.bytes)).toEqual([0, 1, 2, 250, 251, 255]);
  });

  it("savedAt 用注入的时钟，测试可复现", () => {
    const text = pack(codec, create("blot"), null, () => new Date("2026-01-02T03:04:05.000Z"));
    expect(JSON.parse(text).savedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("坏输入给出中文错误", () => {
    expect(() => unpack(codec, "not json")).toThrow(/JSON 解析失败/);
    expect(() => unpack(codec, JSON.stringify({ magic: "other" }))).toThrow(/不是 Western analysis/);
  });

  it("base64 辅助函数往返", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual([9, 8, 7]);
  });
});
