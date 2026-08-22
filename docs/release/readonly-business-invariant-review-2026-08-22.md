# 只读业务不变量审计记录（2026-08-22）
> 当前候选更新（2026-08-22 15:31 CST）：服务端 release 为 `1e58bb66`；小程序运行包来源为 `5e43aed0e026cd48d980d58c468223b9a5ee8744`（提交 `5e43aed`）。历史候选仅作追溯。


> 当前完整小程序来源校验值：`5e43aed0e026cd48d980d58c468223b9a5ee8744`；当前服务端 release：`1e58bb66bf24021d2b680eb5fd03abfec467989a`。

> 当前发布基线：服务端 `1e58bb66bf24021d2b680eb5fd03abfec467989a`；小程序运行包来源
> `5e43aed0e026cd48d980d58c468223b9a5ee8744`。本次不把历史 journald 窗口升级为当前业务证据。

> 本记录只覆盖新项目 `hospital-platform`。旧 Python 项目、旧 API、旧数据库表和旧服务进程均未修改。

## 1. 当前版本与运行边界

- 服务端当前已验证 release：`1e58bb66bf24021d2b680eb5fd03abfec467989a`。
- 小程序运行包来源：`5e43aed0e026cd48d980d58c468223b9a5ee8744`，14 个页面入口完整，`dist/` 不含 `*.test.js` 或 `*.spec.js`。
- 新 API：`10.0.0.3:18081`，systemd 状态为 `active`。
- 旧 Python API：`0.0.0.0:8001`，仍在监听，旧 Gunicorn PID 未发生变化。
- Worker：保持 `inactive`，没有因为本轮审计被启动。
- 支付、医保授权、退款、报告 Provider 和 HIS 写回仍保持关闭。

本轮运行包门禁追加了测试脚本与 workspace 裸模块依赖扫描，当前客户端运行来源为
`5e43aed0e026cd48d980d58c468223b9a5ee8744`；真实微信、患者切换和只读业务三层证据仍未产生。

## 2. 业务不变量审计结论

### 2.1 就诊人归属与切换

1. 小程序只保存平台内部 opaque `patientId` 的选择引用，不保存 openid、unionId、卡号原文或 Provider 患者号。
2. 业务页进入预约历史、爽约或门诊费用前，都会完成 `/me`、完整患者目录和当前显式选择的连续确认；患者目录和业务结果必须属于同一会话代际。
3. 当前选择从目录消失、临床映射失效或目录变成歧义空快照时，不会静默切换到第一位患者；页面进入 stale/fail-closed 状态并要求重新选择或刷新。
4. 服务端预约和门诊费用都按 `ownerUserId + patientId + provider=zhongyang + referenceKind=his-patient` 解析临床映射；不会把目录 `thirdPatientId` 当成预约/费用的 HIS `patId`。

### 2.2 预约历史与爽约

1. 当前预约历史固定使用已确认的微信渠道 `requestChannel=3`；“全部挂号”所需的 `requestChannel=4` 仍没有独立 contract，因此页面只保留入口位置并 fail-closed 提示迁移中。
2. “我的挂号”使用中国标准时间前后各 90 天窗口；“爽约”使用过去 90 天窗口。日期由服务端/客户端统一生成，不能由页面随意扩大。
3. 爽约页面只筛选服务端已归一化的 `status=missed`；未知状态、客户端数字状态和空列表都不能被推导为爽约。
4. Provider 返回窗口外记录、重复标识、非法时间或未经确认字段时，整批拒绝，不能过滤坏行后伪装成完整成功。

### 2.3 门诊费用只读

1. 当前只允许 `unpaid`/`paid` 两种状态；未知状态在请求前和服务端 service 层均 fail-closed，不会被旧逻辑误解释为已缴。
2. 查询窗口固定为最近 30 个中国标准时间日；Provider 返回窗口外账单时整批拒绝。
3. 金额统一使用人民币分的安全整数，页面只在展示边界格式化为元；Provider 订单号、医保字段、卡号和支付凭证不进入公共读模型。
4. 列表在小程序侧按 10 条本地分批渲染，但不会把本地分批伪装成 Provider 分页，也不会改变 `total` 或费用事实。
5. 点击费用记录只显示“详情/支付流程迁移中”，不会调用 `wx.requestPayment`，不会修改订单状态。

### 2.4 日志与关联

1. 患者、预约和门诊费用业务链均记录 `requested → loaded/failed`，并保留同一 `traceId` 以及经过 domain 校验的 Provider request id。
2. HTTP 生命周期日志只记录方法、路径、状态、耗时、requestId 和错误类型；不记录 body、Authorization、Provider 原始响应或查询卡号。
3. Pino 序列化层和最终 JSON 输出层都执行递归脱敏；原始报文无法解析时丢弃该行并输出固定的 `log.redaction.failed`，不会放行未脱敏内容。

## 3. 本轮验证证据

本轮定向回归结果：

- 全仓 `pnpm check`：通过；架构、迁移台账、Provider 接收、日志、发布基线、格式、Lint、工具测试、类型检查、测试和构建均通过；
- 工具测试：`53 pass / 0 fail / 133 expects`；
- 原生小程序：`215 pass / 0 fail / 1611 expects`；
- 运行包核验：`runtime:verify` 通过，14 个页面脚本齐全，`single-flight.test.js` 不存在于 `dist/`；
- 文档链接审计：Markdown 文档无断链；发布基线指向服务端 `1e58bb66bf24021d2b680eb5fd03abfec467989a` 和小程序 `5e43aed`。

