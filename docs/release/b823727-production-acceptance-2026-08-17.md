# `b823727` 生产切换与共存验收（2026-08-17）

## 结论

候选 `b823727` 已完成本地构建、服务器真实生产 env preflight、7 个发布产物 checksum
核对和 `127.0.0.1:18082` 隔离 runtime smoke，并于 2026-08-17 23:15 CST 前后原子切换为线上
当前 release。本次只重启 `hospital-platform-api-v2.service`；旧 Python `8001` 保持监听，Worker
保持 `inactive`。

本次切换没有打开预约写入、支付、医保、退款、报告或 HIS 回写。新增的
`p0-business-evidence-audit.js` 已随候选 release 发布，用于防止把 readiness、HTTP 200 或页面
打开误判为真实业务成功。

## 1. 候选版本与 artifact provenance

候选以仓库 `main` 的提交 `b823727` 构建。本地产物与服务器上传后的 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `69e78e99b20cc52a0336610e71160e0c17e472e9f7ceb8e018fc6b5b0ba789c1` |
| `apps/worker/dist/index.js` | `e7494f7bb38f75f069131e12a785a716829a3f287c0d8ea017586ff85e0b5299` |
| `apps/worker/dist/preflight.js` | `896522efc1b11ddab11908814e86c86097b852f9ff69ec6d3e35cb1206b83078` |
| `apps/worker/dist/provider-directory-smoke.js` | `e2a5fdc85d59b2bfb6e8ec99d3480bf27f7f33d84f324c8bb0b2d83810d90046` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `98b3b857246259dd4a07bdf102e4245bfbb7faa0005c4acb449532677ada2327` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `e4b22e9e32e04cef38714b8fd64e493e7118128f323a932b62b8dee9f2355ec5` |

候选 release 只上传 bundle，没有在服务器执行 `bun install`、build 或 migration；服务器既有的
`shared/api.env` 权限仍为 `600`，没有复制到 release 或日志。

## 2. Preflight 与隔离 smoke

2026-08-17 23:13 CST 使用服务器 `shared/api.env` 执行候选 preflight：

- `environment=production`，runtime configuration 通过；
- 微信身份、患者目录、预约目录、预约历史和门诊费用为 `configured`；微信支付、报告目录和报告详情为
  `disabled`；
- MySQL、Redis 均为 `ok`；schema 为 `verified`，目标为 `0016_patient_directory_sync_owner_index`。

随后候选在 `127.0.0.1:18082` 以 production mode 启动，未接收公网流量。runtime smoke 通过：

- live：200；
- ready：连续 3/3 为 200；
- system ping：200；
- 未登录受保护路由：401 / `unauthorized`；
- 候选启动日志明确记录 `runtimeMode=production`、MySQL/Redis/schema 探针为 `ok`；
- smoke 完成后候选进程收到 SIGTERM，`18082` 已释放。

## 3. 原子切换与新旧服务共存

切换前 `current` 为 `bf67b9673708a6e5188880eba9a6d29b8e78f0c5`。切换时使用同一文件系统内的
`current.next -> current` 原子软链接替换，只重启新 API unit；失败分支会指回旧 release。

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/b823727` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001`，仍监听 |
| Worker | `inactive`，未启动 |
| 内网 live / ready / system ping | 200 / 200 / 200 |
| 公网 live / ready / system ping | 200 / 200 / 200 |
| 公网 ready 依赖 | database / redis / schema 均为 `ok` |
| 公网认证边界 | 受保护路由返回 401 / `unauthorized` |
| 候选端口 | `18082`，已释放 |

切换后的公网 runtime smoke 使用 `/api/v2` 连续检查 ready 3/3，通过 live、system ping 和认证边界；
没有触发真实微信登录、患者同步、预约 Provider、门诊费用 Provider、支付、医保或 HIS 写入。

## 4. 当前 release 低敏日志与业务证据门禁

从本次新 API 启动窗口聚合 journald，使用当前 release 内的 `p0-log-aggregate.js`：

```text
inputLines=28
parsedRecords=22
parseErrors=0
ignoredControlLines=5
httpStatusCounts: 200=13, 401=6
eventCounts: http.request.completed=13, http.request.failed=6, service.started=1,
service.stop.requested=1, service.stopped=1
domainCounts: infrastructure=22
providerRequestIdCount=0
```

针对 `appointmentRecords` 和 `outpatientPaymentRecords` 的 P0 业务证据审计均明确返回缺少
`requested` 与 `success`，不是代码成功，也不是业务失败；它只说明本次切换窗口没有有效微信业务请求
触发这两个页面。当前不能据此宣称“我的挂号”或门诊费用已经完成真实线上验收。

## 5. 回滚与下一步

若新 API 出现 ready 失败、公网路径异常、旧 `8001` 消失或出现无法解释的业务错误，应将
`current` 原子指回切换前的 `bf67b9673708a6e5188880eba9a6d29b8e78f0c5`，只重启
`hospital-platform-api-v2.service`，不停止旧 Python。

下一步需要在本次 `service.started` 之后，用有效微信会话在真机依次触发：登录/患者目录、切换就诊人、
我的挂号、门诊费用只读查询；再按页面结果、HTTP 状态/trace 和低敏 journald 三层证据逐项验收。支付、
医保、预约写入、退款和 HIS 回写继续最后处理。
