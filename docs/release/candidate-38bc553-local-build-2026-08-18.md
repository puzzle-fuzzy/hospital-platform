# `38bc553` 本地候选构建记录（2026-08-18）

本文记录微信身份边界修复后的候选构建、服务器隔离验证和无损切换结果。它不等于真实业务验收：支付、医保、报告、HIS、真机和 Redis TTL 仍有独立门禁。

## 1. 候选身份

| 项目 | 值 |
| --- | --- |
| Git 提交 | `38bc553`（`收紧微信身份交换边界`） |
| 完整来源提交 | `38bc553395f07c017446ee2539677431c6835f13` |
| 当前线上 release | `38bc553`；切换前为 `c63dba9` |
| 旧 Python 服务 | 继续使用 `8001`，本次未操作 |
| 小程序页面数 | 14 |
| 小程序构建时间 | `2026-08-18T04:59:23.635Z`（见 `apps/miniprogram/dist/build-info.json`） |

本次服务端修改只收紧微信 `code2session` 返回的 `openid/unionid` 边界：非字符串、去除首尾空白后为空、含控制字符或超过 128 个 Unicode 字符时整次身份交换失败；不会改变 API 响应结构、数据库 schema、旧服务或线上环境变量。

## 2. 本地验证

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 9/9 package 成功；生成 API、Worker、维护脚本和小程序 `dist/` |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；14 个页面脚本和根文件齐全 |
| 小程序测试 | 108 项通过，952 个断言 |
| 适配器测试 | 75 项通过，168 个断言 |
| 全量 API 测试 | 114 项通过，528 个断言 |
| 全仓类型检查 | 9/9 package 成功 |
| 工具门禁 | 10 项通过，38 个断言 |
| 文档链接审计 | 139 份文档，无断链 |

## 3. 产物 SHA-256

以下摘要来自本地 `pnpm build`，上传到服务器后必须逐文件复核；服务器不能在 release 目录重新安装 workspace 依赖或重新构建来替代 checksum。

```text
apps/api/dist/index.js 6439602bb8ef0b4e5dcf22392d3d16bc242378ae7ddf93e605ea860a88d562af
apps/worker/dist/index.js 3e1c39ca8f09570ea2e0f85c848a8c8b6169f07132b4f49204a806cb80badef9
apps/worker/dist/preflight.js a2fc8cdb460671f19e7a8a75167ace220bac4ba5c458f9266b518fab7a389284
apps/worker/dist/provider-directory-smoke.js 3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d
apps/worker/dist/api-runtime-smoke.js 1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3
apps/worker/dist/p0-log-aggregate.js 5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1
apps/worker/dist/p0-business-evidence-audit.js ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907
apps/worker/dist/redis-session-ttl-audit.js 3f8190fb7acc75a41fb2be12181ad9eb99cafc2302f7044a157452228d4fcd70
```

## 4. 服务器候选上传与隔离验证

2026-08-18 13:03 CST，使用用户此前授权的交互式 SSH 方式，将 8 个 bundle 上传到：
`/home/ps/code/hospital-platform/releases/38bc553`。本机没有可用 SSH 公钥，BatchMode 仍返回
`Permission denied (publickey,password)`；本次没有修改 SSH、sudoers、旧服务或服务器环境变量。

候选上传后使用服务器既有 `shared/api.env` 执行 production preflight，结果为通过：

