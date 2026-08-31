> **历史归档说明（2026-09-01）**：本文件记录 2026-08-27/28 执行窗口，文中的 `1bc5bf6` 运行包不再是当前候选。当前来源以 [`docs/release/current-baseline.json`](../release/current-baseline.json) 和最新全量交接单为准；本文件仅用于追溯，不能作为当前二维码、运行包或真机验收入口。

# 当前执行检查点（2026-08-27）

> 本文是当前工作树的执行事实入口，优先于本仓库中同一天之前生成的历史候选记录。
> 它记录代码、运行包、线上 release 和真实业务证据的边界，不把其中任意一项
> 推断成另一项。

## 本轮会话恢复复核（2026-08-27）

当前没有运行中的微信开发者工具或真机会话。启动保护候选
`1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916` 已完成 pending 校验，并已在关闭开发者工具后原子覆盖
live `dist`；发布后的 `runtime:verify` 已通过。当前 live 运行包来源为
`1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`。新的二维码和手机业务链
尚未形成真机页面或业务同链证据，
因此九个真机证据域继续保持 `pending`，不能把“二维码已生成”扩大为“真机业务已验收”。
二维码临时输出位于被忽略的 `.local/hospital-miniprogram/device-evidence-1bc5bf6/`，不进入 Git。
已完成复核：

- `pnpm migration:breadth:audit`：40 个原生页面、4 个主 Tab、2 个 action 页面和 14 个状态页入口通过；
- `pnpm migration:readiness`：旧端 64 个入口全部登记，5 个低风险域代码就绪但整域验收仍为 `0/5`；当前九域清单仍为 pending；
- `pnpm clinical:contract:audit`：4 个临床域继续保持 `normalized / unregistered`；
- `pnpm provider:audit`：4 份 Provider 接收记录、31 个 `documentId` 的来源和脱敏边界通过；
- `pnpm docs:audit`：文档无断链；线上 API `5738a71e` 与小程序 live `1bc5bf6` 的已发布基线仍可追溯。启动保护候选 `1bc5bf6` 已完成 live 发布，发布后的运行包校验通过。

### 2026-08-27 19:21 线上运行层复核

通过只读 SSH 在中转服务器 `192.168.112.172` 上复核了新旧服务共存状态：

- 新 API `hospital-platform-api-v2.service` 为 `active/running`，生产进程绑定
  `10.0.0.3:18081`；直接访问该绑定地址的 `/health/live` 和 `/health/ready`
  均返回 `200`，database、Redis、schema 均为 `ok`。
- 公网转发 `https://test-hp.meiyi.pro/api/v2/health/live` 和 `/ready` 均返回
  `200`；因此当前公网转发、TLS 和新 API 监听链路正常。
- 旧 Gunicorn 仍监听 `0.0.0.0:8001`；Worker unit 保持 `inactive`。本次只读核验
  没有修改、停止或重启旧服务。
- 新 API 日志在 `19:12` 观察到真机链路的 `/me`、普通资料和患者目录读取成功；随后
  患者同步两次进入 `patient-list` Provider 请求并以可重试的 `503` 结束。该失败链
  已记录平台 `traceId`、Provider 操作分类和 `providerRetryable=true`，没有记录患者号、
  Provider 原文或凭证；它证明上游同步当时失败，不证明当前患者目录为空，也不构成
  预约、报告、费用或真机整域验收证据。

这条运行层观察与代码门禁、运行包来源和真机页面证据分开保存。后续若继续排查患者同步，
应在同一平台 `traceId` 下取得 Provider 网关侧的可用请求记录；不能通过放宽校验、复制旧
接口或把同步失败降级为空目录来“修复”页面。

本轮没有修改旧项目、旧 Python 服务、旧数据库或旧 Redis。候选已完成 live 发布，
下一步应重新打开 `apps/miniprogram/dist/`，普通编译并生成绑定 `1bc5bf6` 的新二维码。后续若没有正式健康审核
bundle、临床/患者/外部 contract，不能通过继续写页面的方式替代业务材料；当前下一项实际动作
是让手机扫描本轮二维码并完成患者显式切换、预约历史/爽约、门诊费用和普通资料的真机三层取证。
当前待采集清单见
[`../release/device-evidence-1bc5bf6-pending.json`](../release/device-evidence-1bc5bf6-pending.json)。

## 当前来源与范围

