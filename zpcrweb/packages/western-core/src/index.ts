/**
 * `@zpcrweb/western-core` —— Western 分析的纯逻辑层。
 *
 * 逐个模块从 `apps/western/src/core/*.js` 迁来：先搬行为，再加类型，用原测试套件对拍。
 *
 * `annotations` 与 `ladders` 以命名空间导出：两边都有 `normalize` / `get` 这类通用名，
 * 平铺会撞名，`annotations.add(...)` / `ladders.get(...)` 读起来也更清楚。
 */
export * from "./util.js";
export * from "./theme.js";
export * from "./transform.js";
export * from "./detect.js";
export * from "./canvasmath.js";
export * from "./lanes.js";
export * from "./marker.js";
export * from "./doc.js";
export * from "./project.js";
export * from "./image.js";
export * from "./render.js";
export * from "./figure.js";
export * as annotations from "./annotations.js";
export * as ladders from "./ladders.js";
