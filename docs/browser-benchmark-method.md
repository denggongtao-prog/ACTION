# 浏览器性能与画面记录方法

此脚本使用工程现有 Playwright 驱动本机安装的 Edge，以无头模式访问本机实验台，通过“开发测试”显式载入正常双刀样例后执行；页面、Web Worker、材料与渲染均实际运行。它不会启动开发服务器、修改任务代码、替换 Worker 或向外部域名发布。该固定样例继续使用原参数，页面默认案例调整为O0001不会改变性能测量对象。

先在工程根目录启动 `npm run dev`，待页面集成和构建检查完成后，在另一终端运行：

```powershell
node tools/benchmark-browser.mjs --smoke
node tools/benchmark-browser.mjs
```

`--smoke` 执行同样的真实采样与报告查询，在终端输出摘要和 `metricEvidence`（环境、网格、毛坯、覆盖与可用字段），不写产物。正式命令生成 `docs/browser-benchmark.json`、`docs/screenshots/full-desktop.png`、`docs/screenshots/full-narrow.png`。工程已安装 Edge channel；缺少本机 Edge 时脚本明确失败，不用不同浏览器静默替代。每次创建独立浏览器 context，不读取或改变用户浏览器资料、localStorage 和既往仿真记录。临时 context 内 localStorage 仍实际可用，足以运行持久事件代码。

可通过 `--url http://127.0.0.1:8786/` 调整本机入口；仅允许 localhost、127.0.0.1 或 IPv6 回环地址。`--sample-ms` 默认 2500，允许 2000 至 60000；`--timeout-ms` 默认 90000。`--output` 与 `--screenshots-dir` 相对工程根目录解析。`--help` 不启动浏览器。

## 测量过程与来源

1. 等待页面真实进入“就绪”并显示 canvas，等待字体完成。Vite 编译错误、加载失败或运行故障会导致脚本失败，不生成成功报告。
2. 从页面读取原始程序、模式、请求格距、实际格距、模型数量和可用统计；以 Node SHA-256 记录实际程序指纹。点击“导出报告”下载 READY 时的真实 JSON。
3. 设置倍率 1 并启动。`requestAnimationFrame` 逐帧观察页面状态和倍率，仅相邻两帧都为 RUNNING 且倍率相同的时间差计入该倍率样本，排除初始等待、暂停、结束及倍率切换边界。默认至少等待 2.5 秒，再在仍运行时切至倍率 20，等待正常完成。如果程序提前完成，真实样本数量会较少，不补造样本。
4. 完成后停止采样，再次通过页面下载最终报告。原始初始报告和最终报告均保留在结果文件，覆盖结论直接取报告；未暴露的字段记 `null`。缺少总指令数时仅单独记录页面显示的刀路段数，不把刀路段数冒充总指令数。外部模型三角形数仅采用报告明确提供的 `triangleCount`；若页面明确为零个外部模型则记录零，否则无法取得时记 `null`。
5. 正式运行保存桌面 1440 × 1000 和窄屏 860 × 1000 的全页截图，并记录水平溢出。截图在采样结束后生成，不将截图开销混入运行帧统计。

环境记录包括真实 Edge 版本、用户代理、navigator.platform、hardwareConcurrency、可用 deviceMemory 和 User-Agent Client Hints。Node 的 OS API 提供实际运行主机的系统版本、架构及可见 CPU 型号；不推断物理核心数。通过当前渲染 canvas 获取 WebGL 版本、vendor/renderer 及浏览器允许暴露的 `WEBGL_debug_renderer_info`，扩展不可用时 unmasked 字段为 `null`。无头 Edge 可能报告 ANGLE 或软件渲染器；该字符串仅代表本次 WebGL 实际实现，不声称是独立物理显卡型号或客户机配置。

## 指标解释

- `timing.bySpeed` 保留原始 RAF 时间差及 min、median、p95、p99、max、mean。它们是主窗口 RAF 回调间隔，受到显示调度、主线程、几何工作与系统负载共同影响，不能直接当作 GPU 渲染耗时、独立内核吞吐或稳定 FPS 保证。
- `observedCompletionWallMs` 从自动化点击开始前的单调时钟到观察 COMPLETED，含自动化与页面观察开销；程序执行期间先 1 倍再 20 倍，不能拿它与纯 20 倍或 Node 内核基准直接比较。
- `memory.maxSampledJsHeapBytes` 是 RUNNING 的 RAF 回调中，`performance.memory.usedJSHeapSize` 可见样本的最大值。此非标准浏览器 API 可能不可用或粒度较粗，届时最大值为 `null`。该字段只标为“主窗口 JS 堆最大采样值”，不包含 Worker 堆、浏览器多进程、GPU 或原生缓冲，不代表总应用内存或完整运行峰值。没有用操作系统总内存或 `navigator.deviceMemory` 替代它。
- `deviceMemoryGiB` 只是浏览器粗化的设备容量提示，不是可用内存、进程占用或峰值。
- `coverage` 来自实际最终报告，未配置对象不等于已检查对象。脚本不因运行完成自行写入 `fully_checked`；原始报告中的误差模型、覆盖范围及限制仍须一起阅读。

结果仅代表此工作站、浏览器版本、默认任务与所选格距的这一轮无头测量；不代表有头浏览器、其他机器、复杂客户模型或外部部署已通过性能验收。保留原始样本和程序指纹，重复对比时应固定代码版本、浏览器、模式、格距、任务和倍率阶段，并记录系统负载的变化。
