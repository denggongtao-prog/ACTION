# 碰撞提示与连续演示实施计划

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. User explicitly requested completing animation while reporting collisions separately.

**Goal:** 用户案例默认完成动画，碰撞单独提示并回传；保留可选择的碰撞暂停模式。

**Architecture:** 扩展已有 simulation.stopOnCollision 布尔参数，未传时保持旧API暂停行为，案例库显式false。MaterialSimulation在提示模式记录每个Instruction首次碰撞，然后完成该动作的可显示材料计算；后续Instruction继续检查。Playback保存碰撞历史并独立判断执行完成与碰撞结论，Vue逐项回传全部事件，单独显示可定位的提示列表。

**Tech Stack:** 现有Vue、TypeScript、Three、Worker、Vitest、Playwright，不增加依赖。

## 约束与设计

- 碰撞提示模式不是关闭检查。每个Instruction只报告首次接触，同一Instruction后续不重复检查；不能声称穷举同段全部对象对。
- 碰撞后仍完成原刀路的动画与合法切削显示；G0或主轴停转仍不去料，碰撞几何不作力学变形。
- 任一碰撞后verification=collision_detected，COMPLETED只表示动画执行结束，不能恢复为fully_checked。
- 越程、查询无法确定、非法输入和材料资源错误仍停止；用户主动暂停、M0/M1语义保留。
- 原M6仍先检查夹紧；提示模式允许动画换刀完成并同时记录装夹碰撞，暂停模式保持旧行为。
- 原始G代码、SHA、源行、事件ID与ACK保留；一帧多个碰撞必须逐项回传，不能只发最后一条。
- reset清空提示；checkpoint/seek保留已检查前缀的提示与去重集合，不能把已碰撞前缀报告为无碰撞。
- 案例库下发默认提示模式；开发故障样例和未设置参数的外部任务仍默认暂停。

## 实施

- [x] 写失败单元：参数布尔校验、按倍率继续/去重/材料、初始重叠、装夹、checkpoint、异常仍停、O0008完成保留第95行。
- [x] 实现types/job/material/playback/protocol，先通过目标测试，再执行全部单元。
- [x] App增加碰撞处理选择、独立记录列表和手动定位，批量消费incidents；报告区分执行结果，Host继续接收并ACK。
- [x] 真实浏览器验证O0008完整播放、提示存在、暂停模式，以及iframe多事件回传；同步旧测试中明确要暂停的任务配置。
- [x] 一次独立只读审阅，修复有证据的问题；完整测试、构建、截图与文档后本地保存。

## 审阅重点

1. 单次Worker推进穿越多条碰撞指令与M6，全部事件仍能在宿主报告找回。
2. 暂停后的续播、不同倍率和源行单步不改变首次碰撞源行或重复告警。
3. 前缀checkpoint包含碰撞时，seek不能漏记碰撞或重新发旧eventId。
4. G0与无效主轴碰撞只运动不雕料；正常进给仍显示切削。
5. 有碰撞的COMPLETED不能显示fully_checked，异常不得伪造完成。
