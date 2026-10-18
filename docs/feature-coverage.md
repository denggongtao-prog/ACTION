# 第一版功能覆盖与验收

0.4.0更新：用户九案例已补充半径补偿、G81、极坐标、G92/参考点、固定侧头及显式成形刀剖面，见[案例适配说明](case-library.md)。本页保留0.3基础版验收；当前边界以README和案例说明为准。

版本0.3.0，2026-10-18。总开发文档第一版的软件功能已完成；本表区分本地实现证据和需要客户环境的外部验收，不将教学机床当作客户设备。

## 功能交付

| 规划功能 | 已实现行为 | 主要证据 |
| --- | --- | --- |
| 网页嵌入及任务下发 | iframe/postMessage、来源/窗口/会话校验、完整JSON和二进制模型、修订及runId隔离 | protocol、taskJson、client测试；embed端到端 |
| 模型与角色 | GLB/STL、毫米/米、安装姿态、混合GLB节点角色、SHA、拓扑/自交/闭合校验 | assets、meshGeometry测试 |
| 毛坯与切削 | 块料/闭合网格多区间Z Dexel，平底/球头/118°钻头，有限刃长，增量网格与体积 | stock、meshStock、stockMesh、material测试 |
| 解释器和坐标 | 原物理行/N/原文摘要，单位/增量/XY圆弧螺旋，G53/G54..59/G43/G49，独立H表及冷却 | gcode、gcode-machine、fullJob测试 |
| 机床与换刀 | XYZ方向/tool/table/父轴、部件随动、线性或顺轴快移、限位；T预选、M6配置轨迹及新刀装夹 | machine、execution、collisionMachine、scenarios测试 |
| 碰撞与覆盖 | 连续区间距离界、薄夹具/实体包含/真圆弧、刀杆刀柄、非法材料接触、动态余料、显式部件对 | convex、collision、collision-playback、review-regressions测试 |
| 碰撞回传 | 停机锁定、物体见证点/法向/坐标/源行/误差标签；LIMIT无伪接触点，预算不明INDETERMINATE | full-simulator端到端、scenarios测试 |
| 可靠事件 | 先保存后发送、同eventId重传/ACK、旧run隔离、重载interrupted、报告查询 | reliableEvents、protocol、client测试；宿主真实ACK |
| 操作与回看 | 开始/暂停/单步/倍率/重置，换刀暂停恢复；材料检查点前向重放，历史及同事件报告 | execution测试；workbench/material端到端 |
| 交付 | 10场景、JSON编辑、部署/CSP/iframe配置、实际浏览器与解析验收脚本 | README、deploy目录及本表链接 |

## 原规划14项样例

