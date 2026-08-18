# 4ae2a31 生产切换与新旧服务共存验收

更新时间：2026-08-18 15:23-15:25 CST

## 1. 发布内容与边界

- 线上运行 release：`/home/ps/code/hospital-platform/releases/4ae2a31`；
- 切换前 release：`/home/ps/code/hospital-platform/releases/9acdaf2`；
- 本次运行代码来自已通过本地门禁的 `4ae2a31`（`收紧门诊费用患者引用边界`）；后续 `4f72d71`、`b276a25` 只补充发布/验收门禁文档，未进入运行 bundle；
- 报告目录和门诊费用 adapter 在 HTTP 请求前拒绝空 Provider 患者引用，空引用不会调用 Provider；
- 未打开支付、医保、HIS 写入、预约写入、报告 gate、Worker 或旧 Python 服务变更；
- 数据库没有执行 migration、写入业务数据或修改 schema。

## 2. 本地构建与服务器产物指纹

本地已通过全量 `pnpm check`、adapter 78 项测试/173 个断言，并强制构建 API、Worker 和原生小程序。
服务器 release 中八个 bundle 与本地 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `e8bfbff19835e530f974b359c570b5fb842271afbd8b69ac1d7f29c53d1e0489` |
| `apps/worker/dist/index.js` | `3e1c39ca8f09570ea2e0f85c848a8c8b6169f07132b4f49204a806cb80badef9` |
| `apps/worker/dist/preflight.js` | `a2fc8cdb460671f19e7a8a75167ace220bac4ba5c458f9266b518fab7a389284` |
| `apps/worker/dist/provider-directory-smoke.js` | `3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `3f8190fb7acc75a41fb2be12181ad9eb99cafc2302f7044a157452228d4fcd70` |

## 3. 发布前验证

使用服务器真实 `shared/api.env` 的候选 preflight 通过：

- `environment=production`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用为 `configured`；
- 微信支付、报告目录、报告详情保持 `disabled`；
- MySQL、Redis、schema 均为 `ok`；
- schema 为 `verified`，目标 migration 为 `0016_patient_directory_sync_owner_index`。

候选在 `127.0.0.1:18082` 以生产模式独立启动并通过 runtime smoke：

- live：200；
- ready：连续 3/3，数据库、Redis、schema 均为 `ok`；
- system-ping：200；
- 未登录受保护路由：401；
- 候选进程随后正常 SIGTERM 停止，`18082` 已释放。

## 4. 原子切换与旧服务共存

切换前先确认 `current -> 9acdaf2`，再通过同目录 `current.next -> current` 原子替换，随后只执行
`sudo -n systemctl restart hospital-platform-api-v2.service`。

切换后证据：

- `current -> releases/4ae2a31`；
- 新 API `hospital-platform-api-v2.service` 为 `active/running`，PID `3106373`，启动日志明确为
  `environment=production`、`runtimeMode=production`、MySQL/Redis/schema `ok`；
- 新 API 监听 `10.0.0.3:18081`；
- 旧 Python Gunicorn 继续监听 `0.0.0.0:8001`，切换前后 PID 均为 `1990166、1990195、1990197、1990198、1990199`；
- `hospital-platform-worker-v2.service` 只读复核为 `inactive/dead`、`MainPID=0`，Worker 没有启动；
- 临时上传压缩包已从候选目录清理，八个运行 bundle 保留。

## 5. 内外网与日志观察

切换后内网 `10.0.0.3:18081` 的 live、ready、`/api/v1/system/ping` 均为 HTTP 200；公网
`https://test-hp.meiyi.pro/api/v2` 的 live、ready、system-ping 均为 HTTP 200，live/ready 保留
`Cache-Control: no-store`，ready 的 database/redis/schema 均为 `ok`。

切换窗口 journald 使用同一 release 的低敏聚合工具得到：

```text
inputLines=15 parsedRecords=9 parseErrors=0 ignoredBlankLines=1 ignoredControlLines=5
eventCounts={http.request.completed:6, service.started:1, service.stop.requested:1, service.stopped:1}
domainCounts={infrastructure:9} outcomeCounts={other:1, requested:2, success:6}
httpStatusCounts={200:6} systemdWarningCount=0 providerRequestIdCount=0
```

该窗口没有真实微信登录、患者同步、预约历史、门诊费用或报告业务事件，不能把健康探针成功写成业务验收成功。

## 6. 重启后复核（15:35 CST）

用户会话重启后再次只读核对，线上状态没有漂移：

- `current` 仍指向 `/home/ps/code/hospital-platform/releases/4ae2a31`；
- `hospital-platform-api-v2.service` 仍为 `active`，Bun 进程继续监听 `10.0.0.3:18081`；
- `hospital-platform-worker-v2.service` 仍为 `inactive`；
- 旧 Python Gunicorn 继续监听 `0.0.0.0:8001`，未停止、未重启、未修改；
- 公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 分别为 HTTP 200，live/ready 继续返回 `Cache-Control: no-store`，ready 的 database、redis、schema 均为 `ok`；
- 15:23:30 起的低敏日志聚合仍为 `parseErrors=0`、`systemdWarningCount=0`，没有新增真实业务事件。

本次只读复核没有切换 release、写入数据库/Redis 或操作旧服务；本地 `main` 后续的 `b276a25`、`c2d6e8f` 仅包含测试/文档门禁修正，尚未进入线上运行 bundle。

## 7. 回滚与下一步

如新 API readiness、公网路径、旧 `8001` 或后续只读业务出现未解释异常，只回滚新 API：将 `current` 原子切回
`releases/9acdaf2`，重启 `hospital-platform-api-v2.service`，再次核对新旧端口。禁止停止旧 Python、删除旧 release、
清空 Redis 或回滚数据库 schema。

下一步按 P0 手册在当前 `4ae2a31` 上取得真实微信会话、患者切换/失效恢复、预约历史和门诊费用的页面、HTTP trace、
Provider/低敏日志三层证据；报告仍等待独立 gate/脱敏样例。支付、医保、HIS 和 Worker 继续最后处理。
