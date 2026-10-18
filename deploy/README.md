# 静态部署与嵌入

本目录是可替换域名的部署模板，未向外部发布。需要先确定仿真站点、上位网页和模型站点的真实 HTTPS origin。模板中的 `sim.example.edu`、`teaching.example.edu`、`lms.example.edu`、`models.example.edu` 均为占位域名。

1. 把 `deploy/.env.production.example` 的内容保存为工程根目录 `.env.production.local`，替换 `VITE_PARENT_ORIGINS`。填写精确 origin（协议、主机、可选端口），不含路径、尾斜杠和通配符。Vite 将它编入静态资源，变更后重新构建；不要在此变量放秘密。
2. 在工程根目录执行 `npm ci`、`npm test`、`npm run build`。将 `dist/` 内的所有文件一起上传；包含 `index.html`、`host.html`、`assets/` 和 Worker 资源。不能只复制 HTML。
3. 模板以 `/cnc/` 为发布目录，将 `dist/` 内容部署到 `/srv/cnc-site/cnc/`。调整并安装 `nginx.conf.example`，检查证书路径，执行 `nginx -t` 后再由运维重载服务。
4. 同时把真实父来源写入 nginx 的 `frame-ancestors`；把实际模型 origin 加入 `connect-src`。每处均显式列出；不要使用 `*`、`https:` 或 `unsafe-eval`。CSP 由响应头下发，`frame-ancestors` 不能放在 HTML meta 中。不要另加会阻止跨源嵌入的 `X-Frame-Options: SAMEORIGIN`。

工程的 Vite `base` 已设为 `./`，HTML 与打包后的 Worker 使用相对资源路径，支持根目录或固定子目录发布。入口使用带尾斜杠的 `/cnc/` 或 `/cnc/index.html`；示例联调入口为 `/cnc/host.html`。如果改变构建 `base` 为绝对路径，须使路径与实际发布目录一致并重新构建。这里没有前端路由，nginx 对未知文件返回 404；不能用 index.html 冒充丢失的 JS/Worker。Worker 与脚本需要正确的 JavaScript MIME 类型，nginx 主配置应加载标准 `mime.types`。

## 上位网页示例

建议仿真与上位网页使用不同 origin；sandbox 同源脚本的限制弱于跨源隔离。上位网页自身 CSP 还需在 `frame-src` 显式允许仿真 origin。

```html
<iframe
  id="cnc-simulator"
  src="https://sim.example.edu/cnc/?instanceId=experiment-001"
  title="三轴铣床仿真"
  sandbox="allow-scripts allow-same-origin allow-downloads"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

`allow-scripts` 支持仿真脚本与 Worker，`allow-same-origin` 保留真实 origin、资源请求与站点存储能力，`allow-downloads` 支持用户导出报告。不需要顶层导航、弹窗、摄像头或麦克风权限。模板的 `worker-src 'self'` 允许当前 Vite 打包的同源模块 Worker，无需 SharedArrayBuffer 或跨源隔离头。`connect-src` 的 `blob:` 供用户导入的本地二进制模型及其加载使用；不授权任意 HTTP 模型来源。跨域模型服务器仍需 CORS，公开无凭据资源可显式返回仿真 origin 的 `Access-Control-Allow-Origin`。

双方逐条检查 `event.origin`、`event.source`、协议版本、`channelId` 和运行身份；发送使用精确 `targetOrigin`。父网页生成随机新 `channelId` 后 HELLO 握手。同一 iframe 内不能用另一个通道接管；重建会话应重新加载 iframe。不要信任 URL 参数中的来源名单。

## 关键事件与故障恢复

`COLLISION`、`LIMIT`、`INDETERMINATE`、`ERROR`、`COMPLETED`、`TOOL_CHANGE` 先写入浏览器 localStorage，再发送；每个运行有单调 `eventSeq` 与不可变运行身份。未确认事件每秒重传原始信封，`messageId` 和 `eventId` 均不变。父网页应先持久保存事件、按 `eventId` 去重，再发送：

```js
iframe.contentWindow.postMessage({
  protocol: 'cnc-sim', version: '1.0', type: 'EVENT_ACK',
  messageId: crypto.randomUUID(), channelId: event.channelId,
  jobId: event.jobId, revision: event.revision, runId: event.runId,
  payload: { eventId: event.payload.eventId }
}, 'https://sim.example.edu');
```

RESET 后迟到的 ACK 使用事件原来的运行身份，同一通道仍可确认。旧运行身份的 START 等控制指令继续拒绝。新通道不会接收旧通道队列；重建会话通过 HELLO 的历史摘要、GET_STATE 的 `history`、GET_REPORT 的 `reliableRun` 找回记录。没有当前运行时，GET_REPORT 携带旧记录的完整运行身份即可查询；记录不会恢复仿真或继续切削。

页面重载把未完成运行标为 `interrupted`；保留原状态、源行详情和事件，不会自动报告完成。默认持久记录上限为 32 个运行、2048 个关键事件、4 MiB；仅自动淘汰全部事件已确认的终结历史。仍有未确认事件而存储满时明确报 `EVENT_PERSISTENCE_FAILED`，原记录保留。禁用存储、第三方站点存储被浏览器阻止、配额不足或损坏历史都会显式报告；事件 `delivery.durable:false` 时不能宣称可靠交付。父网页仍需自己的持久记录，浏览器本地缓存不提供后台无人值守保证。

默认存储键按仿真页面路径及URL的 `instanceId` 区分。多个同时运行的 iframe 必须指定稳定且不同的 `?instanceId=...`；页面重载保留该实例名以找回历史。源码集成也可以给 `attachEmbed` 的第三参数传入不同 `key`。浏览器隐私策略或清理站点数据仍可能移除本地记录。生产验收应实测目标浏览器的跨源 iframe localStorage、模型 CORS、Worker、报告导出、重传 ACK 与重载查询。

可使用 `curl -I https://sim.example.edu/cnc/` 检查 CSP/MIME 等响应头，再在真实父来源执行正常双刀、碰撞停机、同事件 REPORT、重复 ACK 与 iframe 重载验收。此模板不代表已在客户域名完成部署或验收。
