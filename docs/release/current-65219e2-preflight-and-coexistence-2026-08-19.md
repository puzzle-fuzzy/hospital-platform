# `65219e2` 当前生产 preflight 与新旧服务共存复核

> 记录时间：2026-08-19 12:39 CST
>
> 本记录来自 `ps@192.168.112.172` 的只读 SSH 检查。它只证明当前新服务的运行前置和端口共存，
> 不把 readiness 或配置通过误写成微信、Provider、真机或临床业务已验收。

## 1. 当前版本与进程边界

| 检查项 | 结果 |
| --- | --- |
| 新 API release | `/home/ps/code/hospital-platform/current -> releases/65219e2` |
| 新 API unit | `hospital-platform-api-v2.service=active` |
| Worker unit | `hospital-platform-worker-v2.service=inactive` |
| 新 API 监听 | `10.0.0.3:18081`，Bun |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn |
| 旧项目 | 未修改、未停止、未重启 |

本次没有切换 `current`、重启任何 unit、执行 migration、清理 Redis 或写入业务数据库。

## 2. 生产 preflight

使用当前 release 的 `apps/worker/dist/preflight.js` 和服务器受控 `shared/api.env` 执行只读检查，
结果为 `runtime.preflight.succeeded`：

- `environment=production`；
- MySQL：`ok`；
- Redis：`ok`；
- schema：`verified`，预期 marker 为 `0016_patient_directory_sync_owner_index`；
- 微信身份：`configured`；
- 患者目录、预约目录、预约记录、门诊费用：`configured`；
- 微信支付、报告目录、报告详情：`disabled`。

`configured` 只表示配置字段和组合根准入完整，不表示上游权限、字段、状态或页面业务已通过。
支付和报告继续保持显式关闭是当前正确状态。

## 3. 内网与公网 readiness

- 内网 `http://10.0.0.3:18081/health/ready`：成功，`database/redis/schema=ok`；
- 公网 `https://test-hp.meiyi.pro/api/v2/health/ready`：成功，`database/redis/schema=ok`。

公网 `/api/v2` 是反向代理公共前缀；直接访问 18081 时使用服务自身的 `/health/ready` 路径，
不能把公网前缀重复拼到内网请求上。

## 4. 尚未升级的证据

本次没有注入 access token 或内部 `patientId`，因此没有执行 Provider directory smoke；也没有取得
当前 `b451cc6` 小程序的手机连接。以下事项仍需在同一版本组合中独立完成：

1. 微信真机登录、患者同步和第二位就诊人显式切换；
2. `patInfosFind.data.patId` 的当前业务请求与低敏 `providerRequestId` 对照；
3. 预约历史、爽约记录和门诊费用的 Provider / 公网 / 页面三层证据；
4. 报告 Provider 合同、二维码协议，以及最后的支付、医保和 HIS 回写专项验收。

任何一项只能证明基础 readiness，都不能替代上述业务证据；旧 Python `8001` 在新业务逐项验收前继续保持运行。

## 5. 最近业务日志窗口

使用 `65219e2` 自带的低敏 `p0-log-aggregate.js` 对 `hospital-platform-api-v2.service` 从
2026-08-19 12:39 CST 到当日 23:59 CST 的 journald 做只读聚合：

- 输入 3 行，成功解析 2 条，`parseErrors=0`；
- 仅有 2 条 `http.request.completed`，均属于 infrastructure，HTTP `200`；
- `systemdWarningCount=0`、`providerRequestIdCount=0`；
- 没有微信登录、患者目录、患者同步、预约记录、爽约或门诊费用业务事件。

这说明该时间窗口没有形成可供业务验收的真实请求链，不能据此推断“没有患者数据”或“业务返回空列表”，
也不能把两条 readiness/基础请求当成 Provider 或真机成功。下一步仍需在 `b451cc6` 小程序窗口生成新二维码并扫码，
再按页面、HTTP trace 和服务端业务事件三层对齐。

## 6. 追加只读日志观察（2026-08-19 12:58 CST）

在不注入会话、不读取原始日志内容的前提下，再次通过 SSH 核对 `65219e2` 当前进程和最近 30 分钟
的低敏日志聚合：

- `current` 仍指向 `releases/65219e2`；新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 继续同时监听；
- 内网与公网 readiness 均成功，`database/redis/schema` 均为 `ok`；
- 聚合输入 14 行，成功解析 13 条，`parseErrors=0`；包含 10 条 HTTP `200` 和 3 条 HTTP `404`，
  404 均归入 `NOT_FOUND` 基础设施结果；
- 业务域计数为 0，`providerRequestIdCount=0`，`systemdWarningCount=0`，没有患者目录、档案、预约或门诊费用事件。

