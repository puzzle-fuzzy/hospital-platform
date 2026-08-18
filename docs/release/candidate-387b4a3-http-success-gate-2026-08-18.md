# `387b4a3` HTTP 完成门禁候选验收

更新时间：2026-08-18 23:47 CST

## 1. 结论

`387b4a3` 已完成本地全仓检查、候选产物远端 checksum、真实生产配置 preflight 和隔离 runtime smoke。本次候选**没有切换 `current`、没有重启正式 API、没有启动 Worker**。

当前线上保持：

- `current -> releases/c26e696`；
- 新 Bun/Elysia API 继续监听 `10.0.0.3:18081`；
- 旧 Python/Gunicorn API 继续监听 `0.0.0.0:8001`，未停止、未重启、未修改；
- Worker 保持 inactive；
- 临时 `127.0.0.1:18082` 冒烟进程已回收并释放端口。

本候选只收紧 P0 证据门禁，不开放预约写入、支付、医保、退款、报告详情或 HIS 回写。

## 2. 产物 checksum

候选目录：`/home/ps/code/hospital-platform/releases/387b4a3`。以下 SHA-256 已在服务器重新计算并与本地构建结果一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `a3caab446e9922f1322e6a797be2bbf4f7ea808d73b5f898a6faa8c468ad3cfd` |
| `apps/worker/dist/index.js` | `28ed16524fc2ad021d4406528b794a434b928156b102545a973c5c89f0fbff65` |
| `apps/worker/dist/preflight.js` | `63d6f7658620fcce3bfea146990c42d6a0b7edb742798af351aefdd6eae57859` |
| `apps/worker/dist/provider-directory-smoke.js` | `8486a5668b6155a7523fe2dcbe4d285c028ac5d013108d80898b03172b7a01fe` |
| `apps/worker/dist/api-runtime-smoke.js` | `ee24f42c4b667b1d8e08bab341c1d34d409e0baf7a1896c446d0261d8e76abff` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008a3ea05133767c077246ecd5c5de000ca5fea0307a1920b36276da` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `caa8f295365093496dd81b0b59a14f4e76f436a408ab41a7c359064e3f58f4ef` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `08e0406e23be04c7f266b67d5a4327827fc347433a90e6b7e137ac0a1ad60127` |

## 3. 真实生产 preflight

候选使用服务器已有的 `shared/api.env`，日志未打印密钥、连接串或 token：

- `environment=production`；
- runtime configuration passed；
- 微信身份、患者目录、预约目录、预约历史和门诊费用均为 `configured`；
- 微信支付、报告目录和报告详情保持 `disabled`；
- MySQL、Redis passed；
- schema `verified`，基线为 `0016_patient_directory_sync_owner_index`。

## 4. 隔离 runtime smoke

候选直接绑定 `127.0.0.1:18082`，内部业务前缀使用 `/api/v1`：

| 检查项 | 结果 |
| --- | --- |
| production 启动 | `service.started`，database/redis/schema probe 均为 `ok` |
| live | HTTP `200` |
| ready | HTTP `200`，连续 `3/3` |
| system ping | HTTP `200` |
| 未登录认证边界 | 所有保护路由返回 HTTP `401` 和 `unauthorized` |
| 清理 | 临时 API 已停止，`18082` 已释放 |

## 5. P0 证据门禁变化

旧门禁只要求业务 `requested` 和 `success` 同一条 trace/request 链，仍可能遗漏“service 写成功事件后，HTTP 响应层最终失败”的情况。本候选新增：

1. 关联链中的 `events` 计数；
2. 关联链中的 `httpCompletedStatusCounts`，只记录 `http.request.completed` 的有限状态码；
3. 业务门禁必须同时满足业务请求、业务成功和同链 HTTP `2xx` 完成；
4. 同链出现 `http.request.failed` 时，即使曾有 `2xx`，也不能通过；
5. 新失败原因 `same-trace-http-2xx`，旧摘要缺少新结构时不会被兼容性逻辑悄悄放行。

这只提高验收证据真实性，不会把 HTTP `200`、readiness 或日志成功事件单独解释为真机业务完成。页面结果、HTTP 语义、患者归属和低敏业务日志仍必须在真实微信会话中交叉核对。

## 6. 后续切换停止条件

如需切换本候选，必须再次确认旧 `8001` 不变、保存 `c26e696` 回滚指针，只重启新 API，并在切换后重新执行内外网健康检查、认证边界和 P0 日志聚合。真实微信登录、患者切换、预约历史和门诊费用仍需独立三层验收；支付、医保、退款和 HIS 继续最后处理。
