# 当前服务器 P0 只读观察（2026-08-17）

> 本文记录 2026-08-17 14:37 CST 通过受控 SSH 进行的只读运行核对。它只证明服务器监听、运行模式、依赖 readiness 和日志中是否出现业务事件，不替代微信开发者工具/真机操作，也不把 `configured` 当作 Provider 业务成功。

## 1. 观察范围

- 服务器：`192.168.112.172`
- 观察方式：受控 SSH 只读命令；未读取环境变量、密钥、Redis 原始 key 或数据库内容
- 观察时间：2026-08-17 14:37:38 CST
- 当前运行目录：`/home/ps/code/hospital-platform/releases/3ab0a6c`
- 当前 API 启动时间：2026-08-17 13:57:55 CST

## 2. 运行边界

| 检查项 | 观察结果 | 业务含义 |
| --- | --- | --- |
| 新 API | `10.0.0.3:18081` 监听且 active | 新服务仍通过独立端口运行 |
| 旧 API | `0.0.0.0:8001` 仍监听 | 本次未停止旧 Python 服务 |
| 运行模式 | `production` | 当前服务不是开发模式 |
| MySQL probe | `ok` | 依赖探针可用，不等于某个业务查询成功 |
| Redis probe | `ok` | 依赖探针可用，不等于已取得会话 TTL 证据 |
| schema probe | `ok` | schema gate 已通过 |
| 患者目录 | `configured` | 具备配置，不等于多患者/失效恢复已验收 |
| 预约历史 | `configured` | 具备配置，不等于真实预约历史已验收 |
| 门诊费用 | `configured` | 具备配置，不等于真实费用结果已验收 |
| 微信支付 | `disabled` | 支付调起仍保持关闭 |
| 报告目录/详情 | `disabled` | 当前不能把报告页面骨架当作真实 Provider 结果 |

## 3. 业务日志结论

在当前进程启动后的观察窗口内，日志出现了患者目录读取和同步事件，结果为单个脱敏目录项、活动患者和临床引用计数均为 1；没有观察到当前进程产生的 `appointment.records.*` 或 `outpatient.payment.records.*` 事件。

此前旧进程日志中的患者或登录事件不能与当前进程混合统计；日志筛选必须按当前 release 启动时间切分，否则会把旧版本行为误归因给当前版本。当前没有新的预约历史或门诊费用 HTTP/Provider/真机三层证据，因此这两个域仍是“代码已实现、真实业务未验收”。

### 14:50-14:51 CST 只读复核补充

- 当前 release 仍为 `/home/ps/code/hospital-platform/releases/3ab0a6c`；本地已推送的 `474c15c` 尚未部署，不能把本地报告故障隔离修正写成线上行为。
- 新 API 仍监听 `10.0.0.3:18081`，旧 Python API 仍监听 `0.0.0.0:8001`，systemd 服务保持 `active (running)`；未执行重启、切换或旧服务操作。
- 直接访问应用绑定地址的 `/health/ready` 和 `/health/live` 均返回 `200`、`Cache-Control: no-store`，依赖结果为 `database=ok`、`redis=ok`、`schema=ok`。
- 直接访问应用内部的 `/api/v2/health/*` 返回 `404`；这是预期的路径边界，`/api/v2` 由外层反向代理提供，内部应用路由使用无版本前缀的 `/health/*`。该结果不能作为公网路径验收证据。
- 以当前进程启动时间为边界筛选最近 60 分钟日志，仍未出现 `appointment.records.*`、`outpatient.payment.records.*` 或 `report.*` 业务事件。

### 15:39 CST 之后的当前 release 复核

后续只读观察以当前服务的 `service.started` 时间 `2026-08-17 15:39:39 CST` 为边界，
只保留事件名和聚合数量，不记录用户标识、操作 ID、Provider 患者号或 token：

| 事件 | 聚合数量 | 结论 |
| --- | ---: | --- |
| `auth.wechat.login.requested` / `auth.wechat.login.succeeded` | 各 1 | 当前 release 出现 1 次完整微信登录成功链，但不等于 Redis TTL 已验收 |
| `patient.directory.requested` / `operation.started` / `synced` | 各 3 | 出现 3 次患者目录同步成功链；当前仍只能证明观测到的账号/快照，不证明多患者切换或失效恢复 |
| `patient.directory.read.requested` / `read.loaded` | 各 6 | 患者读模型读取成功，观察到的目录数量为 1 |
| `appointment.records.*` | 0 | 未出现预约历史真实业务请求证据 |
| `outpatient.payment.records.*` | 0 | 未出现门诊费用真实业务请求证据 |
| `report.*` | 0 | 报告 gate 仍关闭，未出现报告 Provider 业务证据 |

