# 1a8a898 生产切换与共存验收记录（2026-08-18）

本文记录 `1a8a898` 候选版本在阿里云中转服务器上的真实部署证据。本文只记录已经观察到的运行时事实；微信真机业务、众阳预约业务和门诊费用业务没有被 readiness 结果代替。

## 1. 发布范围

- 代码版本：`1a8a898`
- 运行时：Bun + Elysia，`environment=production`
- 新 API：`10.0.0.3:18081`
- 旧 Python API：`0.0.0.0:8001`
- systemd：`hospital-platform-api-v2.service`
- 当前 release：`/home/ps/code/hospital-platform/releases/1a8a898`
- Worker：未启动；本次只切换 API，不改变异步任务运行状态
- 数据库迁移：未执行；本次只读使用已存在的 schema
- 支付、医保、报告：继续保持关闭或未配置，不因本次发布被意外打开

## 2. 切换前证据

本地 `pnpm check` 已通过，包含架构规则、Biome、文档审计、类型检查、测试和构建。候选包上传服务器后，对 API、Worker 及验收脚本逐一执行 SHA-256 校验，服务器文件与本地构建产物一致。

候选进程曾以独立端口 `127.0.0.1:18082` 启动，使用服务器真实生产环境文件完成 preflight 和 runtime smoke：

- 生产环境配置识别为 `production`
- MySQL：`ok`
- Redis：`ok`
- schema：`ok`，已验证迁移 `0016_patient_directory_sync_owner_index`
- 微信身份配置：`configured`
- 患者目录、预约目录、预约记录、门诊费用查询：`configured`
- 微信支付、报告目录：保持 `disabled`
- `/health/live`、连续 3 次 `/health/ready`、`/system/ping`：通过
- 未登录认证边界：返回 `401`

隔离 smoke 完成后已发送 `SIGTERM` 回收候选进程，`18082` 已释放，再执行正式切换。

## 3. 原子切换与共存结果

2026-08-18 02:04 CST 左右执行 `current` 符号链接切换并重启 `hospital-platform-api-v2.service`。启动日志明确记录：

- `runtimeMode=production`
- `host=10.0.0.3`
- `port=18081`
- `persistenceDatabaseProbe=ok`
- `persistenceRedisProbe=ok`
- `persistenceSchemaProbe=ok`
- `authRuntimeStatus=ready`
- `wechatIdentityConfiguration=configured`
- `wechatPaymentConfiguration=disabled`
- `outpatientPaymentConfiguration=configured`
- `msg=Hospital API listening in production mode`

切换后的实时状态：

```text
systemd: active
current: /home/ps/code/hospital-platform/releases/1a8a898
10.0.0.3:18081: LISTEN
0.0.0.0:8001: LISTEN
```

这证明本次只重启了新 Bun/Elysia API，旧 Python 服务继续监听，没有发生旧服务停机或端口覆盖。

## 4. 内网与公网复核

切换后实际请求结果：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}}
```

该结果分别在内网 `http://10.0.0.3:18081/health/ready` 和公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 取得。公网转发已到达新 API，且依赖 readiness 通过。

## 5. 日志与业务证据边界

切换窗口的 journald 低敏聚合只观察到服务停止/启动和两次健康请求，没有微信登录、患者目录、预约历史或门诊费用业务事件。因此本记录不能证明以下业务已经真机验收：

- 微信授权登录
- 首页患者刷新与多患者切换
- 我的挂号、爽约记录
- 门诊待缴/已缴费用
- 预约写入、取消、支付、医保结算或 HIS 回写

本次聚合还得到 `parsedRecords=4`、`parseErrors=5`。这说明当前从 journald 导出到 P0 聚合器的输入仍存在不可解析行；在日志采集边界修复并重新得到 `parseErrors=0` 前，不把该窗口作为业务证据门禁通过。该问题不影响已通过的 API readiness，但必须列为日志治理待办。

## 6. 下一步真机验收顺序

使用与 `1a8a898` 匹配的小程序运行包，在有效微信会话中按以下顺序操作，并同时保留页面、HTTP 和低敏日志三层证据：

1. 微信登录，确认登录态稳定。
2. 首页刷新患者目录，进入患者选择页显式切换另一就诊人，再返回首页确认上下文一致。
3. 进入“我的挂号”，确认预约历史、爽约记录、院区/科室/医生/日期布局与旧端一致。
4. 进入门诊缴费，分别观察待缴和已缴只读列表；只核对 Provider 返回事实，不进行真实支付。

预约写入、取消、微信支付、医保授权、医保结算和 HIS 写回继续放在只读链路稳定之后处理。