服务器切换后的低敏日志窗口仍为：`parsedRecords=25`、`parseErrors=0`、`systemdWarningCount=0`、`providerRequestIdCount=0`，只包含基础设施域的健康/鉴权/关闭边界 smoke。当前没有新的真实微信、患者切换、预约历史、爽约或门诊费用业务事件；这表示“证据尚未产生”，不是 Provider 成功或失败。

### 2026-08-22 继续复核

本轮没有把历史 journald 窗口或模拟器页面升级为当前业务证据，只重新验证了当前候选的公开运行边界：

- `GET https://test-hp.meiyi.pro/api/v2/health/live`：`200`；
- `GET https://test-hp.meiyi.pro/api/v2/health/ready`：`200`，`database/redis/schema` 均为 `ok`；
- `GET https://test-hp.meiyi.pro/api/v2/system/ping`：`200`；
- 未携带会话的 `GET /api/v2/me`：`401 unauthorized`；
- `pnpm --filter @hospital/miniprogram test`：`215 pass / 0 fail / 1611 expects`；
- `pnpm release:baseline:audit` 与 `pnpm docs:audit`：均通过，当前来源为服务端 `1e58bb66`、小程序 `5e43aed`。

本轮早先使用无交互方式对 `ps@192.168.112.172` 和 `ps@8.130.127.184` 做只读 SSH 连接时，均因当前环境返回 `Permission denied` 未进入服务器；随后通过已授权的交互式只读连接完成了下面的日志复核。早先失败的连接没有执行任何线上写入、部署或重启。

### 2026-08-22 01:43 CST 服务器业务事件窗口

随后通过已授权的只读 SSH 连接复核了当时生产服务的最近两小时 journald。该历史窗口与当时
`84fac75c` release 对齐，并确认新旧服务仍然共存：新 Bun API 监听 `10.0.0.3:18081`，
旧 Gunicorn 继续监听 `0.0.0.0:8001`。服务端已经产生一组可关联但尚不完整的真实业务证据：

| 业务链 | 服务器低敏日志事实 | 当前结论 |
| --- | --- | --- |
| 微信登录 | `auth.wechat.login.requested=1`、`auth.wechat.login.succeeded=1`；对应 HTTP `POST /api/v1/auth/wechat=200` | 服务端登录兑换成功；仍缺页面和客户端同链证据 |
| 会话恢复 | `GET /api/v1/me=401` 后出现两次 `GET /api/v1/me=200` | 观察到失效会话与后续恢复，不能仅凭日志确认页面最终状态 |
| 患者目录 | `GET /api/v1/patients=200`，并出现 `patient.directory.read.requested → loaded` | 当前窗口读取成功 |
| 患者同步 | `POST /api/v1/patients/sync=200`，出现 `snapshot.committed` 和 `patient.directory.synced`，提交条目数为 1 | 服务端同步成功；仍缺真机页面截图和客户端响应记录 |
| 预约/费用/报告 | 最近两小时未出现对应业务事件或 HTTP 路径 | 尚未开始这些业务域验收 |

日志中的 `/api/v1` 是 Elysia 的内部路由。公网 `https://test-hp.meiyi.pro/api/v2/*` 经 Nginx
精确映射到内部 `/api/v1/*`，因此该路径差异本身不是版本漂移，也不能据此认为小程序绕过了公网 v2。
当前窗口只证明服务端一层；在取得页面结果和客户端 `requestId/traceId` 前，不把微信登录、患者同步或患者切换标记为完整真机验收。

## 4. 当前开发者工具边界

本轮先发现的旧微信开发者工具窗口标题为 `mp-weixin`，资源树包含旧端 `pagesB`、`stores`、`jsonData` 等目录；它不是新项目
`E:\__Super_Core__\hospital-platform\apps\miniprogram`。随后已通过开发者工具官方 CLI 按新项目根目录打开
`miniprogram` 窗口，资源树确认包含 `dist/` 运行根目录，没有把旧窗口的页面、日志或设备状态计入新项目验收证据。

当前仍必须在新项目窗口普通编译并核对 `project.config.json` 的 `miniprogramRoot=dist/` 和
`build-info.json.sourceRevision=5e43aed0e026cd48d980d58c468223b9a5ee8744`，再进行任何真机业务操作。
这样可以避免旧端窗口继续加载旧页面，或把旧增量索引误认为新运行包问题。

## 5. 下一步准入顺序

1. 在微信开发者工具关闭旧真机调试，切换到已打开的 `apps/miniprogram/` 新项目窗口，普通编译并确认 `dist/build-info.json` 来源为 `5e43aed0e026cd48d980d58c468223b9a5ee8744`。
2. 以同一二维码取得微信登录、患者目录、显式切换第二位患者的页面截图、HTTP `requestId` 和服务端低敏日志；没有三层配对证据，不标记患者切换完成。
3. 在同一会话中按“预约科室/排班 → 我的挂号 → 爽约 → 门诊费用待缴/已缴”的顺序验收，并核对每个请求的 owner、患者映射、Provider request id 和页面读模型。
4. 只有 Provider 文档、金额边界、幂等、回调、查单和失败恢复契约齐全后，才进入现金支付；医保授权、6202/6301、退款和 HIS 回写最后专项处理。

开发者工具若再次报 `dist/services/single-flight.test.js`，不得复制测试脚本进入运行包；该路径说明工具仍持有旧增量索引，应关闭工具、重新构建、重新导入项目并重新生成二维码。