- `environment=production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；微信支付、报告目录和报告详情继续为 `disabled`；
- MySQL、Redis、schema 均为 `ok`，schema 为 `0016_patient_directory_sync_owner_index`。

2026-08-18 13:05 CST，在 `127.0.0.1:18082` 启动候选 API 做隔离 runtime smoke，结果为通过：

- live `200`；
- readiness 连续 3 次 `200`；
- system-ping `200`；
- 所有未登录保护路由均返回 `401 unauthorized`；
- 临时进程收到 `SIGTERM` 正常退出，`18082` 端口已释放。

隔离 smoke 阶段 `current` 仍为 `/home/ps/code/hospital-platform/releases/c63dba9`。随后在 2026-08-18 13:07 CST
按 runbook 原子切换到 `/home/ps/code/hospital-platform/releases/38bc553`，只重启
`hospital-platform-api-v2.service`。切换后新 API `18081`、旧 Python `8001` 仍同时监听，内网和公网 readiness 均为
`200`，启动日志明确记录 `runtimeMode=production`、auth ready、MySQL/Redis/schema `ok`；8 个远端 bundle 文件均存在，
且 SHA-256 与本节前的本地记录一致。

## 5. 切换后低敏日志与 TTL 边界

切换后从 `13:07 CST` 起使用当前 release 的 `p0-log-aggregate.js` 读取 journald JSON，聚合结果为：

- `inputLines=12`、`parsedRecords=6`、`parseErrors=0`、`systemdWarningCount=0`；
- 仅包含服务启动/停止和 3 次 HTTP 200 健康请求，没有预约历史、门诊费用或报告业务事件；
- `appointmentRecords` 与 `outpatientPaymentRecords` 证据门禁均明确缺少 `requested/success`，因此不能标记为业务成功；
- 当前 release 的 Redis TTL 审计返回固定 `redis-session-scan-unavailable`、退出码 `2`，没有输出 key、凭证或修改 Redis；
  常驻 API ACL 仍未授予独立维护账号所需的 `SCAN/TTL` 只读权限。

2026-08-18 13:20 CST 的增量 SSH 只读观察仍指向 `38bc553`：新 API `10.0.0.3:18081` 与旧 Python `8001` 同时监听，
systemd 为 `active`，内网 readiness 返回 database/redis/schema 全部 `ok`。从切换起聚合 `inputLines=15`、
`parsedRecords=9`、`parseErrors=0`、`systemdWarningCount=0`，事件只有服务启停和 6 次 HTTP 200 健康请求，
`domainCounts` 只有 `infrastructure`，`providerRequestIdCount=0`；因此当前窗口仍没有微信、患者、预约历史、门诊费用或报告业务事件。
该结果只能证明运行层稳定和业务请求未进入，不能被解释为任何业务的成功空列表。

2026-08-18 13:24 CST 的重启后只读复核确认 `hospital-platform-api-v2.service` 已恢复为
`active/running`，`current` 仍指向 `/home/ps/code/hospital-platform/releases/38bc553`；服务启动时间为
`13:07:26 CST`。新 API 内网 `/health/live` 返回 `200`，公网 `/api/v2/health/live`、
`/api/v2/health/ready` 和 `/api/v2/system/ping` 均返回 `200`，ready 的 database/redis/schema 仍为 `ok`。
对旧端 `127.0.0.1:8001/` 只做 GET 监听探针，返回 `404`，仅证明旧端口仍有 HTTP 响应，不把根路径 404 当作旧业务成功；
本次未修改、停止或重启旧 Python 服务，也未修改数据库和环境变量。

2026-08-18 13:47-13:50 CST 的增量观察来自当前配对的微信开发者工具模拟器：预约科室目录请求/成功各 1 次，返回
`itemCount=61`；排班目录请求/成功各 1 次，返回 `itemCount=1` 且短期排班快照持久化成功；患者目录读取请求/成功各 2 次，
其中一次返回 `itemCount=1`；普通资料读取请求/成功各 2 次，均为 `persisted=false`。这些事件证明当前 release 已进入
预约目录、排班、患者目录和普通资料的只读服务链路，但仍不是微信真机证据，也不能推断有第二位患者、非空费用、资料写入、
预约写入或支付成功。本窗口没有预约锁号、预约提交、取消、微信支付、医保授权、退款或 HIS 回写事件。

同一只读窗口再次确认新 API 监听 `10.0.0.3:18081`、旧 Python 监听 `0.0.0.0:8001`，服务为 `active/enabled`，当前 release
仍为 `38bc553`；公网 `/api/v2/health/ready` 的 database/redis/schema 均为 `ok`，公网 `/api/v2/system/ping` 返回成功。
内网业务前缀使用 `/api/v1`，本轮仅用 `/api/v1/system/ping` 做入口探针。以上全部是读取和日志观察，没有执行服务器写入、切换或重启。

2026-08-18 14:03-14:06 CST 的配对模拟器观察进入了“我的挂号”只读链路：公网 `records` 请求返回 `200`，响应
`data.total=60`。抽样展开的记录状态为服务端已归一化的 `cancelled`，因此“在线挂号”按旧端规则排除已取消记录后展示
“暂无挂号记录”是符合当前数据和筛选规则的结果，不是把 Provider 返回的 60 条记录静默丢失。当前“全部挂号”仍保持
不可用提示，因为 `requestChannel=4` 尚未取得独立 Provider contract；不能用 `requestChannel=3` 的结果冒充全部渠道。
本轮没有点击挂号卡、预问诊、取消、退号或任何写入入口。

2026-08-18 14:07 CST 的门诊缴费只读观察完成了两个状态：

| 页面状态 | 服务端事件 | HTTP/结果 | 页面结果 |
| --- | --- | --- | --- |
| 待缴费 | `outpatient.payment.records.requested` → `loaded` | `200` / `itemCount=0` | 展示“未查询到待缴费记录” |
| 已缴费 | `outpatient.payment.records.requested` → `loaded` | `200` / `itemCount=0` | 展示“未查询到已缴费记录” |

页面同时明确提示当前只开放费用查询，支付、退费、医保授权、医保结算和 HIS 回写仍待正式业务契约验收后开放。
本轮没有点击费用详情、支付调起、医保授权或结算按钮；因此这两项只证明了患者上下文和费用空列表读模型，不证明真实支付链路。

模拟器调试器仍显示微信开发者工具内部的 `undefined is not iterable` / `WAServiceMainContext` 渲染层错误，未出现小程序业务源码
调用栈；该错误不能被当前页面的 `200` 业务响应掩盖，也不能在没有真机复现和官方运行时定位前擅自改动业务逻辑。

2026-08-18 14:08-14:13 CST 继续观察“爽约记录”：服务端请求窗口为中国标准时间过去 90 天（`2026-05-20` 至
`2026-08-18`），`appointment.records.requested` → `appointment.records.synced` 返回 `itemCount=58`，HTTP 为 `200`。
页面最终展示“暂无爽约记录”，与客户端只筛选服务端归一化 `missed` 的规则一致；没有把已取消、已完成或未知状态推断为爽约。
本次也发现该页源码缺少患者卡、标题、空态和底部说明的页面级 WXSS，已在 `9ef8c85` 补齐中文注释和样式边界；本机
`dist/` 已重新构建且通过 108 项小程序测试，但当前开发者工具仍缓存旧页面样式，需重新打开/清理该项目后再做最终视觉截图。
这不影响本轮已取得的 HTTP/日志结论，也不应被误报为真机验收。

## 6. 当前仍未完成的验收

- 尚未进行有效微信会话下的真机登录、患者切换、预约历史/爽约、门诊费用或普通资料读写验收；当前客户端必须使用来源指纹为
  `38bc553395f07c017446ee2539677431c6835f13` 的 `dist/`，不能继续使用旧的 `1697695` 包。
- Redis TTL 仍未通过独立维护 ACL 验证；支付、医保、退款、报告和 HIS 继续关闭。

下一次发布必须同时保存候选目录、产物 checksum、production preflight、隔离 runtime smoke、旧 `8001` 监听和公网 ready 证据，具体命令以 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 为准。
