# 网页三轴铣床仿真开工实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在独立 cnc-web 工程交付 M1：可嵌入上位网页、可载入任务与模型、保留源行的 G 代码解析和三维刀路回放。
**Architecture:** Vue 3 与 Three.js 显示，Web Worker 独占回放状态，iframe 通过受来源限制的 postMessage 协议收发任务与控制事件。解释器、输入校验、状态机及通信层与视图解耦。
**Tech Stack:** Vue 3.5、Three.js 0.180、TypeScript 5.9、Vite 7、Vitest 3、Playwright。
**Spec:** F:/虚仿项目申报/开发文档/网页版三轴铣床切削仿真软件开发文档.md

## 全项目里程碑

| 里程碑 | 交付内容 | 验收 |
| --- | --- | --- |
| M1 本次开工 | 独立工程、规则毛坯与外部模型显示、G代码解释、XYZ/圆弧刀路、逻辑选刀换刀、Worker回放、iframe联调页 | 单元测试、构建、浏览器端到端 |
| M2 材料去除 | Z向多区间Dexel、刀形包络、脏分块更新和材料快照 | 槽腔截面与体积解析对照、内存与帧率 |
| M3 碰撞闭环 | 扫掠查询、刀柄/刀杆/夹具/剩余材料、首触位置和源行回传、暂停 | 薄障碍穿越、包含、换刀及动态材料时序 |
| M4 交付联调 | 机床轴链与刀补、更多方言、可恢复事件、生产部署配置与使用说明 | 真实模型与程序验收集 |

M1 使用明确命名的 milling-preview-v1 子集，未实现的 G 指令阻止载入。材料去除、连续碰撞和整机运动链均不在 M1 中冒充完成；状态和报告返回 not_checked。M2至M4各自编写详细实施计划，不以阶段1测试替代后续验收。

## Global Constraints

- 内部长度 mm，右手 XYZ；渲染坐标独立转换。
- physicalLine 从1开始，保留空行、注释行与原文；N 段号允许为空和重复。
- T只预选，M6才更新activeTool；逻辑换刀显式披露，无机构动作覆盖。
- 不忽略未知指令或冲突模态，不四舍五入小数G码。
- message必须校验origin、source、channelId、版本和schema；运行修订隔离。
- Worker故障、资源失败与计算取消不得回传成功完成。
- 原有robot-web工程保持独立；不复制密钥或无关申报材料。

## Review Focus

1. 圆弧全圆、R长短弧、增量和英寸必须有独立数值期望。
2. 重复消息、错误来源、旧runId及异步模型加载不能跨任务污染。
3. 无刀运动、非有限数值、未知刀号和资源过大均阻止启动。
4. 暂停/恢复/重置/单步与程序结束后的文本一致；重置更换runId。
5. 模型下载或GPU失败要向使用者解释，不能留下“就绪”的假象。

## 文件和接口

- src/core/types.ts：Job、Instruction、Snapshot和源行定义。
- src/core/gcode.ts：parseProgram(text, tools, initialPosition) -> Instruction[]；pointAt(instruction, ratio) -> Vec3。
- src/core/job.ts：validateJob(unknown) -> Job；预览子集限制和任务资源检查。
- src/core/playback.ts：Playback.load/start/pause/resume/reset/step/advance -> Snapshot。
- src/core/protocol.ts：ProtocolSession.receive(data, origin, sourceMatches) -> Reply；命令关联及去重。
- src/workers/simulation.worker.ts：Worker消息适配和定时推进。
- src/lib/client.ts：主线程Worker客户端，生命周期与旧响应过滤。
- src/lib/embed.ts：上位网页握手、命令和事件适配。
- src/components/Viewport.vue：Three.js场景、刀路、刀具与GLB/STL显示。
- src/App.vue、src/style.css：实验台。
- host.html、src/host.ts：真实iframe联调宿主。
- tests/*.test.ts、e2e/*.spec.ts：行为与浏览器验收。

## Task 1 解释器与输入校验

- [x] 编写源行、T/M6、圆弧数值、单位/增量、未知指令、缺刀、畸形任务测试。
- [x] npm test；确认新功能尚未实现导致失败。
- [x] 实现parseProgram、pointAt和validateJob，支持G0/G1/G2/G3、G17、G20/21、G90/91、G94、G4、G40/49/80、零偏置G54、T/M6、M3/4/5、M7/8/9、M0/1、M2/30。
- [x] npm test；数值断言通过；保存提交。

## Task 2 Worker回放状态

- [x] 编写暂停/恢复、倍率、块单步、换刀事件、重置和程序结束测试。
- [x] npm test；观察缺失状态机导致失败。
- [x] 实现Playback及Worker，固定小时间步推进，不使用渲染帧作为逻辑真值。
- [x] npm test；状态断言通过；保存提交。

## Task 3 上位网页协议

- [x] 编写受信来源、会话、去重、运行版本、异步命令顺序测试。
- [x] npm test；确认协议尚未实现。
- [x] 实现ProtocolSession和embed，允许来源从构建配置给定；ACK只表示接收，JOB_READY表示资源载入完成。
- [x] npm test；验证不可信消息无副作用；保存提交。

## Task 4 实验台与模型加载

- [x] 编写浏览器验收：默认场景可见、运行/暂停/单步、编辑错误源行、GLB/STL、工具切换、资源下载失败。
- [x] npm run test:e2e；确认页面功能不存在。
- [x] 实现Vue实验台、Three.js视窗、Worker客户端和规范化模型导入；用minimialist-ui技能的扁平布局、黑白灰和低饱和状态色。
- [x] npm run build 与 npm run test:e2e；核对桌面及窄屏布局；保存提交。

## Task 5 iframe联调与交付

- [x] 编写真实iframe端到端：HELLO、LOAD_JOB、JOB_READY、START、PROGRESS、RESET、GET_REPORT、重复START及失败任务。
- [x] npm run test:e2e；确认缺少宿主联调页导致失败。
- [x] 实现host.html，日志和任务输入可见，支持代码与模型URL下发。
- [x] npm test、npm run build、npm run test:e2e；独立代码审阅，修复重要问题。
- [x] 更新README、开工日志和任务勾选；启动本地预览并报告地址与边界。

## 实施约定

用户已明确要求“建立开工计划，开工”，因此计划写成后直接执行，不再请求重复批准。工作区不是Git仓库，在全新cnc-web目录建立独立仓库及开发分支，不创建依赖其他项目的worktree。首次版本无既有测试基线。使用npm安装本工程依赖并锁定版本。

