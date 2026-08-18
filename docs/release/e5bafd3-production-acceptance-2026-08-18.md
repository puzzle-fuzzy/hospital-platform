# `e5bafd3` 生产共存与资料边界验收记录

> 验收时间：2026-08-18 10:05-10:07 CST
>
> 目标：将普通资料边界修正后的 Bun/Elysia API 切换到生产，同时保持旧 Python 服务持续运行。
>
> 结论：新 API release 切换成功，运行层和产物完整性通过；随后已取得一次真实微信登录与单患者同步证据，但患者显式切换、预约历史、爽约记录和门诊费用仍未完成三层业务验收。

## 1. 本次代码范围

- 当前仓库 release/commit：`e5bafd3`，已推送到 `origin/main`。
- 运行时业务代码来自前一提交 `bac6f7f`：
  - 普通资料昵称按 Unicode code point 计数，避免中文和 emoji 被 UTF-16 长度错误拒绝；
  - 普通资料版本在 API、domain 和 MySQL 读模型统一限制为 `INT UNSIGNED` 上限；
  - 新增中文注释、API 资料回归测试和 MySQL 读模型 fail-closed 测试。
- `e5bafd3` 同时修正小程序配置门禁和迁移文档测试：配置按 JSON 语义校验，不再依赖换行、缩进或 CRLF；迁移盘点测试与当前证据措辞同步。
- 本次不修改旧 Python 项目源码、旧数据库表、旧进程和旧监听端口。

## 2. 服务器服务边界

- 当前 release：`/home/ps/code/hospital-platform/releases/e5bafd3`。
- 新 Bun/Elysia API：`hospital-platform-api-v2.service`，监听 `10.0.0.3:18081`。
- 旧 Python/Gunicorn API：继续监听 `0.0.0.0:8001`；切换前后 PID 均为
  `1768120、1768171、1768183、1768197、1768199`。
- Worker：本次未启动。
- 数据库迁移：本次未执行；生产 schema probe 通过，marker 为
  `0016_patient_directory_sync_owner_index`。

## 3. 构建产物完整性

本地上传包与服务器包 SHA-256 一致：

`4db1c93b6c27dd0e78272fc3ad2529a118f23c130917eb123298c4bd84d6a5db`

服务器 `releases/e5bafd3` 中的产物与本地构建产物逐一一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `0e1da6f5641f8567691ede81dab755bc7c2cc1ebfa474c40033bdf77af8fda9a` |
| `apps/worker/dist/index.js` | `b1d750923471b6c6dc96f946f0166a4b1448e0e9ca0855db2f7e373068b7e563` |
| `apps/worker/dist/preflight.js` | `ea95e8ebd99c2cac85e7110429e24eb1672b754afa364efa4c31dbb58c1aee7f` |
| `apps/worker/dist/provider-directory-smoke.js` | `3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `6405b1e971969bd524754372169a94d3d13b62b9c61e031fef4517590ff71a07` |

## 4. 切换前验收

使用生产环境变量执行候选 release preflight，结果为通过：

- environment：`production`。
- MySQL、Redis：`ok`。
- schema：`verified`，预期 marker 为 `0016_patient_directory_sync_owner_index`。
- 微信身份、患者目录、预约目录、预约记录、门诊费用：`configured`。
- 微信支付、报告目录、报告详情：`disabled`。

环境变量值没有输出到命令结果或本文档。

候选进程在 `127.0.0.1:18083` 以 production mode 隔离启动，使用 Elysia 内部 `/api/v1` 路径完成 runtime smoke：

- live：HTTP 200；
- ready：连续 3 次 HTTP 200；
- system-ping：HTTP 200；
- 未登录业务边界：HTTP 401；
- 收到 SIGTERM 后正常停止，`18083` 已释放。

## 5. 原子切换结果

切换前 `current -> releases/4cf9e66`，使用 `current.next` 符号链接原子替换为
`current -> releases/e5bafd3`，随后只重启 `hospital-platform-api-v2.service`。

启动日志时间为 2026-08-18 10:06:30 CST，并明确记录：

- `environment=production`、`runtimeMode=production`；
- database/redis/schema probe 均为 `ok`；
- `persistenceRepositories=enabled`、`authRuntimeStatus=ready`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；
- 支付和报告保持 `disabled`。

切换后确认：

- `/health/live`：HTTP 200，`success=true`、`status=ok`；
- `/health/ready`：HTTP 200，`success=true`、`status=ready`，三项依赖均为 `ok`；
- 新 API 产物 hash 为表中 `apps/api/dist/index.js` 的值；
- `8001` 旧 Python 监听和 PID 未变化。

## 6. 公网转发复核

切换后从本地通过 `https://test-hp.meiyi.pro/api/v2` 使用当前构建的 runtime smoke：

- live：HTTP 200，traceId 为 `ce27ddc9-7265-432e-8ba6-4f0a22719cf0`；
- ready：连续 3 次 HTTP 200，traceId 为 `c4de6936-a0bc-437b-819b-e4771ba80288`、
  `7104ab26-7764-4a6d-a617-0a5f5c3a58cd`、`d0554200-e747-4655-82fc-75cfd6fcaf9b`；
- system-ping：HTTP 200，traceId 为 `c6b245c0-859b-4483-a069-ee3f1e0eef9f`；
- 未登录业务边界：HTTP 401，traceId 为 `0edcd645-237d-40e6-982d-13145d3ae1d2`；
- 单独的公网 ready 请求返回 `Cache-Control: no-store`，`X-Request-Id` 为
  `60313054-7037-4d62-a808-e63ed6f1e951`。

这证明阿里云转发已把公网 `/api/v2` 请求送到新 API；它仍然只覆盖运行时和未登录边界，不包含有效微信会话或 Provider 业务结果。

## 7. 切换后真实业务观察

切换后 2026-08-18 10:09:11-10:09:14 CST 出现一次真实微信会话：微信登录 HTTP 200，随后患者目录读取 HTTP 200，同步 HTTP 200，返回 1 条 active 患者记录和 1 条 `his-patient` 引用映射。低敏 traceId 和逐事件证据见 [`e5bafd3-p0-business-observation-2026-08-18.md`](e5bafd3-p0-business-observation-2026-08-18.md)。

这次观察只证明微信身份、Redis session 使用和单患者同步链路进入当前 release，不证明多患者切换或任何后续 Provider 查询。以下仍为未验收/关闭：

1. Redis session TTL 的独立核对、真机登录恢复和多患者显式切换。
2. 失效恢复、切换后的页面重新读取和患者映射差异。
3. 我的挂号、爽约记录、报告目录/详情和门诊费用的 Provider、公网、真机三层证据。
4. 预约写入、取消、费用详情、微信支付、医保授权/结算、退款和 HIS 写回。

本次内网健康检查只证明服务存活和依赖 ready，不能代替公网 `/api/v2` 或真机业务验收。

## 8. 下一步

使用与 `e5bafd3` 匹配的小程序包，在已经登录的有效微信会话中按以下顺序取证，并为每一步保留页面结果、HTTP 摘要和低敏日志：

```text
微信登录 -> 刷新就诊人 -> 显式切换就诊人 -> 我的挂号（在线渠道） -> 爽约记录 -> 门诊待缴/已缴只读
```

任何 `unauthorized`、`persistence-temporarily-unavailable`、`external service rejected` 或字段不符合旧端语义，先停在当前只读步骤定位 owner/session/Provider 边界，不通过兼容转发或空列表伪造成功。支付、医保和 HIS 写入继续最后处理。
