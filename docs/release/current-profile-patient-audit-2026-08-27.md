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
| `pnpm --filter @hospital/miniprogram runtime:verify:pending` | 通过 | pending 来源为 `0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，40 页，运行包文件完整 |
| `pnpm --filter @hospital/miniprogram build` | 发布阶段被 `EBUSY` 阻断 | TypeScript 检查已通过；微信开发者工具仍占用 live `dist`，构建器已保留完整 pending 候选 |
| live 与 pending 来源 | 一致 | live 与 pending 均为 `0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，没有半套运行包 |

## 4. 当前运行包锁处理

本轮构建尝试时，Windows 仍观察到标题为 `hospital-platform-runtime - 微信开发者工具` 的主进程 PID `36144` 及其子进程；`apps/miniprogram/dist` 因文件句柄占用无法原子替换。该事实与用户界面是否可见无关，不能通过删除 `dist`、复制测试脚本或强行覆盖来绕过。

正确处理顺序：

1. 完全退出当前小程序项目窗口和真机调试会话；
2. 确认 `wechatdevtools.exe` 不再持有本项目运行包；
3. 执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`；
4. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，然后再从当前 `dist` 普通编译和生成二维码。

在锁释放前，live `dist` 保持原样，pending 候选可以继续用于只读校验，但不能写成已完成的真机发布证据。

## 5. 未完成项与下一步

- 九个真机证据域仍为 `pending`，需要同一小程序来源下的页面、客户端 `requestId`、公网 HTTP、服务端 Pino `traceId` 和 Provider 低敏请求号闭环。
- 健康百科等待正式审核 bundle；临床、患者写入、外部会话、协议同意/撤回/审计仍等待各自 contract。
- 预约写入、门诊支付、医保授权/结算、退款和 HIS 回写继续最后处理，不因本轮资料/患者审计通过而开放。
