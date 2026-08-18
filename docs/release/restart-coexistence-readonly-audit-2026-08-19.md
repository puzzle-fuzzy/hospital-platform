# 2026-08-19 重启后新旧服务共存与全仓基线复核

## 1. 目的与范围

本次复核发生在开发会话意外重启后，目标是确认新 Bun/Elysia 服务恢复时没有影响旧 Python 服务，
并确认本地重构项目仍能通过当前工程门禁。本次只执行了服务器状态、HTTP 健康探针和本地代码检查，
没有切换 release、执行数据库 migration、清理 Redis、写入患者/业务数据或调用报告、支付、医保 Provider。

旧服务仍由原项目独立管理；本次没有修改 `G:\\fuck\\hospital`，也没有重启旧 Python unit。

## 2. 线上只读证据

检查目标：`ps@192.168.112.172`。敏感凭据不进入文档、日志或提交。

| 检查项 | 结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 当前 release | `/home/ps/code/hospital-platform/current -> releases/b7c9451` |
| 新 API 监听 | `10.0.0.3:18081`，进程为 Bun |
| 旧 Python 监听 | `0.0.0.0:8001`，进程为 Gunicorn |
| 临时端口 `18082` | 未发现监听，未产生残留临时服务 |
| 公网 live | `GET https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200` |
| 公网 ready | `GET https://test-hp.meiyi.pro/api/v2/health/ready` 返回 `200` |
| ready 依赖 | `database=ok`、`redis=ok`、`schema=ok` |

这些结果只能证明进程、监听、代理路径和依赖 readiness 恢复，不能证明微信真机、Provider 或任一临床业务已经完成。

## 3. 本地工程门禁

工作树中唯一未提交修改是用户由微信开发者工具产生的
`apps/miniprogram/project.config.json`；本轮没有覆盖、格式化或提交该文件。

重启后于 2026-08-19 07:01 CST 重新执行 `pnpm check`，并单独执行小程序
`runtime:verify`；全部通过：

- 架构边界审计：66 条规则通过；
- 迁移台账：14 个原生页面、64 个旧页面和 195 个旧路由完成一致性审计；
- Provider 文档接收审计：3 份接收记录、26 个 `documentId` 通过；
- Markdown 链接审计：195 个文档无断链；
- 发布基线：服务端 `b7c9451`，小程序提交 `5348715`，完整小程序来源
  `534871549517080807c7e5c1375247477f422750`；
- Biome 格式检查 238 个文件、Lint 239 个文件通过；
- 工具测试 19 项通过（57 个断言）；9 个 workspace 类型检查通过；
- 9 个 workspace 测试和 9 个 workspace 构建通过；小程序构建产出 14 个页面脚本。
- 小程序运行包来源校验通过：`revision=5348715`，14 个页面和根文件齐全。

## 4. 业务证据没有被扩大

本次没有新增以下业务完成证据：

- 微信真机扫码、会话过期恢复和第二位就诊人切换；
- 预约历史、爽约、门诊费用和报告的 Provider 三层链路；
- 门诊就诊记录目录、病历正文、住院病历或附件资源；
- 普通资料真实账号写入与 409 冲突；
- 微信支付、医保授权/结算、退款和 HIS 回写。

报告目录现有代码继续保持 Provider gate 未配置时的 `dependency-not-configured` 安全失败；
门诊就诊记录目录仍以 [`medical-record-directory-contract-draft.md`](../migration/medical-record-directory-contract-draft.md)
为准，未注册 `/api/v2/medical-records`。这两个边界都不能用健康探针、模拟器页面或单元测试替代。

## 5. 继续执行顺序

1. 使用当前已构建的 `dist/`（来源 `5348715`）在真实微信设备上完成 P0 只读链路：登录、患者选择、预约历史和门诊费用；
   每一条都要同时保留页面结果、HTTP status/requestId 和服务端低敏业务日志。
2. 报告域只有在取得 endpoint 权限、成功/空目录/拒绝/暂时失败四类脱敏样例后，才能打开目录 gate，
   先验收目录，再单独验收 LIS 详情；PACS、ECG、云影像和附件不能复用 LIS 详情。
3. 门诊就诊记录目录继续等待 MR-01 至 MR-15 的 Provider/HIS 确认；在 contract 从 `draft` 变为 `confirmed` 前，
   不新增 route、adapter、转发兼容层或假数据页面。
4. 支付、医保、退款和 HIS 写回继续放在只读业务稳定、Provider 合同冻结和真机证据齐全之后。

## 6. 回滚与安全边界

本次没有产生线上变更，因此没有新的回滚动作。后续若发布新 API 候选，仍只能使用
`api-v2` 的独立 systemd/release/`18081` 路径；旧 Python `8001` 不得作为回滚目标或被候选脚本重启。