同一窗口另有 7 次受保护 HTTP 请求返回 `401`，路径覆盖预约科室、预约记录、`/me`、患者、门诊费用和报告。
这些请求没有形成对应的业务事件，当前只能作为认证边界观察，不能解释为 Provider 失败，也不能替代有效 Bearer
会话下的预约或费用验收。

本次观察确认线上新旧服务仍共存、当时 release 为 `daee96d`；后续已切换到 `0b6f38f`，但 P0 仍只新增了单账号微信登录和患者目录的
低敏日志证据。下一步必须使用重新构建的原生小程序，在有效会话下依次进入“我的挂号”和“门诊缴费”并核对
HTTP、页面和服务端事件三层结果。

### 后续增量观察

上一节记录之后的受控 SSH 聚合又出现 1 次患者目录同步成功链和 2 次患者目录读取，预约历史、门诊费用和报告事件
仍为 0。该窗口没有改变当前结论：重复同步仍只观察到单账号目录事实，不能推出第二位患者、多患者切换、失效恢复、
预约状态映射或费用状态切换已经验收；Redis TTL 也仍未取得直接证据。

### 16:31 CST 运行边界复核

- systemd 仍显示 `hospital-platform-api-v2.service` 为 `active (running)`，当前 Bun 主进程为 `1266963`，工作目录解析到
  `/home/ps/code/hospital-platform/releases/daee96d`；旧 Python 服务仍监听 `0.0.0.0:8001`。
- 新 API 明确绑定 `10.0.0.3:18081` 而不是 `127.0.0.1:18081`；通过绑定地址访问 `/health/live` 和 `/health/ready` 均为
  `200`，readiness 返回 `database=ok`、`redis=ok`、`schema=ok`。对回环地址的连接拒绝是监听地址边界，不是依赖故障。
- 当前进程日志再次看到完整微信登录成功事件；预约科室、预约记录和门诊费用请求均返回 `401 unauthorized`，没有进入
  appointment/provider 或 outpatient-provider 业务事件。因此这批请求只能证明认证边界，不能证明预约历史或费用 Provider 已联通。
- 本次仅做 SSH 只读检查：未修改 env、数据库、Redis、systemd、旧 Python 服务或线上 release，也未读取 token、密钥、Redis 原始 key
  或患者正文。

### 16:40 CST 当前 release 切换后复核

`0b6f38f` 切换后的新观察窗口以当前 `service.started` 为起点。受控 SSH 读取
`journalctl -u hospital-platform-api-v2.service -o cat`，再交给 P0 安全聚合工具，结果如下：

| 聚合项 | 数量 | 结论 |
| --- | ---: | --- |
| `service.started` | 1 | 当前进程以 production 模式启动，MySQL/Redis/schema readiness 通过 |
| `http.request.completed` / HTTP 200 | 13 | 仅包含运行探针和系统探针成功 |
| `http.request.failed` / HTTP 401 | 6 | 未登录认证边界符合预期，不能视为 Provider 失败 |
| `auth.wechat.*` | 0 | 当前 release 切换后没有新的微信登录业务请求 |
| `patient.directory.*` | 0 | 当前窗口没有新的患者目录读取或同步请求 |
| `appointment.*` | 0 | 当前窗口没有预约历史/预约目录业务请求 |
| `outpatient.payment.*` | 0 | 当前窗口没有门诊费用业务请求 |
| `report.*` | 0 | 报告 gate 仍关闭 |