本观察只说明当前窗口没有形成新的业务请求链；404 或 readiness 不能被解释为 Provider 空结果、患者不存在或业务失败。
本次没有重启 unit、切换 release、写入 MySQL/Redis、修改旧项目或调整权限。

## 7. Provider gate 与凭证状态（2026-08-19，SSH 只读核查）

服务实际读取的环境文件为 `/home/ps/code/hospital-platform/shared/api.env`。本次只输出开关和值是否存在，
没有读取或记录任何 secret 内容：

| 配置项 | 当前状态 |
| --- | --- |
| `ZHONGYANG_PATIENT_DIRECTORY_READY` | `true` |
| `ZHONGYANG_APPOINTMENT_DIRECTORY_READY` | `true` |
| `ZHONGYANG_APPOINTMENT_RECORDS_READY` | `true` |
| `ZHONGYANG_OUTPATIENT_PAYMENT_READY` | `true` |
| `ZHONGYANG_REPORT_DIRECTORY_READY` | `false` |
| `ZHONGYANG_REPORT_DETAIL_READY` | `false` |
| `ZHONGYANG_BASE_URL` | 已配置 |
| `ZHONGYANG_AUTHORIZATION_TOKEN` | 未配置 |
| `ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN` | 未配置 |

这里的“未配置”只表示当前新服务没有服务端专用 Provider Bearer；它不能证明所有上游接口都不需要鉴权，
也不能授权复制旧端用户 JWT。由于本次日志窗口没有 `providerRequestId`，患者同步、预约记录和门诊费用仍需
使用同一 release 在真机产生实际请求后分别验收。报告 gate 保持关闭是正确的 fail-closed 状态。

本节核查没有修改环境文件、重启服务或写入业务数据。

## 8. 继续窗口 SSH 只读复核

在后续重启/继续工作窗口中再次使用 `ps@192.168.112.172` 做只读检查：

- `current` 仍指向 `/home/ps/code/hospital-platform/releases/65219e2`；
- `hospital-platform-api-v2.service` 为 `active/running`；
- 新 Bun API 继续监听 `10.0.0.3:18081`；
- 旧 Python Gunicorn 继续监听 `0.0.0.0:8001`，未停止、未重启、未修改；
- 内网 `/health/ready` 返回 200，`database/redis/schema` 均为 `ok`；
- 新 API 近期日志仍明确 `environment=production`，匿名 `/me`、患者、预约历史和门诊费用请求均按预期 401，
  没有新的有效微信会话或 Provider 业务链。

本次没有执行 `systemctl restart/stop`、release 切换、migration、权限调整、数据库/Redis 写入或旧项目操作。

## 9. 重启恢复后再次只读复核（2026-08-19）

在继续工作窗口中再次通过 SSH 复核当前运行态，结果如下：

- `current` 仍指向 `/home/ps/code/hospital-platform/releases/65219e2`；
- `hospital-platform-api-v2.service` 为 `active/running`；
- 新 Bun API 继续监听 `10.0.0.3:18081`，旧 Python Gunicorn 继续监听 `0.0.0.0:8001`；
- 直接访问内网服务时，`/health/live`、`/health/ready` 和 `/api/v1/system/ping` 均返回 200；
- 通过公网反向代理访问 `/api/v2/health/live`、`/api/v2/health/ready` 和 `/api/v2/system/ping` 均返回 200，
  其中 readiness 的 `database/redis/schema` 均为 `ok`；
- 新 API 日志明确记录 `environment=production`。最近窗口只有基础探针和未登录请求，未形成新的微信登录、患者同步、预约记录或门诊费用 Provider 业务链。

直接访问 `18081` 时不能重复拼接公网 `/api/v2` 前缀；内网请求 `/api/v2/health/ready` 得到的 404 只是路径不匹配，
不能据此判断服务不可用。该次复核没有重启或切换任何服务，没有执行 migration、权限调整以及 MySQL/Redis 写入，旧 Python 项目保持不变。

## 10. 当前小程序验收包重新构建（2026-08-19）

在不修改 `apps/miniprogram/project.config.json` 的前提下重新执行原生小程序构建：

- `dist/build-info.json.sourceRevision` 仍为 `482288496c6de90ff86fb2f2eb54db3b9ae0bae5`，对应源码短提交 `4822884`；
- 生成 14 个 `app.json` 页面脚本，运行时来源校验通过；
- 小程序回归测试为 `162 pass / 0 fail / 1299 expects`；
- 当前只完成本地构建和来源校验，尚未把该 `dist` 上传/切换到微信开发者工具，也未形成新的手机扫码、页面、HTTP 或 Provider 业务证据。

后续真机验收必须先在开发者工具重新加载这份 `dist` 并生成新二维码；旧二维码或旧窗口的页面现象不能归因到本候选包。
