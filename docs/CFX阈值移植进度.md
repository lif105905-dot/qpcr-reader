# CFX 板级阈值：还差什么

现状（66 块板 / 5277 孔，对照 CFX 导出的 Cq）：

| 配置 | 加权 \|ΔCq\| | 达标 |
|---|---|---|
| `autoThresholdMethod: "cfx"`（当前默认） | 0.546 | 2/74 |
| `curvature` + w=0.35 | 0.533 | 0/74 |
| `curvature` + w=0.50 | 0.664 | 2/74 |
| `curvature` + w=0.65 | 0.865 | 1/74 |

已确认：**只要给出每块板真正的阈值 T\*，误差立刻降到 0.005**。曲线、基线、插值三层已经一致，剩下的全部集中在这一个标量上。

## 已经对上的部分

- `packages/core/src/cfx/peakDetection.ts`：SG(4,5) 0–3 阶导、极值检测、`RefineExtremum` 亚环细化、SPF 单点侧翼预滤（`SPF_RATIO = 0.035`）、`MergePeakArray`（间距 <5、峰高比 <5%、谷深比 <5%）、左右峰界。
- `packages/core/src/cfx/baseline.ts`：`cfxBaselineWindow`（首峰起点、二分收平、`TestSubRegionHorizontal` 平坦度 0.035 / 线性度 0.03、`ScanRight` 0.0085）、`cfxBaselineCorrect`。
- `packages/core/src/cfx/threshold.ts`：扫区 `[previousExtremumBase, peakBaseIndex]`、二阶导最大处、`0.35·x2 + 0.65·x3`、`EvaluateFunction` 取值。
- `packages/core/src/analysis.ts`：`CFX_BASELINE_SKIP = 3`（拟合从第 4 环起）、`baselineRule: "cfx"`。

## 还差的三段（都在 `CalculateAutoBeginEndCyclesThreshold`，反编译源 `/tmp/decomp/019_BioRad.PCR.Analysis.decompiled.cs` 第 4000–4100 行）

1. **`PeakArrayPostProcessor`**（约 4017 行）：`FilterType = 3`、`SetMeanMinMaxThresholdMethod()`、`RunFilter(peaks)` → `arrayList`，然后 `val2 = arrayList[0]`。我们现在直接取「最高的峰」，绕过了这个后处理器。
2. **峰替换分支**（约 4030 行）：`arrayList.Count > 1 && val2.PeakBaseIndex <= 5 && val7.PeakBaseIndex >= num3 − num && CalculateJumpAcrossPeak(y, val7) >= CalculateJumpAcrossPeak(y, val6)` → `val2 = val7`（开头的假峰换掉，基线起点也一起挪）。
3. **取峰规则**（约 4085 行）：`val8` = 第一个 `PeakBaseIndex + num > bl.EndCycle - 1` 的峰；`val8 == null || val2.PeakStartIndex <= 5.0` 时退回 `val2`。

第 3 条单独接上去过一次，分数从 0.494 掉到 **4.68**：因为我们的 `peaks[0]` 还是开头的噪声鼓包，而 CFX 的 `arrayList[0]` 已经被后处理器清过。所以**必须 1、2 一起搬**，单独搬第 3 条是负收益。

## 验证方式

```bash
cd /Users/lijiehui/Documents/qpcr-tool
/usr/local/bin/node tools/score_against_cfx.mjs --method cfx          # 逐板打分，写 /tmp/score.json
/usr/local/bin/node tools/score_against_cfx.mjs --method curvature --weight 0.35
```

门槛：mean ≤ 0.05、max ≤ 0.3、≥95% 的孔 ≤ 0.1。

## 已有的兜底（不依赖算法）

`apps/web/src/lib/solveThreshold.ts` 的 `solveThreshold`：导入 CFX 的 Cq 表（或用 WPS/Excel 里任意一孔的值）即可反解阈值，单孔校准后全板中位 |ΔCq| 0.02。这是日常核对用的准确口径。

## 补充：信号相关项排查（2026-11-12 夜）

### 观察
按信号强度给 66 块板排序，阈值比值（我们 / 原版）随强度翻转：

| 板类 | 阈值比值中位 | 我们的阈值 |
|---|---|---|
| 最强十块（振幅 ≥ 9,700 RFU，T* 1,280–2,650） | **0.54–0.61**（偏低） | 只有原版一半 |
| 弱板（T* 268–370） | **1.2–1.6**（偏高） | 高出 20–60% |

把阈值换算成「该孔幅度的相对高度」：原版**稳定在 15.2%**（p25 11.4%、p75 19.7%，4390 孔），我们强板约 9%、弱板约 25%。

### 已排除的两个候选
1. **导数缩放**（`PeakDetection.InitalizeData`，math.cs:8565）：一阶导 ×1/Δx、二阶 ×1/Δx²、三阶 ×1/Δx³；本数据 Δx = 1，缩放是恒等 → 不是原因。
2. **扫区左界语义**（`CalcWidthScanRegion`，math.cs:9285）：左界 = `ExtremumPoints(peak.PeakExtremumIndex - 1).ExtremumBaseIndex`，即上一个极值点的基准下标——与我们 `previousExtremumBase` 的语义一致。把左界换成峰起点扫描，全量 0.553（与 0.552 同）→ 不是原因。

### 另一个已排除的方向
`HandleShortBaselineCorrection` / `HandleLateRiseCorrection`（分析程序集 6004/6011、6124/6136）看似正是「短基线/晚起峰」的修正，但它们属于**回归法**（`RunHighResRegression` 那条链），阈值法（`CurveAnalysis3.GetThreshold`）不走这里。

### 下一个要查的点
`_ExtremaList` 的构造：`CalculatePeaks`（math.cs:8593 起）在收集极值点时受 `_PeakSelectThreshold` / `_PeakDetectThreshold` 约束，而调用方 `CalculateAutoBeginEndCyclesThreshold` 把两者都设成 0。若我们的 `detectPeaks` 在这份极值表上多/少收了点，`ExtremumBaseIndex` 就会不同，扫区随之偏移——这与「随陡峭度滑动」的现象吻合，是目前最合理的剩余解释。
