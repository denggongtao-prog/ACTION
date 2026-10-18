# M2 材料去除实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在现有网页中交付多区间Dexel切削变化、三种刀形、材料统计、空运行及重置。
**Architecture:** 纯TypeScript几何内核由Worker独占；Playback提交路径区间至材料内核；16×16脏块网格与快照共同发送给Three.js；iframe只回传统计。
**Tech Stack:** 现有Vue / Three.js / TypeScript / Vitest / Playwright，不增加运行依赖。
**Spec:** docs/superpowers/specs/2026-10-18-material-removal-design.md

## Global Constraints

- 固定Z刀轴，内部mm，规则块料；碰撞verification仍为not_checked。
- 默认格距0.5 mm、弦高0.02 mm；160000单元、32区间/列、1000000端点。
- 单圆弧4096段、程序100000段；原始物理行号保留。
- T预选，M6换刀；G0、主轴停转、方向不符与空运行不去除材料。
- Worker代际、revision/runId及故障锁定保持有效；源代码与资源来自当前独立development分支。

## Review Focus

1. 重复/交叉路径和重置不能重复累计切除体积或遗留旧网格。
2. 低帧率、倍率和源行单步不能漏掉区间扫掠。
3. 有限刃长和球头/钻尖不能当作无限长平底圆柱。
4. 分块邻边、通孔及多实体层必须封闭，网格体积应匹配材料数据。
5. 材料计算超预算或异常必须停止，不能报告完成。

## 文件和接口

- src/core/toolProfile.ts：cuttingTipOffset(tool,radialDistance)，drillTipHeight。
- src/core/stock.ts：DexelStock、subtractIntervals；carveLine、getColumn、stats、takeDirty。
- src/core/stockMesh.ts：meshTile、createStockUpdate；生成可转移typed arrays。
- src/core/material.ts：路径离散、预检和Materials执行；consumeMotion(move,t0,t1)。
- src/core/types.ts / job.ts / gcode.ts：配置、统计和主轴方向。
- src/core/playback.ts：材料生命周期和推进；takeStockUpdate。
- src/workers/simulation.worker.ts / src/lib/client.ts：网格与快照传递。
- src/components/StockSurface.ts / Viewport.vue：动态块替换与释放。
- src/App.vue / style.css / demo.ts：参数、体积、模式及切削示例。
- tests/stock.test.ts / material.test.ts / stockMesh.test.ts / e2e/material.spec.ts：验收。

## Task 1 几何材料内核

- [x] 先写区间差集、平底扫掠体积、球头/钻尖截面、有限刃长及精度/预算测试。
- [x] npm test -- tests/stock.test.ts，观察缺失实现的失败。
- [x] 实现toolProfile、DexelStock及配置校验；带错误边界，不静默降精度。
- [x] 相关测试通过后提交阶段记录。

## Task 2 网格与回放集成

- [x] 先写网格有向体积、多层通孔、邻块脏标记和倍率/单步/重置/主轴/空运行测试。
- [x] 运行相关测试，记录失败。
- [x] 实现块网格、固定源圆弧划分、Playback与Worker的几何增量。
- [x] npm test通过；记录运行及单步均执行同一材料逻辑。

## Task 3 页面与上位网页

- [x] 编写真实浏览器：切削统计增长、暂停不变、重置归零、空运行、iframe报告。
- [x] 执行浏览器测试，确认新界面能力未实现。
- [x] 显示不透明真实加工实体，增加精度与切削模式设置及统计；报告能力更新到0.2.0。
- [x] 保留M1全部回归，检查画面及浏览器控制台。

## Task 4 验收与交付

- [x] npm test、npm run build、npm run test:e2e。
- [x] 独立代码审阅；重要问题补复现测试并一次修复；全量回归。
- [x] 更新README和实施日志，记录实测性能及限制，提交development。
- [x] 保持本地服务可用，给出真实切削画面和使用入口。

## 实施记录

- 基线：工作树干净，M1的48项单元测试通过。
- 用户已授权继续优化，按既有M2路线直接实施，不另行请求重复确认。

