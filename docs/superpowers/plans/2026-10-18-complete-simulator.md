# 三轴仿真完整功能实施计划

> **For agentic workers:** 使用superpowers:dispatching-parallel-agents拆分互不改写同文件的工作域，主代理完成集成；各域遵循TDD，最后独立全量审阅。

**Goal:** 落实总文档第一版及M3/M4的软件功能，以可配置三轴机床贯通碰撞停机、源行回传和可靠联调。
**Architecture:** 保持Worker唯一状态；解释器与运动配置、模型几何、通信持久层分别独立。主代理负责类型集成、连续碰撞、材料时序、页面与验收。
**Tech Stack:** 既有TypeScript / Vue / Three.js / Vitest / Playwright。
**Spec:** docs/superpowers/specs/2026-10-18-complete-simulator-design.md及总开发文档。

## Global Constraints
- 固定Z刀轴、mm、原始物理行；不扩大到原文排除的五轴/宏/力学。
- 不可证明分离的区间返回potential或INDETERMINATE；完成必须标明覆盖。
- 真实硬件、模型与部署域名尚无输入，提供参数化配置、示例和部署文件；不虚构外部验收。
- 保留材料/模型资源上限、错误锁定、代际隔离和来源绑定。

## Review Focus
1. 两端安全的薄障碍、包含及弧段不能漏检；预算不明停止。
2. H表与安装长度、table轴与tool轴变换不能重复或反向补偿。
3. 先切削后检测不能掩盖撞刀；换刀装夹与内部运动都继承M6行。
4. 事件重传、重置与旧快照不能混用eventId/runId。
5. 缺模型、网格异常、未知配置不能静默生成无碰撞结论。

## Task 1 解释器与运动学
文件：core/machineTypes.ts、machine.ts、gcode.ts，tests/machine.test.ts及gcode补充。parseProgram增加可选第四参数ParseOptions；Job集成由主代理完成。
- [x] 先测G53/G54..59、G43/G49/H缺失、英寸、冷却、M6往返/新刀装夹及轴限位解析期望，确认失败。
- [x] 实现上述接口和明确的3平移轴运动变换；保留旧调用兼容。
- [x] 域内测试通过并交接；主代理集成Job、Playback与显示。

## Task 2 网格与实体资源
文件：core/meshTypes.ts、meshGeometry.ts、meshStock.ts、lib/assets.ts、tests/meshGeometry.test.ts。标准PreparedMesh={objectId,role,triangles:Float64Array,closed:boolean, bounds:{min:tuple,max:tuple}}，pose已应用到机床毫米；导出prepareAssetMeshes(group,assets)、validateSolidMesh、initializeMeshStock。
- [x] 先测闭合立方体/空腔、薄夹具、退化/孔洞/自交、旋转单位、Z区间解析真值。
- [x] 实现拓扑/包含、空间索引/查询接口和多区间初始化，资源哈希；预处理失败拒绝。
- [x] 域内测试通过并交接；主代理集成毛坯/碰撞/模型角色。

## Task 3 可靠事件与部署
文件：lib/reliableEvents.ts、core/protocol.ts、lib/embed.ts、tests/reliableEvents.test.ts、deploy/*。不修改App/Host。
- [x] 先测重传同eventId、ACK停止、重载interrupted、旧run隔离、事件持久化与错误记录。
- [x] 实现可注入存储/时钟的可靠事件队列，保留原emit兼容；EVENT_ACK传入执行器；给出静态部署及CSP/来源模板。
- [x] 域内测试通过并交接API供App/Host使用。

## Task 4 连续碰撞与状态集成
文件：core/collisionTypes.ts、convex.ts、collision.ts、types.ts、job.ts、material.ts、stock.ts、playback.ts、workers/*、client.ts、tests/collision*.test.ts。
- [x] 先测平移刀具与薄夹具解析首触/包含、弧中穿、刀杆/刀柄/快移/停转、已切除区域、限位、换刀。
- [x] 实现凸体距离和保守区间搜索、动态材料界、机床部件与对象对、LIMIT/INDETERMINATE/PAUSED_COLLISION，快照序号和报告源信息。
- [x] 域内及原有测试通过；所有倍率/单步共享逻辑；保留错误预算上限。

## Task 5 完整工作台与宿主
文件：App.vue（含报告导出）、Host.vue、Viewport.vue、demo.ts、style.css、e2e/full-simulator.spec.ts。
- [x] 先写真实浏览器碰撞停机/坐标/源行/REPORT同事件/ACK、任务设置和正常双刀用例。
- [x] 碰撞标记与源行、完整任务输入、配置示例、机床动画、可靠事件报告、快照与回看接入。
- [x] 核验网页与iframe全流程、桌面/窄屏及错误恢复。

## Task 6 验收与交付
文件：tools/benchmark-browser.mjs、README、docs/full-progress.md、总文档实现状态。
- [x] 全量单元、构建、真实浏览器测试；补浏览器性能记录、输入哈希及覆盖。
- [x] 独立代码审阅，重要项用失败回归复现并修复，最终全量通过。
- [x] 更新功能覆盖矩阵、参数和限制、运行入口、截图；提交本地development。