本窗口同时确认 `/home/ps/code/hospital-platform/current` 指向
`/home/ps/code/hospital-platform/releases/0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185`，新 API
`10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 均保持监听。上述日志只证明当前 release 的运行和认证边界，
不改变微信会话、Redis TTL、患者切换、预约历史、门诊费用和真机三层验收仍未完成的结论。

### 16:40 CST 之后的增量业务观察

本次受控 SSH 只读窗口仍从 `journalctl` 读取结构化日志，并只输出安全聚合计数；窗口内没有读取 token、
患者正文、Provider 原文或 Redis 原始 key：

| 聚合项 | 数量 | 结论 |
| --- | ---: | --- |
| `auth.wechat.login.requested` / `auth.wechat.login.succeeded` | 各 1 | 观察到 1 次完整微信登录业务链，但仍未证明 Redis 实际 TTL |
| `patient.directory.read.requested` / `read.loaded` | 各 3 | 观察到 3 次患者读模型读取成功，不证明多患者切换、失效或恢复 |
| `appointment.records.requested` / `appointment.records.synced` | 各 1 | 已进入预约历史同步链并产生 Provider 关联证据；仍需页面结果、状态映射和有效会话三层核对 |
| `outpatient.payment.records.requested` / `loaded` | 各 1 | 已进入门诊费用只读链；仍需核对待缴/已缴、金额、空列表和页面 tab 结果 |
| `report.*` | 0 | 报告 gate 仍关闭，没有报告 Provider 业务证据 |
| HTTP 200 / HTTP 401 | 19 / 7 | 7 次仍是未登录认证边界，不能解释为 Provider 失败 |
| `providerRequestId` | 3 | 仅证明有可关联的 Provider 请求证据，不代表业务字段已完成验收 |

本窗口确认当前 release 仍为 `0b6f38f`，新 Bun API `18081` 与旧 Python API `8001` 同时监听；旧服务保持
`inactive` 的 systemd 单元状态不等于旧 Python 进程停止，实际监听仍在，未执行重启、切换或旧服务操作。
当前结论从“完全没有预约/费用业务事件”更新为“已取得预约历史和门诊费用的低敏业务事件”，但 P0 仍不能标记
为完成：页面结果、患者上下文、Provider 字段/状态映射和真机证据尚未闭环，支付、医保、退款和 HIS 写回继续关闭。

## 4. 未完成的直接证据

- 没有执行真实患者的预约历史请求；不能证明未来预约、状态映射或爽约筛选。
- 没有执行真实患者的门诊待缴/已缴请求；不能证明金额、空列表和 tab 切换结果。
- 没有读取 Redis 会话 key 的 TTL 聚合；`expiresInSeconds` 仍不能替代 Redis `TTL` 证据。
- 没有执行数据库写入、Provider 写入、支付、医保授权、退款或 HIS 回写。
- 没有替代用户完成微信开发者工具或真机操作；本观察不改变 P0 验收表中的未验收状态。

## 5. 下一步

使用当前构建的小程序运行包，由受控微信账号在开发者工具或真机依次执行：患者选择 → 我的挂号 → 门诊缴费待缴 → 门诊缴费已缴；同时记录安全 `traceId`、HTTP 状态和服务端事件。任何 `persistence-temporarily-unavailable`、Provider 字段错误或患者上下文错配都停止该域验收，不降级为空列表，也不提前开放支付。

### 17:40 CST 当前 release 增量观察

2026-08-17 17:40 CST 通过 SSH 再次只读核对：`current` 仍指向
`0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185`，systemd active 时间为 16:40:29 CST，
新 API `10.0.0.3:18081` 和旧 Python `0.0.0.0:8001` 同时监听。本次从当前 Bun 进程启动后开始读取
journald，并只输出事件名、状态码和数量；没有读取 env、token、Redis 原始 key、数据库患者正文或 Provider 原文。

| 聚合项 | 数量 | 结论 |
| --- | ---: | --- |
| `service.started` | 1 | 当前进程启动事件存在 |
| `auth.wechat.login.requested` / `succeeded` | 各 1 | 观察到 1 次完整微信登录事件链，Redis TTL 仍未直接验证 |
| `patient.directory.requested` / `synced` | 各 5 | 观察到患者目录同步事件，但仍不能推出多患者或失效恢复正确 |
| `patient.directory.read.requested` / `read.loaded` | 各 13 | 观察到患者读模型读取，不能证明页面当前患者没有串读 |
| `appointment.records.requested` / `synced` | 各 1 | 预约历史已经进入业务链，仍缺页面结果和状态字段核对 |
| `outpatient.payment.records.requested` / `loaded` | 各 1 | 门诊费用已经进入只读链，仍缺待缴/已缴、金额和空列表核对 |
| `report.*` | 0 | 报告 gate 继续关闭 |
| HTTP 200 / HTTP 401 | 37 / 7 | 401 只能证明未登录边界，不能解释为 Provider 失败 |
| 去重后的 `providerRequestId` 数量 | 8 | 仅证明存在可关联请求号，不证明字段、状态或金额正确 |

这次观察把预约历史和门诊费用从“当前窗口没有业务事件”推进到“已进入当前 release 的只读业务链”，
但不改变 P0 未验收结论。下一步必须用重新构建的小程序在有效会话下逐页核对页面数据、请求状态和对应
trace；如果出现患者上下文错配、Provider 字段不完整或依赖暂不可用，应停止该域验收，不降级为空列表。

### 18:23 CST 当前 release 增量观察

2026-08-17 18:23 CST 通过受控 SSH 对当前线上进程做了再次只读核对。当前目录解析为
`/home/ps/code/hospital-platform/releases/5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c`，
systemd 主进程 PID 为 `1838242`，启动时间为 17:55:17 CST；新 Elysia 仍监听
`10.0.0.3:18081`，旧 Python 仍监听 `0.0.0.0:8001`。本次没有读取 env、token、Redis 原始 key、
数据库患者正文或 Provider 原文，也没有执行重启、切换或写入。

从当前 API journald 的最近 30 分钟窗口只输出事件名和有限数量字段，结果如下：

| 聚合项 | 数量 | 结论 |
| --- | ---: | --- |
| `service.started` | 1 | 当前进程以 production 模式启动；线上 release 已固定为 `5f5915e` |
| `auth.wechat.login.requested` / `succeeded` | 各 1 | 出现 1 次完整微信登录链；`expiresInSeconds` 仍不能替代 Redis 实际 TTL |
| `patient.directory.requested` / `operation.started` / `synced` | 各 7 | 出现 7 次患者目录同步成功链；不能据此推出第二位患者、并发幂等或失效恢复正确 |
| `patient.directory.read.requested` / `read.loaded` | 各 14 | 患者读模型读取成功；当前观测到的目录数量为 1 |
| `appointment.*` | 0 | 本窗口没有预约历史/预约目录事件，不能完成页面、Provider 和真机闭环 |
| `outpatient.payment.*` | 0 | 本窗口没有门诊费用事件，不能证明待缴/已缴、金额或空列表语义 |
| `report.*` | 0 | 报告 gate 继续关闭 |
| `http.request.completed` / `http.request.failed` | 40 / 7 | 只能作为 HTTP 事件总量观察；未把失败请求猜成 Provider 失败或具体业务错误 |

本次观察只把当前 release 的“微信登录/单患者目录同步”证据更新到 18:23 CST，不更新预约历史、门诊费用、
报告、Redis TTL、真机视觉或多患者验收状态。下一步仍应由有效微信会话导入最新小程序运行包，按
“患者选择 → 我的挂号 → 门诊缴费待缴/已缴”顺序逐页记录页面结果、HTTP 状态和 trace；任何患者上下文错配、
Provider 字段缺失或依赖暂时不可用都必须停止该业务域，不把异常降级为空列表。

### 18:53 CST 门诊费用双状态只读复核

2026-08-17 18:52-18:53 CST 在当前原生小程序运行包中，从首页进入“门诊缴费”，先观察默认“待缴费”，
再切换到“已缴费”。开发者工具页面显示当前已选择的脱敏就诊人、双标签和只读空态，调试器 `Errors: 0`；
没有执行支付调起或医保授权。

当前 API journald 观察到两条完整只读链：

| 状态 | 业务事件 | HTTP | `itemCount` | 查询窗口 |
| --- | --- | ---: | ---: | --- |
| `unpaid` | `outpatient.payment.records.requested` → `loaded` | 200 | 0 | `2026-07-18 18:53` 至 `2026-08-17 18:53` CST |
| `paid` | `outpatient.payment.records.requested` → `loaded` | 200 | 0 | `2026-07-18 18:53` 至 `2026-08-17 18:53` CST |

两次查询都通过当前患者的 owner-scoped `his-patient` 映射后才进入 Provider，空数组被页面分别展示为
“未查询到待缴费记录”和“未查询到已缴费记录”。本次只记录了事件、状态、数量和时间窗口，没有写入姓名、卡号、
内部患者标识、token 或 Provider 原始报文；详细页面/服务端对照见
[`门诊缴费只读验收记录`](outpatient-payment-readonly-acceptance-2026-08-17.md)。

这次把门诊费用从“没有真实业务事件”推进为“待缴/已缴空列表已取得页面、HTTP、Provider 事件三层证据”。
仍不能把空列表解释为费用功能全部完成：非空金额记录、第二位就诊人、失效恢复、Redis TTL、费用详情、支付、医保、
退款和 HIS 回写均未验收，支付与医保 gate 继续关闭。
