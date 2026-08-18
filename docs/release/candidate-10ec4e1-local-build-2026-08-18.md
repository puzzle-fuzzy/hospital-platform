# 10ec4e1 本地候选构建与发布边界

更新时间：2026-08-18

## 1. 候选内容

`10ec4e1`（中文提交：`收紧报告患者引用边界`）只收紧报告目录 adapter 的 Provider 患者引用边界：

- 在构造 LIS/PACS/ECG 请求前拒绝空 Provider 患者引用；
- 空引用不会调用 Provider；
- 报告 gate、报告详情 gate、支付、医保、HIS 和旧 Python 服务均未打开或修改；
- 同步更新报告 contract 说明和迁移基线测试，避免文档把 `9acdaf2` 线上 release 与本地候选混淆。

## 2. 本地证据

| 检查 | 结果 |
| --- | --- |
| 全量 `pnpm check` | 通过：架构 62 条、迁移/Provider/文档审计、格式、lint、工具测试、9 包 typecheck/test/build |
| adapter 测试 | 通过：77 项、171 个断言；报告测试包含空 Provider 患者引用不发请求 |
| API/Worker 直接构建 | 通过，提交后重新构建 |
| 原生小程序直接构建 | 通过，14 个页面脚本存在 |
| 小程序来源指纹 | `sourceRevision=10ec4e1`，`pageCount=14` |
| 用户已有改动 | `apps/miniprogram/project.config.json` 未触碰、未暂存、未提交 |

## 3. 发布状态

该候选没有上传服务器，也没有重启任何服务。最后一次已确认的线上状态仍为：

- 新 Bun/Elysia API：`/home/ps/code/hospital-platform/releases/9acdaf2`、`10.0.0.3:18081`；
- 旧 Python API：`0.0.0.0:8001` 继续运行；
- 数据库、Redis、schema readiness 均为 `ok`（以 `9acdaf2` 切换时证据为准）。

重启后使用当前 SSH 密码方式连接 `8.130.127.184` 时，服务端返回 `Permission denied (publickey)`，说明当前端点只接受公钥认证。
在恢复已授权私钥或由运维提供新的公钥登录方式前，不能完成候选上传、真实生产 preflight、隔离 smoke 或原子切换；也不能把本地测试
写成 `10ec4e1` 的线上业务验收。

## 4. 恢复发布顺序

恢复 SSH 访问后，必须按既有 runbook 重新完成：

1. 上传 `10ec4e1` 的 API/Worker/runtime smoke 产物并核对 SHA-256；
2. 使用真实生产 env 运行 preflight；
3. 用独立端口运行 live/ready/system-ping/401 smoke，并确认退出后端口释放；
4. 原子切换 `current`，只重启新 API，确认旧 Python `8001` PID/监听不变；
5. 核对 readiness、低敏日志聚合和报告 gate 状态，再决定是否进行公网/开发者工具/真机只读观察。

在上述步骤完成前，`10ec4e1` 只能视为本地候选，不能视为线上版本。
