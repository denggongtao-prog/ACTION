# 网页三轴铣床仿真实验室

版本0.4.2。浏览器独立执行切削、连续路径碰撞、配置机床运动、换刀及源行回传。已接入用户案例库全部9份原程序、8份STL成品参考与图纸，并扩展刀具半径补偿、极坐标、钻孔循环和固定侧头。支持受仿真时间控制的换刀动画，以及按真实刀具毫米尺寸计算的伞形刀库。Vue / Three.js显示，Worker独占几何与执行状态，上位网页通过iframe下发完整任务。

案例库默认“提示并继续动画”：碰撞记录保留坐标、源行、对象和回传，动画执行至结束；有碰撞时结论仍为collision_detected。可在“碰撞处理”选择“碰撞即暂停”后应用设置。[碰撞提示模式、边界与验证](docs/collision-warning.md)。

顶部“案例库”是主要入口，独立打开时默认载入O0001；“换刀演示”可直接载入双刀动画，其他10种功能验证样例收在默认折叠的“开发测试”中。上位网页嵌入时继续等待宿主下发任务。

换刀预览：点击“换刀演示”，就绪后开始；也可运行原案例 M6。支持暂停、恢复、倍率和重置。刀具/刀柄不缩放，刀套与工位间距随任务尺寸计算，默认8工位。4秒交换周期及机构为教学示意，只有配置的XYZ路径和新刀装夹进入碰撞检查。[结构参考、尺寸规则和接口](docs/tool-exchange.md)。

## 运行

Windows双击`启动机床实验室.cmd`；首次需要Node.js22.12+。或执行：

```powershell
npm ci
npm run dev
```

