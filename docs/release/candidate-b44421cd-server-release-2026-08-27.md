# 服务端独立候选 `b44421cd` 发布记录（2026-08-27）

> 本候选只更新新 Bun/Elysia API 运行包，不上传微信线上小程序版本；配套小程序为本地 live `805c54e`。
> 本记录证明候选构建、真实生产依赖、隔离 smoke 和新旧服务共存切换，不替代真实微信、患者、Provider、支付或医保业务证据。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` |
| 小程序客户端 | `805c54e` |
| 小程序构建来源 | `805c54ea9fa943385ad6feebed1401d521fbad3c` |
| 服务端运行时变化 | 健康知识关系查询增加 `kind`/`id` 白名单和固定失败校验原因日志；不记录查询值 |
| 数据库 schema | 未新增 migration；继续使用线上已验证 `0016_patient_directory_sync_owner_index` |
| Worker | 未启动，继续保持 inactive |

## 候选构建产物

以下是本地 Bun 构建产物与远端独立 release 目录逐项核对的 SHA-256：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `a93185d61c8531dbe542c6957bde4a4339e720997a7132a1ff0b0b535920c20c` |
| `apps/worker/dist/index.js` | `fe278b7d328e15845f2fe00d29e50c7e5c01b460e1980ef7bf43820639d7036a` |
| `apps/worker/dist/preflight.js` | `d348996aab11f247dd26c0fc908b938cb4331cfc2f2abe5d41c3e2ec678d8ca4` |
| `apps/worker/dist/provider-directory-smoke.js` | `86503a97bec6bbf064d9984275904b418b4a20107b9f6bd45747135aab06b607` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `d1963a9a2fc66b53954c5b642ddf6c03c9031e9f0673075210ede357a491c915` |

## 发布前门禁

- `pnpm check:candidate` 通过：结构、迁移、契约、文档、日志、Biome、工具测试、9 个 workspace 类型检查、测试和构建均通过；工具测试为 `108 pass / 0 fail / 763 expect()`，API 为 `216 pass / 0 fail / 907 expect()`，小程序为 `341 pass / 0 fail / 3728 expect()`。本次小程序修复不改变服务端 release 内容。
- 使用服务器既有 `shared/api.env` 的真实 production preflight 通过：MySQL、Redis、schema 均为 `ok`；微信身份、患者目录、预约目录/历史和门诊费用配置完整；支付、报告 gate 继续关闭。
- 候选在 `127.0.0.1:18082` 以 `environment=production` 启动，live、连续 3 次 ready、system ping、未登录边界 401 和关闭能力 404 全部通过；隔离进程已清理。
- 没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 原子切换与旧服务共存

2026-08-27 16:53 CST，切换前确认旧 `current=1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`、API active、旧 Python `8001` 监听、Worker inactive，且目标 release 与 `current.next` 均不存在。随后只执行同目录原子切换并重启新 API：

```text
current.next -> releases/b44421cd321ff9ff23eeb49b12641d1772d2bdc1
mv -Tf current.next current
只重启 hospital-platform-api-v2.service
```

切换后确认：

- `current` 指向 `/home/ps/code/hospital-platform/releases/b44421cd321ff9ff23eeb49b12641d1772d2bdc1`；
- `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081`；
- 旧 Python `0.0.0.0:8001` 仍在监听，旧服务没有停止、重启或修改；
- `hospital-platform-worker-v2.service=inactive`，没有启动支付、医保或 HIS 回写任务；
- 内网与公网 `/api/v2/health/ready` 均返回 `database/redis/schema=ok`。

启动日志明确记录 `environment=production`、`runtimeMode=production`、认证运行时 ready、数据库/Redis/schema probe 为 `ok`；没有输出环境变量值、令牌、患者标识或 Provider 原文。

## 业务边界与回滚

本次只发布健康知识 API 的安全边界修正。真实微信登录、患者切换、预约历史、爽约、门诊费用、Provider 和普通资料仍需绑定同一小程序来源逐域采集三层证据；真机/开发者工具当前没有运行会话，九个证据域继续为 `pending`。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；不启动 Worker，不改变旧 Python 服务。

若新 API readiness、公网路径或旧 `8001` 异常，只允许把 `current` 原子切回
`releases/1bc8b0a85f21cb58205a99ce4de0de6afe9bf240` 并只重启 `hospital-platform-api-v2.service`；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
