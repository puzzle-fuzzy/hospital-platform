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

## 4. 未完成的直接证据

- 没有执行真实患者的预约历史请求；不能证明未来预约、状态映射或爽约筛选。
- 没有执行真实患者的门诊待缴/已缴请求；不能证明金额、空列表和 tab 切换结果。
- 没有读取 Redis 会话 key 的 TTL 聚合；`expiresInSeconds` 仍不能替代 Redis `TTL` 证据。
- 没有执行数据库写入、Provider 写入、支付、医保授权、退款或 HIS 回写。
- 没有替代用户完成微信开发者工具或真机操作；本观察不改变 P0 验收表中的未验收状态。

## 5. 下一步

使用当前构建的小程序运行包，由受控微信账号在开发者工具或真机依次执行：患者选择 → 我的挂号 → 门诊缴费待缴 → 门诊缴费已缴；同时记录安全 `traceId`、HTTP 状态和服务端事件。任何 `persistence-temporarily-unavailable`、Provider 字段错误或患者上下文错配都停止该域验收，不降级为空列表，也不提前开放支付。