- [实验工作台](http://127.0.0.1:8786/)
- [上位网页联调](http://127.0.0.1:8786/host.html)
- [上位机通讯接口手册](docs/上位机通讯接口手册.md)：iframe 接入、完整字段、碰撞源行与坐标、ACK/重试、部署；附[可运行接入示例](http://127.0.0.1:8786/examples/host-integration/index.html)。

本地仅绑定回环地址。当前实测Node24.14.1及Edge；依赖由package-lock.json锁定。代码位于独立development分支，与robot-web无依赖。

## 已交付

| 功能 | 行为 |
| --- | --- |
| 材料去除 | 规则块料、闭合GLB/STL毛坯、多区间Z Dexel、平底/球头/钻头/显式剖面成形刀、固定Y侧钻、实体分块及体积统计 |
| G代码 | XYZ/XY圆弧/螺旋、单位/增量、G53、G54..59、独立H/D表、G41/42/40、G43/49、G92、G15/16、G81/80/98/99、G28/30、冷却、可选停 |
| 换刀 | T预选，M6停主轴；逻辑装夹或配置XYZ进站/返回轨迹，装夹瞬间新几何检查 |
| 机床 | 正交XYZ平移，轴方向、tool/table运动链和父轴、两种快移、部件随动、软限位 |
| 路径检查 | 刀刃/刀杆/刀柄与夹具/机床，非法材料接触，显式机床部件对及机床与剩余材料 |
| 停机与定位 | 首触区间、障碍物见证点、法向、机床/工件坐标、原始物理行/N号/原文/SHA |
| 网页接入 | 来源/父窗口/会话校验、去重、修订和运行隔离、ACK重传、持久事件与中断历史 |
| 回看与交付 | 稀疏材料检查点向前重放、完整JSON任务配置、报告、10种教学场景、部署模板和性能脚本 |

本项目支持固定Z刀轴及固定-Y侧头的三轴平移加工。五轴、控制器宏/子程序、G81以外固定循环、力学、断刀预测、完整刀库机械手动作与STEP解析仍不支持。实际机床模型、行程、H/D表和换刀轨迹由接入方配置；教学配置不代表真实机床标定结果。

## 用户案例库

工作台“案例库→载入案例”与上位网页“联调案例→下发案例”使用同一完整任务。九份原txt没有改写，循环子动作、刀补转角、参考点运动都继承原物理行。每例可展开“参数与原始资料”查看来源、冲突、假设及图纸链接，完整JSON可修改所有补充参数。成品STL以半透明线框参考显示，不作为初始未加工毛坯。

依据用户确认，O0008优先采用CAM原程序与图纸。缺失的R10成形刀剖面采用明确标注的教学参数，不能据此认证原刀具或目标形状。O0022孔径、O0315的D值等原资料冲突也已保留。逐例配置和实际停机结果见[案例适配说明](docs/case-library.md)，原始证据见[资料审计](docs/case-source-audit.md)。

## 操作

1. 独立工作台默认载入案例库O0001；顶部选择其他真实案例后“载入案例”。开始、暂停、继续、单步、倍率、重置均由真实Worker执行；单步以原始源程序块为单位。
2. 编辑或导入UTF-8 G代码后点击“应用程序”。保留BOM及CR/LF用于原文摘要，错误提示物理行；修改未应用时禁止启动。
3. “换刀演示”独立载入动画；展开“开发测试”后，才显示正常双刀、G0撞料、停转进给、薄夹具、刀柄、高风险换刀、软限位、机床部件、网格毛坯、偏置/H补偿等样例及“载入场景”。
4. “任务配置”可编辑完整Job JSON，包含机床、H表、工件偏置、资源角色与精度。二进制模型以`{$arrayBuffer:"base64内容"}`保存，模型也可使用绝对HTTP(S) URL。
5. GLB/STL导入可选择目标显示、夹具、闭合毛坯或机床部件。机床模型必须配轴链；目标零件只显示，不默认充当障碍。
6. 修改格距、模式或碰撞检查后“应用设置”，材料恢复初始状态。关闭碰撞检查的报告为not_checked，不能形成已检查结论。
7. 案例库默认碰撞仅提示并继续；侧栏保留记录，点击可定位原行与接触点。选择“碰撞即暂停”后应用设置可恢复原停机行为。越程、无法确定与计算故障仍停止；修改处理方式后会恢复初始材料。
8. “回看到源行”使用材料检查点与向前重放重新演算，创建新runId；不会对切削布尔作倒放。
9. 导出报告含输入摘要、材料、覆盖、碰撞同一eventId及可靠事件状态；历史显示未完成运行的interrupted记录。

## 材料、碰撞与误差

平底刀为有限刃长圆柱，球头为对应球面包络，钻头为118°钻尖。profile_endmill按显式分段径向剖面切削；其碰撞凸包命中标potential/unknown，不能冒充非凸刀形精确接触。剖面切削支持等Z的XY运动及纯Z进给，混合斜向进给明确拒绝。固定-Y侧头支持轴向Y钻削及真实刃/杆/柄方向；非轴向侧切明确拒绝。G1/G2/G3且主轴转速有效、方向符合刀具requiredSpindleDirection时允许刀刃切削；G0、停转或方向错误进入材料均记录碰撞，提示模式继续运动但不去料，暂停模式停机。刀杆/刀柄参与检查。仅关闭材料去除的dry_run仍可以检查非法接触。

提示模式每个Instruction记录首次接触，此后该Instruction继续显示原刀路与有效切削，后续Instruction重新检查；不枚举同段其他全部接触。软限位始终检查。报告coverage.warningScope=first_contact_per_instruction；有提示的完成状态不表示无碰撞、可安全加工或碰撞后的物理成品预测。

材料每个XY单元保存多个Z实体区间；闭合网格沿Z求交初始化，另保留覆盖整个单元的保守材料界。按小区间先检查、再去料；已加工区域的查询随材料更新。相同刀具在已清除刃部包络内的竖直退刀使用解析包含证明；不会因此屏蔽夹具及非切削部分。

路径使用距离分离下界和位移上界证明整个区间安全，疑似区间递归细化；圆弧检查真实弧段。不是仅检测端点或渲染帧。静态确认接触返回confirmed_collision；薄表面或保守材料代理命中返回potential_collision；查询预算耗尽返回INDETERMINATE。

contact.point为障碍物见证点，不能当作刀尖。stock_cell表示材料单元代理；去除后的保守材料无法证明实际点误差时返回positionErrorBoundMm="unknown"。initial_overlap表示开始检查时已经重叠，lastSafeVerified=false。一般路径定位区间不超过配置的0.05mm，模型/代理误差另计。

只有完成全部已声明对象对和全部路径才fully_checked。报告coverage列出实际模型和对象对；没有加载机床部件时，只检查刀具、材料和已加载夹具，不宣称整机无碰撞。

资源默认：格距0.5mm，接口0.1..5mm；160000单元、32区间/列、1000000端点、240万表面顶点、25万顶点/块；圆弧4096段、材料程序100000源段。碰撞网格单对象上限200000三角面，自交/查询均有限预算。资产单个32MB、总64MB、显示总面数100万。超限明确拒绝，不静默降精度。512MB为默认资源分配估算预算，不是浏览器全进程峰值内存保证。

## 坐标和方言

dialectId=milling-basic-v1；旧milling-preview-v1输入继续兼容既有指令。支持G0/G1/G2/G3、G17、G20/21、G90/91、G94、G4 P或X秒、G40/41/42 D、G43 H/G49、G53、G54..59、G92、G15/16、G81/80/G98/99、G28/30、T/M6、M3/4/5、S/F、M7/8/9、M0/1、M2/30。M1由optionalStop控制；结束后不执行后文。未知字段、G18/19、G90.1/91.1、宏、其他固定循环等明确拒绝。

G41/G42按D半径表对XY直线和圆弧作刀心偏置，凹角修剪求交、凸角增加圆弧；进入需不短于半径的XY直线，G40首个XY引出取消。D不是刀号，也不是直径。G16目前仅G90，X半径/Y角度；G15恢复直角坐标。G81按当前固定刀轴展开定位/R面/进给/退刀，默认G98；G0/G1/G2/G3/G28/G30取消循环。G28/G30必须显式配置参考轴点，不当作工作原点；G92设读数不移动。

I/J相对起点，R正为小弧、负为大弧；I/J支持全圆。圆弧起终点半径必须在数值容差max(1e-9mm, 半径×1e-10)内一致，不接受端点跳变；后处理有舍入偏差时应重新求圆心或输出线段。arcChordToleranceMm控制材料显示逼近，不用于放宽G代码半径一致性。快移按machineProfile的linear或axis_sequential规则，默认6000mm/min；无控制器加减速、精确节拍承诺。

内部长度mm，固定右手XYZ。工件偏置为G54..59平移。内部Motion以工作台零位参考框架表示刀尖；机床table运动后对外物理M点加真实工作台平移，工件点扣除源指令偏置。

本项目方言明确规定：G43绝对Z时刀尖Z=程序Z+工件偏置Z+G92偏移Z+H+toolLengthReferenceMm-当前安装量规长度；增量轴字按实际位移解释。G49/无补偿时程序Z加偏置直接表示刀尖；G53直接指定实际轴坐标。H不自动等于T，M6不自动G43。toolLengthReferenceMm默认0；O0008用100加截图相对H表。侧头H仍为安装Z量规补偿，几何轴方向单独配置。不同实际控制器需用自身后处理验收，不能直接将本方言当作厂商控制器认证。

## Job字段

以src/core/types.ts、src/lib/scenarios.ts和页面导出的完整JSON为准：

- program：programId、text，可选encoding=utf-8及sha256；实际摘要按精确UTF-8文本计算。
- stock：objectId、kind=box或mesh；sizeMm、minCornerInW在G54中。mesh引用assetId，加载后由闭合网格真实包围盒确定尺寸。
- tools：toolId/toolNumber、type、diameterMm、cuttingLengthMm、gaugeLengthMm、shaftDiameterMm、holder、requiredSpindleDirection。
- assets：objectId、role=stock/fixture/machine/target、format=glb/stl、unit=mm/m、url或ArrayBuffer、poseInM。可选sha256锁定源字节；GLB可用nodes映射nodeName/objectId/role，祖先角色继承，未知/歧义节点拒绝。
- workOffsetsMm：G54..59到XYZ向量的映射，输入可用数组或{x,y,z}。默认G54零偏置，未配置工件系引用报错。
- toolLengthOffsetsMm：H编号到毫米长度映射；G43必须有已配置H。
- toolLengthReferenceMm：0..600mm参考量规，默认0；相对H表可含负差值。
- cutterRadiusOffsetsMm：D编号到半径毫米的映射，G41/G42需已配置表项。D0亦须显式配置。
- tools.axisDirection：刀尖指向刀柄的固定方向，默认+Z；侧头用{x:0,y:-1,z:0}，钻进沿+Y。profile_endmill.radialProfile为{zMm,radiusMm}点列，高度从0至刃长严格递增、半径不减、最大半径匹配刀径。
- initialPositionMm：参考框架刀尖XYZ；也可提供initialAxisPositionMm，按机床和安装长度换算。两者同时提供时必须一致。
- machineProfile：axes.x/y/z各包含direction=1/-1、carrier=tool/table、zeroMm、minMm/maxMm及可选parent；rapidRateMmMin、rapidMode、rapidAxisOrder；components每个部件objectId/drivenBy；collisionPairs精确对象对，collisionExclusions可按精确对象对/阶段排除安装接触。
- machineProfile.toolChange：mode=logical或configured；configured必须有实际轴坐标waypointsMm，returnToStart默认true。无机械手模型不声明其覆盖。
- machineProfileId：可选内置vmc-xyz-demo-v1教学配置；其他ID须同时下发完整profile。
- simulation：stockCellMm、arcChordToleranceMm、mode=cut/dry_run、checkCollisions、contactLocalizationMm≤0.05、maxCollisionQueries、maxMemoryMb。stopOnCollision为布尔值；省略默认true，false表示碰撞提示并继续。案例库任务显式false，开发故障样例保留暂停模式。

## iframe协议

iframe URL可指定`?instanceId=稳定且唯一的实例名`区分持久记录。跨源构建设置VITE_PARENT_ORIGINS为逗号分隔的精确来源。模型URL另需CORS；通信可用不代表资源可下载。

```typescript
const origin = 'https://sim.example.edu';
const frame = document.querySelector<HTMLIFrameElement>('#cnc-frame')!;
const channelId = crypto.randomUUID();
let context = { jobId: 'experiment-001', revision: 1, runId: crypto.randomUUID() };
const pending = new Map<string, string>();
function send(type: string, payload = {}) {
  const messageId = crypto.randomUUID();
  pending.set(messageId, type);
  frame.contentWindow!.postMessage({ protocol: 'cnc-sim', version: '1.0',
    type, messageId, channelId, ...context, payload }, origin);
}
window.addEventListener('message', async event => {
  if (event.origin !== origin || event.source !== frame.contentWindow) return;
  const m = event.data;
  if (m?.protocol !== 'cnc-sim' || m.version !== '1.0' || m.channelId !== channelId) return;
  const command = m.replyTo ? pending.get(m.replyTo) : undefined;
  if (m.replyTo) pending.delete(m.replyTo);
  if (m.type === 'SIM_READY') { /* send('LOAD_JOB', job); */ }
  if (m.type === 'JOB_READY') send('START');
  if (m.type === 'STATE' && ['RESET','SEEK_LINE'].includes(command ?? '') && m.runId)
    context = {jobId:m.jobId, revision:m.revision, runId:m.runId};
  if (m.payload?.eventId) {
    // 先在上位网页持久保存并按eventId去重，再用事件原身份ACK。
    await persistEvent(m);
    frame.contentWindow!.postMessage({protocol:'cnc-sim', version:'1.0', type:'EVENT_ACK',
      messageId:crypto.randomUUID(), channelId, jobId:m.jobId, revision:m.revision,
      runId:m.runId, payload:{eventId:m.payload.eventId}}, origin);
  }
});
frame.addEventListener('load', () => send('HELLO'));
```

命令：LOAD_JOB、START、PAUSE、RESUME、STEP、RESET、SET_SPEED({speed})、SEEK_LINE({physicalLine})、GET_STATE、GET_REPORT、EVENT_ACK、PING。运行中拒绝LOAD_JOB和回看，普通PAUSED才可RESUME。RESET/回看生成新runId并返回STATE。新LOAD递增revision；重传命令复用messageId，同ID异内容拒绝。

COLLISION/LIMIT/INDETERMINATE/ERROR/TOOL_CHANGE/COMPLETED先持久化再发送；未ACK每秒重发原信封。事件含源行、程序摘要、坐标、对象、运行身份和eventSeq。碰撞事件response=warn_continue表示继续动画，pause表示暂停；COMPLETED只表示执行结束，宿主须同时读取verification与collisions。LIMIT.contact=null；ACK不代表允许恢复暂停模式的碰撞运行。队列默认32运行/2048事件/4MiB，存储故障明确delivery.durable=false和错误，不冒充可靠交付。

页面重载把未完成运行标为interrupted；上位网页重新握手，通过历史摘要和REPORT查询同一eventId。不会自动恢复切削。多个同源实例必须使用不同instanceId，浏览器存储仍受隐私策略和用户清理影响。

## 验证和部署

```powershell
npm test
npm run build
npm run test:e2e
node tools/benchmark-material.mjs
node tools/benchmark-browser.mjs
node tools/verify-acceptance.mjs
node tools/verify-case-library.mjs
node tools/smoke-case-browser.mjs
```

Edge测试使用本机msedge；其他环境需安装相应浏览器并调整playwright.config.ts。浏览器基准区分RAF、主窗口采样JS堆和不可测的全进程/Worker/GPU峰值，见[测量方法](docs/browser-benchmark-method.md)。不以Node耗时替代浏览器FPS。

生产静态部署、CSP、iframe来源、MIME、CORS及事件恢复见[部署说明](deploy/README.md)。客户域名发布、真实机床校准和外部CAMotics对照需要相应环境/输入；本地软件验收不代替这些外部验收。

0.3基础版验收为222项单元、16项Edge端到端。0.4案例扩展的最终数量和逐例执行结果见[案例适配说明](docs/case-library.md)。基础功能及外部待验事项见[功能覆盖矩阵](docs/feature-coverage.md)。

[全功能实施计划](docs/superpowers/plans/2026-10-18-complete-simulator.md) · [完整实施与验收记录](docs/full-progress.md) · [初始开工计划](docs/superpowers/plans/2026-10-18-cnc-kickoff.md) · [总开发文档](../开发文档/网页版三轴铣床切削仿真软件开发文档.md)

## 开源使用

解释器、材料、碰撞及协议为本项目实现；Vue、Three.js、Phosphor Icons依赖版本和许可证随npm包保留。CAMotics及其他CNC项目用于调研，不包含其GPL源代码。算法与方言公开参考见总开发文档；后续引入外部源码须另外登记提交和许可证。