| 项目 | 当前事实 | 结论 |
| --- | --- | --- |
| 当前 Git 工作树 | 当前 `main`（提交以 `git rev-parse HEAD` 为准）；本轮 API 运行时代码变更来源为 `eb4d2eb4`、`4e1e53ed` | 本轮文档同步随当前提交维护 |
| 线上新 API | `5738a71e0bcddaa8849106754baf5b296427bed7` | 已部署本轮请求日志稳定错误码投影 |
| 本地小程序 live `dist` | `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916` | 与当前小程序运行包一致 |
| 旧 Python 服务 | `0.0.0.0:8001` | 本轮未修改、未停止 |
| 旧项目、旧 MySQL、旧 Redis | 不在本轮写入范围 | 本轮未操作 |

本轮 API 运行时代码变更 `5738a71e` 包含请求日志稳定错误码投影：统一错误处理器已知的 `HttpError`、
可重试 Provider 失败、非法 Provider 响应和主动拒绝会写入稳定公开错误码，不记录原始报文或敏感字段。
此前本轮 API 运行时代码变更 `eb4d2eb4` 包含健康知识服务的直调关系查询白名单：进入 repository 之前只接受
`kind` 和 `id`，未知字段返回稳定的查询校验错误；`4e1e53ed` 又为这条失败链补充固定枚举
`validationReason`，便于排障而不记录查询值。此前 `927b90cf` 已将健康知识路由的认证顺序和未知
query 参数边界固定下来。这些提交已随 `5738a71e0bcddaa8849106754baf5b296427bed7` 完成远端
API-only 发布；代码发布事实与真实 Provider/真机业务证据仍然分开记录。

## 门禁结果

已完成并通过：

- 健康知识 API 定向测试：9 项通过，0 失败；
- 全仓格式检查和 Biome lint；
- `pnpm typecheck`：9/9 workspace 通过；
- `pnpm test`：9/9 workspace 通过，API 218 项通过、0 失败；
- `pnpm build`：9/9 workspace 通过；
- 迁移、导航、患者展示、临床关闭态、只读域、Provider 材料、文档和日志静态审计。

`pnpm check:candidate` 的前置审计、工具测试、9 个 workspace 的 TypeScript 检查和测试均通过；最终聚合构建曾在小程序阶段因微信开发者工具锁定
`apps/miniprogram/dist` 而以 `EBUSY` 停止。关闭工具后已单独完成小程序 pending 校验、live 原子发布和发布后 `runtime:verify`；`5738a71e + 1bc5bf6` 的当前基线审计通过，
当前 pending 目录已清理，不能把此前的目录锁误判为旧服务或 API 漂移。
该门禁仍不替代真实 Provider、微信真机或支付业务证据。

## 当前迁移状态

- 旧端 64 个页面均已登记，新端 40 个原生页面均有落点；
- 当前 5 个低风险域已有代码闭环：患者目录、预约目录/历史、报告受限只读、门诊费用只读、普通资料；
- 这 5 个域的整域真实验收仍为 `0/5`，但微信登录和患者目录已产生局部同链观察；九个真机证据域仍全部为 `pending`；
- 健康百科虽有只读 API 和页面，但正式审核 bundle 不存在，源快照仍 `not-approved`，继续 fail-closed；
- C 临床、D 患者/便民写入、E 外部入口、F 支付/医保/HIS 回写继续关闭；
- 不能把页面落点、类型测试、服务 smoke 或数据库 readiness 当作 Provider、真机或支付成功。

## 下一步固定顺序

1. API-only 发布已完成，当前服务端 release 为 `5738a71e0bcddaa8849106754baf5b296427bed7`；后续若发生业务层回归，只回滚新 API `current`，不停止旧 Python `8001`。
2. 重新打开 `apps/miniprogram/dist/` 并普通编译，先核对 `build-info.json` 的 sourceRevision 为 `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`，再生成二维码并采集四 Tab、患者显式切换、预约历史/爽约、门诊费用和普通资料的三层证据：页面、客户端 `requestId`、服务端 Pino/Provider 低敏关联。
3. 收到正式审核 bundle、临床 contract、患者写入 contract、外部会话 contract 后，再按 B/C/D/E 独立准入；支付/医保/HIS 回写最后处理。

## 禁止事项

- 不把当前 `main`、小程序本地 `dist` 或运行层 smoke 直接写成微信线上或真实业务已验收事实；
- 不为了通过发布基线而回退安全校验、修改审计器或部署半套 API；
- 不把旧 Python 的 FSI、医保、微信授权或数据库内容复制到新端的未经确认路径；
- 不在缺少正式业务 contract 时新增患者写入、二维码、WebView、支付、医保或 HIS 回写接口。
