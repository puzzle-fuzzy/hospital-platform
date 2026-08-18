# 4ae2a31 本地候选构建与发布边界

更新时间：2026-08-18

## 1. 候选内容

`4ae2a31`（中文提交：`收紧门诊费用患者引用边界`）继续收紧只读 Provider adapter 的患者引用边界：

- 报告目录和门诊费用 adapter 在构造 HTTP 请求前拒绝空 Provider 患者引用；
- 空引用不会向众阳 Provider 发起请求；
- 报告和门诊费用的 owner-scoped 映射、服务层 fail-closed 以及日志安全边界保持不变；
- 预约写入、支付、医保、HIS、报告写入和旧 Python 服务均未打开或修改；
- `apps/miniprogram/project.config.json` 的用户已有改动未触碰。

## 2. 本地证据

| 检查 | 结果 |
| --- | --- |
| 全量 `pnpm check` | 通过：9/9 workspace 任务成功；API 114 项测试、530 个断言通过 |
| adapter 测试 | 通过：78 项、173 个断言；报告和门诊费用均包含空 Provider 患者引用不发请求测试 |
| API 直接构建 | 通过：Bun bundle 589 modules |
| Worker 直接构建 | 通过：Bun bundle 及日志审计工具 bundle 均成功 |
| 原生小程序直接构建 | 通过：14 个页面脚本存在 |
| 小程序来源指纹 | `sourceRevision=4ae2a31`，`pageCount=14` |
| 用户已有改动 | `apps/miniprogram/project.config.json` 未触碰、未暂存、未提交 |

Turbo 全量门禁中的小程序任务命中了历史缓存，因此另外执行了当前提交的直接构建，并以直接构建产出的来源指纹作为小程序候选证据。

## 3. 发布状态

该候选没有上传服务器，也没有重启任何服务。最后一次已确认的线上状态仍为：

- 新 Bun/Elysia API：`/home/ps/code/hospital-platform/releases/9acdaf2`、`10.0.0.3:18081`；
- 旧 Python API：`0.0.0.0:8001` 继续运行；
- 数据库、Redis、schema readiness 均为 `ok`（以 `9acdaf2` 切换时证据为准）。

重启后使用当前 SSH 密码方式和本地已知私钥连接 `8.130.127.184`，服务端均返回 `Permission denied (publickey)`，说明当前端点只接受公钥认证。
在恢复已授权私钥或由运维提供新的公钥登录方式前，不能完成候选上传、真实生产 preflight、隔离 smoke 或原子切换；也不能把本地测试写成
`4ae2a31` 的线上业务验收。

## 4. 恢复发布顺序

恢复 SSH 访问后，必须按既有 runbook 重新完成：

1. 上传 `4ae2a31` 的 API/Worker/runtime smoke 产物并核对 SHA-256；
2. 使用真实生产 env 运行 preflight；
3. 用独立端口运行 live/ready/system-ping/401 smoke，并确认退出后端口释放；
4. 原子切换 `current`，只重启新 API，确认旧 Python `8001` PID/监听不变；
5. 核对 readiness、低敏日志聚合和只读业务 gate 状态，再决定是否进行公网/开发者工具/真机只读观察。

在上述步骤完成前，`4ae2a31` 只能视为本地候选，不能视为线上版本。
