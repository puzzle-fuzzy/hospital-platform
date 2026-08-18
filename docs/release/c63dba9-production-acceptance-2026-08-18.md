# c63dba9 生产共存发布验收（2026-08-18）

本文记录 `c63dba9` 的生产候选、隔离验收、原子切换和新旧服务共存结果。
本次提交只补齐普通资料更新的开始事件及其证据门禁，不打开支付、医保、HIS 写入、预约写入或 Worker。

## 1. 发布范围

- Git 提交：`c63dba9`，提交说明为“补齐普通资料更新日志链路”。
- 变更内容：普通资料更新在字段校验前记录 `user.profile.update.requested`，并保留成功、校验失败、版本冲突的独立结果事件；补充回归测试、P0 证据门禁和中文业务注释。
- 未修改：旧 Python 服务、旧表、旧 Redis DB1、数据库 schema、支付/医保/HIS gate、预约写入和 Worker。
- 切换前 release：`e5bafd3`。
- 切换后 release：`/home/ps/code/hospital-platform/releases/c63dba9`。
- 当前指针：`/home/ps/code/hospital-platform/current -> releases/c63dba9`。
- 新 API：`10.0.0.3:18081`；旧 Python API：`0.0.0.0:8001`。

## 2. 本地门禁和 Bundle SHA-256

提交前已通过：`pnpm --filter @hospital/api test`（112 passed）、`pnpm test`（9/9 packages）、
`pnpm lint`、`pnpm typecheck`、`pnpm test:tools`、`pnpm migration:audit`、`pnpm docs:audit` 和
`pnpm build`。本轮显式变更文件的 `git diff --check` 通过；未触碰用户已有的
`apps/miniprogram/project.config.json` 工作区修改。

上传到服务器的 7 个构建产物与本地归档逐文件 checksum 一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `35fee0b274f761c9f89c407a5ba0f74d4c990dfa04112c0783c61d0a0b46c546` |
| `apps/worker/dist/index.js` | `b1d750923471b6c6dc96f946f0166a4b1448e0e9ca0855db2f7e373068b7e563` |
| `apps/worker/dist/preflight.js` | `ea95e8ebd99c2cac85e7110429e24eb1672b754afa364efa4c31dbb58c1aee7f` |
| `apps/worker/dist/provider-directory-smoke.js` | `3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |

## 3. 候选隔离验收

2026-08-18 11:07 CST 使用服务器既有 `/home/ps/code/hospital-platform/shared/api.env` 执行候选
preflight，结果如下：

- environment：`production`；
- 微信身份：`configured`；微信支付：`disabled`；患者目录、预约目录、预约记录、门诊费用：`configured`；报告：`disabled`；
- MySQL、Redis：`ok`；schema：`verified`，期望 migration 为 `0016_patient_directory_sync_owner_index`；
- 候选 API 临时监听 `127.0.0.1:18082`，启动日志明确记录 `runtimeMode=production`、repositories enabled 和三项依赖 `ok`；
- 候选 runtime smoke：live 200、ready 连续 3/3、system ping 200、未登录受保护路由 401/`unauthorized`；
- 候选完成后收到正常 `SIGTERM`，`18082` 已释放。

## 4. 原子切换与新旧服务共存

2026-08-18 11:09 CST：

- 切换前确认 `current=e5bafd3`、`18081` active、旧 `8001` active、Worker inactive；
- 使用同文件系统的 `current.next -> current` 原子软链接替换；
- 只重启 `hospital-platform-api-v2.service`，没有重启、停止或修改旧 Python 服务；
- 切换后 `current=c63dba9`，新 API 主进程为 Bun，服务状态 `active`；
- 启动日志确认 `environment=production`、`runtimeMode=production`、MySQL/Redis/schema 均为 `ok`；
- `wechatPaymentConfiguration=disabled`、报告 gate 关闭，Worker 保持 `inactive`；
- 新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 均保持监听。

## 5. 切换后 HTTP 验收

- 内网 `/health/live`、`/health/ready`、`/api/v1/system/ping`：均为 200；ready 依赖为
  `database=ok`、`redis=ok`、`schema=ok`；
- 公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping`：均为 200；
- 公网 `/api/v2/health/ready` 连续 6/6 为 200，响应保留 `Cache-Control: no-store`；
- 公网未登录 `/api/v2/patients`：401，返回 `unauthorized`，认证边界正常；
- 本次只做运行层、依赖、日志和认证边界验收，没有调用真实微信、患者、预约、门诊费用或 Provider 业务接口。

## 6. 日志质量和业务证据边界

切换后使用同一 release 的 `p0-log-aggregate.js` 对受控 journald 窗口执行低敏聚合，结果为：
`inputLines=186`、`parsedRecords=170`、`parseErrors=0`、`systemdWarningCount=0`、
`traceIdCount=83`。这证明日志输入和解析链路正常，但不等于业务域已经验收。

普通资料更新的证据链现在明确为：

```text
user.profile.update.requested
        ├─ 成功写入：user.profile.updated
        ├─ 版本冲突：user.profile.conflict
        └─ 输入拒绝：user.profile.update_failed
```

其中 `requested` 只证明请求已进入资料服务，不能被当作成功写入；后续真机验收必须同时提供页面结果、
HTTP trace 和对应的结果事件。预约历史、爽约记录、门诊费用、报告、支付和医保仍保持真实业务未验收状态。

## 7. 回滚边界

如新 API readiness、公网路径、旧 `8001` 或真实业务出现无法解释的异常，只把 `current` 回滚到
`e5bafd3` 并重启 `hospital-platform-api-v2.service`；不得停止旧 Python、清空 Redis、回滚 schema
或删除旧 release。

## 8. 下一步

使用与 `c63dba9` 匹配的原生小程序运行包，在有效微信会话下依次验收：登录恢复 → 患者目录/显式切换 → 我的挂号 →
爽约记录 → 门诊费用待缴/已缴。支付、医保、预约写入、退款、报告 gate 和 HIS 写回继续最后处理。