| 样例 | 本地验收证据与范围 |
| --- | --- |
| 1 规则开槽体积与细化 | stock.test独立腰圆解析式；acceptance-evidence.json记录0.5/0.25/0.1mm格距。理论105.132741mm³，测得106/106/105.28mm³；最细相对误差0.1401%，并检查独立边界带误差界。离散误差不承诺每一步严格单调。 |
| 2 刀形截面 | stock.test分别核验平底、球面和118°钻尖的解析下包络及截面；convex.test核验碰撞几何差异。 |
| 3 预选/双刀/材料保持 | gcode、playback、material测试及真实workbench端到端，默认双刀正常完成。 |
| 4 坐标/H/单位 | machine、gcode-machine、fullJob测试；真实网页offsets场景完成。G49采用README明确的项目刀尖模式。 |
| 5 源文件定位 | gcode/protocol测试及含空行、N号的碰撞测试；真实宿主定位原行，报告同eventId。 |
| 6 非法接触分类 | collision、material、scenarios覆盖刀刃/杆/柄、夹具、G0、停转、错误方向与正常切削。 |
| 7 薄夹具中穿 | collision.test两端无碰仍检出；acceptance-evidence.json用实际STL覆盖0.25/1/20倍及源行单步，均停机且定位界≤0.05mm。 |
| 8 包含/相切/阈值 | convex、meshGeometry、collisionMachine核验完全包含/相切；collision.test核验0.001mm正间隙可证明分离。 |
| 9 动态材料时序 | material、collisionMachine、review-regressions核验余料及独立保守材料；圆弧内弯残料不能被弦线误删除。 |
| 10 换刀内部运动 | scenarios的配置M6轨迹命中夹具，源行归属M6；execution核验暂停/恢复；装夹事件回传configured_tool_change。 |
| 11 重传/重载/旧包 | protocol、reliableEvents、client测试及真实iframe；重复事件需上位网页先保存再ACK。 |
| 12 坏输入/预算 | assets/meshGeometry/job/gcode/stock/material测试；真实Worker预算故障锁定，禁止后续完成。 |
| 13 独立真值及外部对照 | 凸体距离、接触、开槽、球面/钻尖、网格体积均有解析真值。CAMotics共同子集材料对照尚未执行，不能虚构为通过。 |
| 14 上位网页联调 | full-simulator真实Edge验证对象、坐标、原行、同事件REPORT及ACK；dist生产包另经相同关键链路冒烟。 |

## 最终验证

- `npm test`：23文件、222项通过。
- `npm run build`：TypeScript及Vite生产构建通过；Three.js所在主包约714kB，构建仍有500kB体积提示，不影响运行。
- `npm run test:e2e`：16项真实Edge端到端全部通过。
- `node tools/verify-acceptance.mjs`：[解析及薄夹具原始证据](acceptance-evidence.json)。
- `node tools/benchmark-browser.mjs`：[真实浏览器原始样本](browser-benchmark.json)与[测量方法](browser-benchmark-method.md)。本机Edge155.0.4283.60、Core Ultra7 265K，默认0.5mm、200×160单元，无外部资产。1倍和20倍RAF间隔P95均16.8ms，主窗口JS堆最大采样58,582,358字节；不含Worker/GPU/进程峰值。正常切除7670.611mm³，覆盖仅包含报告列出的配置对象对。
- [生产包冒烟](production-smoke.json)：dist经Vite preview实际运行，正常双刀、打包Worker、iframe加载及碰撞/原行/ACK报告均通过，无页面或HTTP错误。此项不是客户nginx/CSP部署验收。
- 画面已实际查看：[桌面](screenshots/full-desktop.png)、[860px窄屏](screenshots/full-narrow.png)、[生产包上位网页碰撞](screenshots/full-host-collision.png)。桌面及窄屏均无水平溢出。

独立审阅发现的2项Critical、1项Important已按失败回归修复；另修正1项换刀能力标识。具体复现和处理见[完整记录](full-progress.md)。这是实现审阅与样例测试，不是所有输入上的形式化证明。

生产包冒烟可复现：先`npm run build`，另开终端运行`npm run preview -- --port 8787 --strictPort`，再执行`node tools/smoke-production.mjs`。脚本仅访问本机8787，生成生产包记录与宿主碰撞截图；默认8786开发入口继续独立运行。

## 外部验收和原范围边界

需要客户提供真实模型、机床轴方向/行程/组件对应、刀表/H表、换刀站点与实际后处理程序，才能完成该设备标定及已知碰撞集验收。客户域名的CSP/CORS/iframe存储策略与部署需要目标环境；当前交付静态构建和配置模板。CAMotics外部对照仍需安装/共同子集样例和单独结果记录。

固定Z刀轴、正交三平移轴；五轴、控制器宏/子程序/固定循环、STEP解析、力学/断刀、完整刀库机械手仍为原范围排除项。圆弧半径不连续、无法可靠预处理的模型和超预算任务明确拒绝；去除后的材料代理命中可为potential，误差无界时为unknown。未加载或未声明的机床对象不在fully_checked覆盖内。
