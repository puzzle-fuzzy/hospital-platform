# 当前用户资料与患者上下文审计（2026-08-27）

> 本记录只审计新项目 `E:\__Super_Core__\hospital-platform` 的小程序资料展示、患者目录投影和运行包发布边界。
> 没有修改旧 Python 服务、旧数据库、旧 Redis、线上旧进程或另一会话负责的众阳预约适配器。

## 1. 审计结论

本轮没有发现需要立即修改的用户资料或患者归属缺陷，原因如下：

1. `App.onLaunch` 通过 `ensureGlobalUserProfile()` 启动唯一的全局资料初始化；“我的”页和资料页通过 `waitForGlobalUserProfile()` 消费同一份快照，“我的”页还通过订阅接收昵称、头像和授权状态变化。
2. 微信昵称/头像授权只允许用户明确点击触发，授权回调在写本机缓存、更新全局快照和资料 PUT 前同时校验 owner、会话代际和当前状态，旧账号回调不能回写新账号。
3. `dashboard-service`、患者上下文和各业务页中的 `getCurrentUser()` 不是重复获取展示资料，而是患者目录、预约、报告和费用查询前的 owner 重验证。删除这些调用会把“资料全局共享”错误地扩大成“业务请求可以信任旧快照”，因此保留。
4. 服务端患者响应只投影脱敏展示字段；owner、完整卡号、身份证号和众阳 `patId` 不进入小程序页面。`other` 只在上游明确给出其他关系时展示，缺失或无法识别的关系归为 `unknown`。
5. 旧端三个菜单分组的标题均为“我的订单”，当前小程序的图标、顺序和标题与旧端事实一致，不把重复标题误判为迁移错误。

## 2. 关键不变量

### 2.1 用户资料

- 资料展示来源只有 App 级 `GlobalUserProfileState`，页面不得在 `onShow` 中自行创建 `/me/profile` 请求。
- 普通资料失败可以降级为可重试状态，但不能伪装成登录失效；明确 `401` 或会话代际变化时，必须清理旧资料并回到登录入口。
- 资料页编辑使用服务端 `serverDisplayName` 和 `version`，微信本机昵称只是授权展示增强；PUT 成功后以服务端 canonical 响应回写全局快照。

### 2.2 患者目录

- 患者目录始终按 Bearer principal 的 owner 查询；客户端只保存 opaque `patientId` 作为显式选择。
- 页面打开业务页时仍要读取最新 owner-scoped 目录，并在目录响应后重验 `/me`；这一步是安全边界，不是资料重复加载。
- 首次没有明确选择时，只允许把临床访问状态为 `ready` 的首位患者作为默认值；已有选择失效时进入 `stale` 或 `unavailable`，不能静默切换到其他患者。
- 目录失败、账号切换和页面卸载时，旧患者派生数据必须停止回写；错误不能被降级为空列表。

## 3. 本轮验证

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm migration:readiness` | 通过结构审计 | 入口、只读域和页面事件结构通过；真实 Provider、真机和高风险写入仍按报告保持未完成 |
| `pnpm --filter @hospital/miniprogram runtime:verify:pending` | 通过 | 历史发布前 pending 来源为 `0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，40 页，运行包文件完整；当前 live 候选为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328` |
| `pnpm --filter @hospital/miniprogram build` | 发布阶段曾被 `EBUSY` 阻断 | TypeScript 检查已通过；随后释放项目进程锁并通过 `runtime:publish-pending` 完成原子发布 |
| `runtime:publish-pending` + `runtime:verify` | 通过 | 历史 pending 已清理；当前 live 来源为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`，40 页 |

## 4. 当前运行包锁处理

本轮构建尝试时，Windows 仍观察到标题为 `hospital-platform-runtime - 微信开发者工具` 的主进程 PID `36144` 及其子进程；`apps/miniprogram/dist` 因文件句柄占用无法原子替换。该事实与用户界面是否可见无关，不能通过删除 `dist`、复制测试脚本或强行覆盖来绕过。

本轮实际处理结果：

1. 确认用户没有正在使用的项目会话，并识别出项目主进程 PID `36144` 及其子进程；
2. 只结束该项目进程树，不碰其它微信开发者工具实例；
3. 执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending` 成功；
4. 执行 `pnpm --filter @hospital/miniprogram runtime:verify` 成功，确认 40 页和来源指纹完整。

锁释放前 live `dist` 保持原样；锁释放后只通过原子发布器切换，未删除、手工复制或半套覆盖运行包。

## 5. 未完成项与下一步

- 九个真机证据域仍为 `pending`，需要同一小程序来源下的页面、客户端 `requestId`、公网 HTTP、服务端 Pino `traceId` 和 Provider 低敏请求号闭环。
- 健康百科等待正式审核 bundle；临床、患者写入、外部会话、协议同意/撤回/审计仍等待各自 contract。
- 预约写入、门诊支付、医保授权/结算、退款和 HIS 回写继续最后处理，不因本轮资料/患者审计通过而开放。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
