> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `413cbea13f022831f63e9c750661eeabbffc68d5`（`413cbea`），共 40 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

> 当前配套小程序运行包来源（2026-08-27）：`413cbea13f022831f63e9c750661eeabbffc68d5`（`413cbea`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# `1bc8b0a8` 新 API 生产共存发布验收记录（2026-08-27）

> 本记录只证明新 Bun/Elysia API 的候选构建、真实生产依赖、隔离运行、原子切换和公网 HTTPS smoke。
> 不把健康检查或认证边界误写成微信真机、患者、预约、门诊费用、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240` |
| 小程序客户端 | `62cdb8f`（本地 live，独立于服务端发布） |
| 小程序构建来源 | `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328` |
| 切换前服务端 release | `1107a78a47ac2fbe0557958251d66da9effc66de` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，未执行 migration |

## 候选验证

- 服务端定向测试、TypeScript 检查、全仓 build 和小程序 `337 pass / 0 fail / 3702 expect()` 通过。
- 真实 production env preflight 通过：微信身份、患者目录、预约目录/历史、门诊费用、MySQL、Redis 和 schema 已配置；支付与报告 gate 关闭。
- 候选在 `127.0.0.1:18082` 以 `runtimeMode=production` 启动；live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 全部通过。
- 隔离进程已回收；没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 原子切换与旧服务共存

切换前 `current` 为 `90d8910bdc54d48dde66c4ff03a7434c182ebd92`，随后只执行：

```text
current.next -> releases/1bc8b0a85f21cb58205a99ce4de0de6afe9bf240
mv -Tf current.next current
只重启 hospital-platform-api-v2.service
```

切换后确认：

- `current` 指向 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，新 API active 并监听 `10.0.0.3:18081`；
- 旧 Python Gunicorn PID `3687390、3687419、3687420、3687421、3687422` 仍存活，`8001` 持续监听；
- Worker 仍为 inactive；没有启动支付、医保或 HIS 写回任务；
- 内网 readiness 的 database、redis、schema 均为 `ok`。

## 公网 smoke

使用同一 `1bc8b0a8` bundle 对 `https://test-hp.meiyi.pro/api/v2` 验证：

- live `200`；
- ready 连续 `3/3` 为 `200`；
- system ping `200`；
- 未登录认证边界 `401 unauthorized`；
- 关闭能力边界 `404 not-found`。

公网 smoke 使用 HTTPS 默认证书校验通过；服务启动日志明确为 `production`，并记录 database/Redis/schema probe 为 `ok`。日志未输出环境变量值、令牌、患者标识或 Provider 原文。

## 业务边界与回滚

本次只完成健康知识跨层数据契约修正及新旧服务共存发布；健康百科正式审核 bundle、真实微信登录、患者切换、预约历史、爽约、门诊费用、普通资料和 Provider 业务仍需逐域三层/四层取证。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭。若新 API readiness、公网路径或旧 `8001` 异常，只允许把 `current` 原子切回切换前 release，并只重启新 API；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
