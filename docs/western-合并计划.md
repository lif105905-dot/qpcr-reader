# Western 并入单体的改造计划

目标：把 `apps/western`（原生 JS，5,400 行）真正并进 LabKit，变成一套 React + TypeScript 的单体应用，与 qPCR 共用窗口、顶栏和项目存储。

现状基线（改前跑过）：`npm test -w western-analysis` → 104 项全绿。

## 现状盘点

| 层 | 文件 | 行数 | 说明 |
|---|---|---|---|
| 入口 | `src/app.js` | 864 | 路由 + 全局状态 + 事件绑定，改造的主要难点 |
| 样式 | `src/app.css` | 303 | 与 qPCR 的暗色主题不是一套 token |
| core | 17 个模块 | ~2,000 | 纯逻辑，最容易先搬：`util/theme/transform/detect/project/marker/lanes/ladders/canvasmath/annotations/doc/image/render/figure/export` |
| ui | 6 个模块 | ~2,000 | `home 78 / exporter 200 / editor 203 / canvasview 528 / figureview 671 / controls 834` |
| 测试 | `test/*.mjs` 9 个 | — | node --test，覆盖 core 与导出 |
| e2e | `e2e/phase*.mjs` 22 个 | — | Playwright 驱动打包后的单文件 HTML |

## 分四步

### P1 · core → `packages/western-core`（可并行、可验证）

逐个模块从 `.js` 迁到 `.ts`，纯函数保持行为不变，全部加类型。用现有的 `test/*.mjs` 作为回归标准：同一个用例先跑旧实现，再跑新包，输出必须一致。

顺序按依赖与体量：`util → theme → transform → detect → canvasmath → lanes → marker → ladders → annotations → image → doc → project → render → figure → export`。

验收：`packages/western-core` 单测通过，且逐模块与旧实现做一次对拍（同一输入同一输出）。

### P2 · 共享数据模型与存储

- `project.js` / `doc.js` 是 Western 自己的文档模型。先原样搬成类型，不在这一步动结构；
- 存储（现在是什么就保留什么），只在外面包一层统一的项目读写接口，为 P4 的共享存储留口。

验收：同一个项目文件，旧 UI 保存、新代码读出来一致（反之亦然）。

### P3 · UI 迁到 React（`apps/web` 里新开 `/western`）

按「最小可用纵切」推进，每一刀都可独立验收：

1. 打开图片 + 画布显示 + 缩放平移（`image.js` + `canvasview.js` 的只读部分）；
2. 条带检测/手动画框 + 内参归一化 + 表格（`detect.js` + `controls.js` 的核心）；
3. 出图（`figure.js` / `figureview.js`）与导出（`export.js`、SVG/PNG/TIFF）；
4. 项目保存/打开（`project.js`）。

`app.js` 里的全局状态拆成 React 的 store，事件绑定换成组件回调。样式统一到 qPCR 的 token 体系。

### P4 · 合并成一个窗口

- LabKit 首页改成统一工作台：Western / qPCR 两个模式在同一页切换，不再开第二个窗口；
- `apps/desktop/main.js` 去掉 `labkit:open-qpcr` 的独立窗口逻辑，改成同窗口路由；
- 旧的 `apps/western/src` 保留一个版本作为回退，确认无回归后再删。

## 风险与取舍

| 风险 | 处理 |
|---|---|
| 22 个 e2e 依赖打包后的单文件 HTML | P3 期间保留旧实现不动，e2e 继续跑旧的；新 UI 另写等价用例 |
| `app.js` 864 行的隐式全局状态 | 先画状态图再拆，不边拆边改行为 |
| 样式重写导致「看起来变了」 | 先搬结构、后调样式，分两次提交 |
| 一次性大改无法回滚 | 每一步一个小提交，旧代码在 `main` 之外保留分支 |

## 下一步

P1 第一个模块：`apps/western/src/core/util.js`（26 行）→ `packages/western-core/src/util.ts`，配 vitest，跑通后再按依赖顺序推进。
