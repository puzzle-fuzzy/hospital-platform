# `c8eef370` 新 API 生产切换与只读业务验收准备

> 本文记录 2026-08-21 19:36–19:44 CST 在阿里云中转内网服务器上的真实发布证据。
> 本次只切换新 Bun/Elysia API 的低敏读模型失败日志字段；旧 Python 服务、旧端口、数据库 schema、Redis、支付、医保和 HIS 写回不在变更范围内。

## 1. 版本和共存边界

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 新 API release | `5a31427` | `c8eef370c82e358205ee032af41ba2b23576af06` |
| 新 API 监听 | `10.0.0.3:18081` | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` | `0.0.0.0:8001`，监听和进程 PID 未改变 |
| Worker unit | `inactive` | `inactive` |
| 小程序运行包 | 另行构建 | 本地候选来源 `f488c6f3270514af10b19fdf3c45a47519e1736b`，本次未上传线上，真机前必须重新编译并核对来源 |

切换前只读检查确认旧 `current` 为 `releases/5a31427`，新 API、旧 Python 均在监听，
内网 readiness 为 200。切换仅使用同目录 `current.next -> current` 原子替换，并只执行
`sudo -n systemctl restart hospital-platform-api-v2.service`。

## 2. 本次代码变化

`apps/api/src/plugins/request-logging.ts` 补齐普通资料、身份、患者、预约、报告和门诊费用
读模型异常到 HTTP `http.request.failed` 的固定 `readModelViolation` 映射。日志只保留有限原因，
不记录 userId、患者姓名、证件、卡号、资料正文或 Provider 原始报文。

对应回归测试覆盖普通资料和微信身份读模型错误；当前 API 全量测试、类型检查、Biome 和全仓库门禁均通过。
本次没有修改 Provider adapter、业务查询参数、患者归属、金额精度、支付、医保或预约写入语义。

## 3. 产物校验和生产 preflight

候选目录为 `/home/ps/code/hospital-platform/releases/c8eef370`。远端 SHA-256 与本地构建产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `ad482763813c4148d625c517ff136eab0d7dc682e2dc86ec1782c2b6c867c676` |
| `apps/worker/dist/index.js` | `afcef1a853e00b691b5e401e97d7a163a4a864457da2a4615022c78ba4c44858` |
| `apps/worker/dist/preflight.js` | `51454ea50b75c2431da63f304e875f251d596b078c96dcff3cd4cf546ee284c7` |
| `apps/worker/dist/provider-directory-smoke.js` | `ac37bb643d15c0af796965ef2440a13c01b6b118d14ca1ca8555d5eee341e61a` |
| `apps/worker/dist/api-runtime-smoke.js` | `929f1c6043a0d5a9aafb2a1745da05251c4b4041c6aa020c64360243c45de78f` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746b` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `bfba4e9c571d5cef543aea487c25bf10d12fddaffe1706d58cd96b964d26272b` |

使用服务器现有 `shared/api.env` 执行候选 production preflight，结果为 `runtime.preflight.succeeded`：

- runtime environment 为 `production`；
- MySQL、Redis、schema 均为 `ok`，schema 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用为 configured；
- 微信支付、报告目录和报告详情保持 disabled。

preflight 只读，不执行 migration、不启动 Worker、不调用 Provider，也不创建患者或费用业务数据。

## 4. 隔离 runtime smoke

候选使用真实生产环境在 `127.0.0.1:18082` 独立启动，未接收公网流量。使用同一 release 的 smoke bundle 完成：

| 检查 | 结果 |
| --- | --- |
| health live | HTTP 200，passed |
| health ready | HTTP 200，连续 3/3 passed |
| system ping | HTTP 200，passed |
| auth boundary | HTTP 401，passed |
| closed boundary | HTTP 404，passed |

smoke 完成后候选进程已按 PID 回收，`18082` 没有作为线上入口保留。

## 5. 切换后运行验收

切换后只读核对结果：

- `current -> /home/ps/code/hospital-platform/releases/c8eef370`；
- `hospital-platform-api-v2.service=active`，Worker=`inactive`；
- 新 API 启动日志为 `runtimeMode=production`，并记录 database/Redis/schema probe 为 `ok`；
- 内网 `http://10.0.0.3:18081/health/ready` 返回 200；
- 公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 200；
- 新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听。

本次发布没有发送微信登录、患者同步、预约、门诊费用、医保或支付业务请求，因此还没有产生
当前 `c8eef370` 的真机三层业务证据。

2026-08-21 19:44–19:46 CST 的当前 release 低敏日志观察为 `parsedRecords=0`、`parseErrors=0`、
`eventCounts={}`，没有新的业务请求。桌面只读检查发现微信开发者工具中可操作的窗口仍是旧项目
`mp-weixin`；另一个标题为 `miniprogram` 的窗口条目句柄已失效，刷新后无法取得，因而没有操作旧项目或
将该窗口的状态当作新项目验收证据。需要重新打开 `apps/miniprogram/` 并普通编译后再生成二维码。

## 6. 下一步真机验收准入

开发者工具必须重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\`，普通编译后确认运行包中：

- `dist/build-info.json` 的 `sourceRevision` 与本次小程序候选一致；
- 14 个页面入口均存在；
- `dist/services/single-flight.js` 存在；
- `dist/` 中不存在 `*.test.js` 或 `*.spec.js`。

然后用新二维码按以下顺序采集页面结果、客户端 `/api/v2` 的 requestId/traceId 和当前 `c8eef370`
服务端低敏日志：微信登录、患者目录、显式更换就诊人、我的挂号、爽约记录、门诊费用只读页。
任一患者归属、状态、金额、来源或 trace 不一致，立即停止该业务域。

报告 Provider、全部挂号 `requestChannel=4`、预约写入、患者绑定、支付、医保授权/6202/6301、退款和 HIS 回写继续关闭。

## 7. 回滚边界

若新 API readiness、公网路径或只读业务出现无法解释的异常，只将 `current` 原子切回
`releases/5a31427` 并只重启 `hospital-platform-api-v2.service`；禁止停止旧 Python、删除 release、清空 Redis 或回滚 schema。
