# 0.4.2 连续动画与碰撞提示交付记录

用户截图显示O0008在物理行95/N910因RAPID_STOCK暂停，要求优先完成动画、碰撞单独提示。本轮按该要求实现，没有改写原程序、刀具参数或关闭碰撞检查。

## 实现

- Job.simulation.stopOnCollision可选布尔值。外部任务省略时保留旧暂停行为；九案例与独立换刀演示显式false。页面增加“碰撞处理”，应用后恢复初始任务。
- 提示模式逐Instruction检测首次接触，记录后继续该Instruction的原刀路显示与有效切削；后续Instruction重新检查。G0、停转和错误主轴方向仍不去料。同段碰撞后也持续检查软限位，越程/无法确定/资源或材料错误仍停止。
- Playback分离执行完成与碰撞结论：存在提示时可COMPLETED、progress=1，但verification=collision_detected。初始重叠与M6夹紧提示支持；主动暂停、倍率、单步、reset及回看保留。
- 材料检查点保存已告警Instruction，执行检查点保存碰撞前缀和序号；新SEEK运行恢复前缀时换新eventId，原运行事件及ACK不变。
- 页面逐项消费incidents，避免同次更新只发送最后一条。右侧列表单独显示原行与坐标，手动选中同步代码和三维标记，提示不抢运行焦点。COLLISION.response=warn_continue让持久运行记录保持运行态。

## 回归过程

核心新测试先因stopOnCollision=false被拒绝而失败，再实现参数和执行分支。旧首触停机断言继续使用true；九个默认提示任务均完成，原四个风险案例仍保持collision_detected。

软限位回归先补齐测试配置所需rapidMode，再实际观察到“已告警Instruction跳过了后续越程”的失败；抽出findLimits，使同段告警后仍检查限位。前缀回看测试观察到eventId跨运行重复后，改为恢复时重新生成。可靠存储测试先出现warn_continue事件把RUNNING改为PAUSED_COLLISION，修正按response处理后通过。

O0008真实浏览器测试最初因缺碰撞处理选项失败；完成UI后验证提示模式100%、原95行提示和报告、暂停模式仍在95行停机。宿主短程序把4条碰撞放入同次快速更新，验证全部事件、原行、ACK和COMPLETED+collision_detected。

## 一轮独立只读审阅

collision_warning_review从4b6b737之后候选中发现1项Important，无Critical/Minor：碰撞刚检测后若carve抛错，局部warnings没返回，已检测碰撞会丢失。

主代理新增回归，实际观察ERROR快照只剩L1、缺L2；真实iframe也只有1条碰撞而应有2条。现MaterialSimulation在去料前同步通知Playback保留碰撞，Worker的FATAL携带finalSnapshot，Client在锁定故障前交付该错误快照；本动作的碰撞、源行与宿主报告均保留，运行仍正确ERROR/indeterminate。两项回归从失败转为通过。

审阅未评判穷举首次接触后的全部碰撞、力学变形、客户机床标定及同步撰写中的文档。主代理保留相应教学范围和接口限制并补齐文档；修复后由主代理验证，不将候选审查称为最终代码复审，未请求第二轮审阅。

## 验证记录

347项单元通过，生产构建通过。完整浏览器回归期间一次代码空白清理触发Vite重载，宿主iframe从运行中回到等待任务；trace中可见Vite重连，故不按产品逻辑修改断言。固定运行代码后完整24项真实Edge端到端全部通过（51.1秒）。

实际O0008达到100%，最终执行物理行134/M30，保留L95、119、122、123共4条提示，报告collision_detected。1440px及860px截图已查看，无pageerror和水平溢出；[JSON证据](collision-warning-evidence.json)与[capture脚本](../tools/capture-collision-warning.mjs)保留。原暂停矩阵的复现脚本显式选择true，避免与当前默认提示模式混淆。

本地development保存，无推送、合并或外部发布。运行态继续不能作为无碰撞或实机加工许可；当前提示粒度为first_contact_per_instruction。
