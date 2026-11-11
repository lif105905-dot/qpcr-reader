# qPCR 读取器（macOS）

把 Bio-Rad CFX 的原始数据文件（`.pcrd` / `.zpcr` / `.pltd` / `.prcl`）在 Mac 上打开，看扩增曲线、Ct（Cq）与熔解曲线，导出表格与图片。

底层是 [RByers/zpcrweb](https://github.com/RByers/zpcrweb)（GPL-3.0-or-later）的一个分支，本项目在它上面做了：
中文界面、内置 CFX 文件密码、Electron 桌面打包、按 CFX 算法对齐的 Cq 与熔解分析、板图式 Cq 表与导出、曲线着色等。

## 仓库

- 代码：https://github.com/lif105905-dot/qpcr-reader （私有）
- 每次改动在仓库根目录跑 `./提交更新.command "说明"` 提交并上传。

## 怎么用

1. 双击桌面上的 **qPCR Reader.app**（或 `/Applications/qPCR Reader.app`）。
2. 把 `.pcrd` / `.zpcr` 文件拖进窗口，或点右上角「打开文件」。
3. 顶部三个主标签：**定量数据**（扩增曲线 + Cq 表 + 板图）、**熔解数据**、**文件**；
   其余页面（总览 / 程序 / 板 / 参考 / 校准 / 原始 / 仪器）都收在 **更多 ⋯** 里。

详细说明见仓库根目录的 `说明.txt`。

## 目录

```
重新打包.command        构建网页 + 打包 Electron + 安装（改完代码跑这个）
提交更新.command        提交并推送本次改动到远端仓库
说明.txt                给使用者看的说明书
tools/                  Python 工具（解密、批量检查等）
zpcrweb/                应用源码（上游 monorepo 结构）
  packages/core/        解析与分析内核（.pcrd/.zpcr 解码、基线、阈值、熔解）
  apps/web/             网页前端（React + uPlot），含 i18n 中文词条
  apps/desktop/         Electron 桌面壳
  samples/              上游示例文件
```

## 开发

```sh
cd zpcrweb
npm install                 # 不要加 --omit=optional，会缺 rollup/esbuild 原生包
npm test                    # 56 个文件 / 815 条通过
npm run build -w @zpcrweb/web
cd apps/desktop && /usr/local/bin/node ../../node_modules/electron-builder/cli.js --mac --dir
```

一键构建并安装：在仓库根目录运行 `重新打包.command`。

## 关于 Cq 的精度

`.pcrd` 里**不保存任何计算结果**：CFX 每次打开文件时现算 Cq，而自动阈值的取值也不落盘。
本项目的做法是照抄 CFX 的规则（反编译 `BioRad.PCR.Analysis.dll` 得到）：

- 阈值 = 基线校正曲线**最大正曲率**（二阶导数峰）处的荧光值；弱扩增板会自动降级为倍数法；
- 基线窗口优先用文件里声明的 `baselineBeginRepeat/baselineEndRepeat`。

对 2026-08-31 的 96 孔板实测：与 CFX 官方 Cq 平均差 **0.077 个循环**（最大 0.49，96/96 ≤0.5）。

## 许可

继承上游 **GPL-3.0-or-later**。原文件密码不随本仓库分发，程序内置的是 CFX Manager 里那个公开的标准版常量；
仅用于读取自己实验产生的文件。
