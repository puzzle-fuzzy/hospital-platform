# 只读业务不变量审计记录（2026-08-22）

> 本记录只覆盖新项目 `hospital-platform`。旧 Python 项目、旧 API、旧数据库表和旧服务进程均未修改。

## 1. 当前版本与运行边界

- 服务端当前 release：`002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`。
- 小程序运行包来源：`ec26f41f8575871972ac63a8074a9beaec1df55b`，14 个页面入口完整，`dist/` 不含 `*.test.js` 或 `*.spec.js`。
- 新 API：`10.0.0.3:18081`，systemd 状态为 `active`。
- 旧 Python API：`0.0.0.0:8001`，仍在监听，旧 Gunicorn PID 未发生变化。
- Worker：保持 `inactive`，没有因为本轮审计被启动。
- 支付、医保授权、退款、报告 Provider 和 HIS 写回仍保持关闭。

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

- API 患者、预约、门诊费用和请求日志：`71 pass / 0 fail / 249 expects`；
- domain 预约与门诊费用：`7 pass / 0 fail / 15 expects`；
- 众阳预约与门诊费用 adapter：`33 pass / 0 fail / 74 expects`；
- 原生小程序：`197 pass / 0 fail / 1496 expects`；
- 运行包核验：`runtime:verify` 通过，14 个页面脚本齐全，`single-flight.test.js` 不存在于 `dist/`；
- 文档链接审计：441 篇文档无断链；生产基线审计指向 `002acc1b` 和 `ec26f41`。

服务器切换后的低敏日志窗口仍为：`parsedRecords=25`、`parseErrors=0`、`systemdWarningCount=0`、`providerRequestIdCount=0`，只包含基础设施域的健康/鉴权/关闭边界 smoke。当前没有新的真实微信、患者切换、预约历史、爽约或门诊费用业务事件；这表示“证据尚未产生”，不是 Provider 成功或失败。

## 4. 当前开发者工具边界

本轮先发现的旧微信开发者工具窗口标题为 `mp-weixin`，资源树包含旧端 `pagesB`、`stores`、`jsonData` 等目录；它不是新项目
`E:\__Super_Core__\hospital-platform\apps\miniprogram`。随后已通过开发者工具官方 CLI 按新项目根目录打开
`miniprogram` 窗口，资源树确认包含 `dist/` 运行根目录，没有把旧窗口的页面、日志或设备状态计入新项目验收证据。

当前仍必须在新项目窗口普通编译并核对 `project.config.json` 的 `miniprogramRoot=dist/` 和
`build-info.json.sourceRevision`，再进行任何真机业务操作。这样可以避免旧端窗口继续加载旧页面，或把旧增量索引误认为新运行包问题。

## 5. 下一步准入顺序

1. 在微信开发者工具关闭旧真机调试，切换到已打开的 `apps/miniprogram/` 新项目窗口，普通编译并确认 `dist/build-info.json` 来源为 `ec26f41f8575871972ac63a8074a9beaec1df55b`。
2. 以同一二维码取得微信登录、患者目录、显式切换第二位患者的页面截图、HTTP `requestId` 和服务端低敏日志；没有三层配对证据，不标记患者切换完成。
3. 在同一会话中按“预约科室/排班 → 我的挂号 → 爽约 → 门诊费用待缴/已缴”的顺序验收，并核对每个请求的 owner、患者映射、Provider request id 和页面读模型。
4. 只有 Provider 文档、金额边界、幂等、回调、查单和失败恢复契约齐全后，才进入现金支付；医保授权、6202/6301、退款和 HIS 回写最后专项处理。

开发者工具若再次报 `dist/services/single-flight.test.js`，不得复制测试脚本进入运行包；该路径说明工具仍持有旧增量索引，应关闭工具、重新构建、重新导入项目并重新生成二维码。
