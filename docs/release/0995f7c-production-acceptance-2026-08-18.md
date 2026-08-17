# 0995f7c 生产切换与停机边界验收记录（2026-08-18）

本文记录 `0995f7c` 在真实服务器上的生产切换。该版本包含 API 有界优雅停机，同时携带已经验证过的 journald P0 聚合工具；本次没有打开支付、医保、报告或预约写入。

## 1. 发布范围

- 当前 release：`/home/ps/code/hospital-platform/releases/0995f7c`
- 新 Bun/Elysia API：`10.0.0.3:18081`
- 旧 Python API：`0.0.0.0:8001`
- systemd：`hospital-platform-api-v2.service`
- Worker：继续 inactive
- 数据库迁移：未执行
- 支付、医保、报告和 HIS 写回：继续关闭或未注册
- API bundle SHA-256：`b5ced7b2e2655215e294fe1187c1c23b7bb82cb222ef6c1c754cce2bb60e5328`
- P0 聚合 bundle SHA-256：`5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1`

## 2. 代码与候选验证

本地 `pnpm check` 已通过：架构 62 条、工具测试 10 条、API 109 项测试、原生小程序 92 项测试、全仓构建 9/9。

候选在服务器真实 production env 下完成 preflight：

- MySQL：`ok`
- Redis：`ok`
- schema：`ok`，迁移基线为 `0016_patient_directory_sync_owner_index`
- 微信身份、患者目录、预约目录、预约历史、门诊费用：`configured`
- 微信支付、报告目录和报告详情：`disabled`

候选 API 隔离运行在 `127.0.0.1:18082`，readiness 通过。发送 SIGTERM 后，记录的时间戳从 `1786991561185` 到
`1786991561291`，约 106ms；候选日志同时出现 `service.stop.requested` 和 `service.stopped`，没有 systemd
stop-timeout、SIGKILL 或 unit timeout。该结果证明新停机 deadline 没有把正常连接回收拖到 systemd 的 30 秒硬超时。

## 3. 生产切换结果

执行同目录软链接原子替换后，只重启新 API：

```text
systemd: active
current: /home/ps/code/hospital-platform/releases/0995f7c
10.0.0.3:18081: LISTEN
0.0.0.0:8001: LISTEN
```

旧 Python API 没有重启，也没有发生端口覆盖。切换后的内网和公网 readiness 均返回：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}}
```

启动日志确认 `runtimeMode=production`，服务真实读取生产配置，且 `authRuntimeStatus=ready`、微信身份配置已加载。

## 4. 日志证据

切换后的最近 journald 窗口经过当前 release 的 P0 工具聚合：

- `parsedRecords=25`
- `parseErrors=0`
- `systemdWarningCount=0`
- `service.stop.requested=1`
- `service.stopped=1`
- `service.started=1`
- HTTP `200=8`、`401=1`

这证明本次停机没有再次出现上一个版本的 systemd timeout。日志窗口中仍混有切换前的健康、登录和患者目录历史事件，
因此不能把这些计数回填成 `0995f7c` 的新一次微信登录、患者切换、预约历史或门诊费用业务验收。

## 5. 业务边界

当前仍未取得以下业务的“页面 + HTTP + 同窗口低敏日志”三层新证据：

- 微信真机重新登录
- 首页刷新和显式切换多位就诊人
- 我的挂号、爽约记录
- 门诊待缴/已缴费用只读查询

下一步继续使用当前 `0995f7c` 对应的小程序运行包，按“登录 → 刷新/切换就诊人 → 我的挂号 → 门诊费用只读”逐项取证。
预约写入、取消、微信支付、医保结算和 HIS 写回继续最后处理。

