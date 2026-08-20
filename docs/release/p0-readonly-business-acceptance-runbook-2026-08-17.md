# P0 只读业务验收手册（2026-08-17）

> 本手册用于当前 `0e360d3` 服务端与配套小程序候选的真实微信小程序验收。小程序运行包来源指纹必须为
> `3a6bf3ea3d2b8944e05ffcad254a37afdbca2aab`（当前本地候选 `3a6bf3e`，尚未上传线上）。它覆盖微信登录、普通资料、患者上下文、预约目录/历史、报告目录/LIS 详情、爽约记录和门诊费用只读查询；不包含预约下单、微信支付、医保结算、退款或 HIS 写入，也不开放二维码协议。
>
> `configured` 只表示环境变量和组合根依赖齐全，不表示 Provider 权限、接口字段或真实业务已经验收。每个域必须同时具备真机操作、HTTP 响应和服务端日志三类证据，缺一不可。

> 当前报告目录和 LIS 详情的真实 Provider 读取仍未开放：`ZHONGYANG_REPORT_DIRECTORY_READY=false`、
> `ZHONGYANG_REPORT_DETAIL_READY=false`。因此本手册对报告域只允许验收 fail-closed 文案、HTTP 边界和日志边界，
> 不应期待真实报告数据或把页面成功/HTTP 200 当成报告迁移完成；真实只读验收必须等 Provider contract、字段白名单和门禁变更完成后另行执行。

普通资料的首次读取、版本更新和 409 并发冲突，按
[`普通资料真机与日志验收手册`](user-profile-readonly-device-acceptance-2026-08-18.md)执行；它不能被一次保存成功 Toast 或单元测试替代。

## 1. 当前前置条件

| 项目 | 验收基线 |
| --- | --- |
| 线上 release | `0e360d3` |
| 新 API | `hospital-platform-api-v2.service`，公网入口 `/api/v2` |
| 旧 API | Python 服务继续保留在原端口，不能因为本手册重启或修改 |
| 小程序运行目录 | `apps/miniprogram/dist/`；先执行 `pnpm --filter @hospital/miniprogram build`，开发者工具导入包含 `project.config.json` 的小程序目录，并确认 `miniprogramRoot` 为 `dist/` |
| 数据范围 | 只读取当前微信账号 owner 下面的脱敏患者目录和 Provider 只读摘要 |
| 证据时间 | 记录中国标准时间，并以同一时间窗口筛选 API journald |

### 1.1 真机开始前的门禁

1. `health/live` 返回 API 存活只能说明进程响应；真实业务前还要确认 `health/ready` 的 database、Redis 和 schema 均为 `ok`。
2. 如果出现 `persistence-temporarily-unavailable`，停止后续业务操作，先记录 request id/trace id；不能通过重复点击把依赖抖动伪装成业务失败。
3. 如果小程序显示“请先登录”，先完成微信登录，再进入患者选择页；不能把本地缓存的旧患者卡片当作当前会话证明。
4. 每次患者同步都使用新的幂等键；相同幂等键的重试用于验证 replay，不用于模拟新的业务操作。

## 2. 业务不变量

### 2.1 微信登录与会话

- 小程序只调用 `wx.login`，只向新 API 提交一次性 `code`。
- `openid`、`unionId`、`session_key`、AppSecret 和 Redis access token 不进入小程序响应、页面、日志或文档证据。
- 登录响应只包含平台 `accessToken`、过期秒数和内部用户 id；`/me` 必须能用同一 Bearer 会话恢复。
- Redis 会话必须带 TTL；API 响应中的 `expiresInSeconds=3600` 不是 Redis `TTL` 命令的替代证据。
- Redis 读取失败应该表现为依赖暂不可用（HTTP 503 对应安全错误码），不能被误报为“登录状态已失效”（HTTP 401）。

### 2.2 患者上下文与切换

- 患者列表必须由当前服务端会话 owner 返回；小程序不能提交 `ownerUserId`、unionId、完整身份证号、完整就诊卡号或 Provider 患者号。
- 首次没有本地选择时可以默认目录第一位患者；已有选择但该患者从最新目录消失时必须进入 `stale`，不能静默切换到第一位。
- 从患者选择页显式点击患者后，后续预约历史、爽约记录、报告和门诊费用请求必须使用新的内部 `patientId`。
- 患者同步重复返回同一 Provider 患者时，数据库必须保留原平台内部 patient id；不能每次同步都生成新 id，导致本地选择和业务链接失效。
- 目录完整快照缺少临床 `his-patient` 引用时，旧临床映射必须失效；预约、报告和费用不能继续复用旧 patId。
- 选择页返回后，各业务页要重新读取当前 owner 的患者目录；不能只比较本地 patient id 或沿用上一位患者的费用/记录。

### 2.3 我的挂号与爽约记录

- “我的挂号”查询窗口是中国标准时间当前日期前 90 天至后 90 天，不能只查过去而漏掉未来预约。
- “爽约记录”只查询当前日期前 90 天，并且只筛选服务端已归一化的 `status=missed`。
- `unknown`、空列表和 Provider 未返回完整历史都不能被猜测为爽约。
- 预约历史只读；没有预约写入、锁号、取消或支付授权时，页面不能把排班摘要显示成已预约成功。

### 2.4 门诊费用

- 门诊费用只读接口必须携带当前内部 `patientId` 和明确的 `unpaid`/`paid` 状态。
- 服务端根据 owner + patient id 解析临床 `his-patient` 引用；小程序不能提交 patId。
- 待缴费和已缴费必须使用用户点击时的状态快照发起查询，不能因为异步 `setData` 尚未完成而查询上一个 tab。
- 金额只作为 Provider 返回的只读摘要展示；未完成微信支付、医保授权、结算终态和退款契约前，点击记录必须显示迁移提示，不得调起真实支付。

### 2.5 普通资料

- 普通资料只处理昵称、性别、年龄、邮箱和服务端 `version`；不等同于实名资料、手机号、微信身份或患者档案。
- `GET /me/profile` 在没有资料行时返回安全默认值，但不能因为读取默认值就创建持久化副作用。
- `PUT /me/profile` 必须携带当前读取到的 `version`；版本过期必须返回 `409 user-profile-conflict`，客户端不能静默覆盖或自动重试旧正文。
- 两个微信会话的资料必须完全 owner 隔离；更新用户 A 不能改变用户 B 的资料卡，也不能把用户 A 的昵称返回给用户 B。
- 资料更新日志只保留字段数量、版本和 trace 等低敏元数据，不能记录昵称、邮箱、userId 或请求正文。

受控 smoke 可以额外执行一次 `GET /me/profile` 的只读结构核验：只检查允许字段的类型和非负版本，
不执行 `PUT`，不把昵称、邮箱或资料正文输出到终端；该检查不能替代资料页真机展示、首次写入或
409 冲突验收。

## 3. 真机操作顺序

### 3.1 登录和会话恢复

1. 清理小程序本地缓存中的旧 access token，重新进入首页。
2. 点击登录，确认出现“微信登录成功”，且没有头像、昵称或用户信息授权弹窗。当前方案使用 `wx.login` 静默身份兑换，不申请与医疗业务无关的用户资料权限。
3. 关闭并重新进入小程序，确认能够恢复会话；如果 Redis 会话已过期，应该重新登录，而不是继续显示上一位患者。
4. 保存页面显示结果、时间、客户端 request id；不要截图或复制 token。

### 3.2 患者目录和切换

1. 进入“选择就诊人”，点击“刷新就诊人”。
2. 记录页面展示的患者数量、姓名、关系和脱敏卡号；不要记录完整身份信息。
3. 如果目录有两位或以上患者，先点击患者 A，再点击“更换就诊人”选择患者 B。
4. 分别从“我的挂号”和“门诊缴费”进入，确认页面顶部显示 B，接口失败时不能回退显示 A 的旧数据。
5. 再次点击刷新。若患者仍是同一 Provider 档案，页面选择不能因为同步而无故变成未选择；若 Provider 明确返回该患者失效，页面必须要求显式重新选择。

### 3.3 挂号记录和爽约记录

1. 进入“我的挂号”，确认未来预约不会因为只查询过去而消失。
2. 进入“爽约记录”，确认只显示 `missed`，已预约、已取消、已完成、停诊、替诊和未知状态不能混入。
3. 切换患者后重新进入两页，确认请求和结果都属于新选择患者。

### 3.4 门诊费用只读

1. 进入“门诊缴费”，先查看“待缴费”，再切换“已缴费”。
2. 确认切换过程中先清空旧列表，最终列表和当前 tab 一致。
3. 如果当前患者没有临床映射，展示“当前就诊人暂未建立门诊缴费映射”，不能显示另一位患者的费用。
4. 点击费用记录，当前阶段只能出现“支付流程正在迁移中”之类的明确提示，不能调起微信支付。

### 3.5 普通资料与并发版本

1. 从“我的”进入普通个人资料，确认首次读取的默认值或已保存资料属于当前微信会话。
2. 修改一个非敏感展示字段并保存，确认返回的新 `version` 大于读取时的版本；不要在验收记录中填写真实姓名、邮箱或其他个人资料正文。
3. 用旧页面快照再次提交一次过期 `version`，确认返回 `409 user-profile-conflict`，页面提示刷新后重试且不覆盖最新资料。
4. 如果有第二个受控微信账号，分别读取两个账号资料，确认双方不会串读；没有第二个账号时，至少使用服务端 API 集成证据证明 owner 隔离，不能把单账号页面显示当作跨 owner 验收。

## 4. 服务端日志验收

在真机操作开始前记录开始时间，完成后只读取该时间窗口：

```powershell
ssh ps@192.168.112.172 "sudo journalctl -u hospital-platform-api-v2.service --since '<验收开始时间>' --until '<验收结束时间>' --no-pager" |
  Select-String -Pattern 'service.started|auth.wechat|patient.directory|appointment.records|outpatient.payment|persistence.probe'
```

为避免在聊天或工单中复制原始日志，可在服务器受控环境或本地脱敏副本上进一步生成安全聚合：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '<验收开始时间>' --until '<验收结束时间>' \
  -o json --no-pager | bun tools/p0-log-aggregate.mjs
```

生产 release 必须使用同一候选包中的
`apps/worker/dist/p0-log-aggregate.js`，不在服务器上依赖 workspace 源码：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '<验收开始时间>' --until '<验收结束时间>' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-log-aggregate.js"
```

候选发布前必须对该文件做 SHA-256 校验；`parseErrors` 不为 `0` 时只能在受控服务器环境排查，不能把不完整
聚合结果当作真机或业务成功证据。

聚合结果只包含事件/业务域/结果计数、HTTP 状态、错误类型和 trace/provider request id 数量，并增加由 traceId 优先、
requestId 兜底生成的 SHA-256 关联链指纹、每条链的事件计数和 `http.request.completed` 状态计数；`parseErrors` 必须为 `0` 才能说明没有未知的非 JSON 行，
`systemdWarningCount` 也必须为 `0` 才能排除服务停止超时等运行时风险；UTF-8 BOM
会计入 `strippedBomLines`，正常 systemd 启停提示会单独计入 `ignoredControlLines`，已识别的停止异常只进入稳定 warning 计数。
工具不会输出 `msg`、URL、请求体、
token、openid、患者标识、金额或 Provider 原始报文，
也不会把 `payment-frozen` 计为支付成功证据。

在需要判断某个业务域是否确实进入并完成过一次只读链路时，先使用聚合工具的 `--json` 输出纯 JSON，再执行同一
候选 release 中的业务证据门禁：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '<验收开始时间>' --until '<验收结束时间>' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-log-aggregate.js" \
  --json > /tmp/p0-summary.json

/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentRecords
```

可用业务域包括 `auth`、`patientRead`、`patientSync`、`appointmentRecords`、
`appointmentDepartments`、`appointmentSchedules`、`outpatientPaymentRecords`、
`reportDirectory`、`profileRead` 和 `profileUpdate`。其中当前 `reportDirectory` 只用于
fail-closed 边界证据，不代表真实报告 Provider 成功。预约目录的科室和排班必须分别执行门禁：
科室成功但排班失败时，不能把两列级联页面整体标记为通过。
门禁要求对应的请求事件、明确成功事件和同一条链上的 HTTP `2xx` 完成事件同时存在，并报告失败计数；如果只有总数而没有同链事件，
如果 service 写了成功但响应层只有 `4xx/5xx` 或 `http.request.failed`，或者关联链被截断，会以
`same-trace-request-success` / `same-trace-http-2xx` / `correlation-truncated` 失败。关联指纹只证明服务端事件属于同一
请求链，不证明属于同一用户、患者或页面展示正确，仍不能替代 HTTP/真机和页面语义核对。`parseErrors` 或
`systemdWarningCount` 不为 `0` 时，无论业务事件是否出现，门禁都必须失败。

预约目录需要分别检查两个只读请求，仍然使用同一份安全聚合摘要：

```bash
/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentDepartments

/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentSchedules
```

生产环境的聚合摘要只看事件名、状态、关联指纹、provider request id 数量、结果数量和错误类型。禁止把下面内容复制到聊天、提交或截图：

- 微信临时 code、openid、unionId、session_key、AppSecret、Bearer token；
- 完整身份证号、完整卡号、Provider patId/thirdPatientId；
- 数据库连接串、Redis key 原文、患者姓名与业务金额的可关联组合。

预期的低敏事件链如下：

| 业务 | 必须出现的事件 | 关键验证 |
| --- | --- | --- |
| 微信登录 | `auth.wechat.login.requested` → `auth.wechat.login.succeeded` | 同一关联链指纹、会话过期秒数存在，日志无身份凭证 |
| 普通资料只读 smoke | `GET /me/profile` | 只验证允许字段类型和 version，不执行写入、不输出资料正文 |
| 患者同步 | `patient.directory.requested` → `patient.directory.synced` | `complete=true` 的 Provider 快照、活动数/失效数、临床引用计数 |
| 幂等重放 | `patient.directory.operation.replayed` | 相同幂等键不再次出现 Provider 请求 |
| 预约历史 | `appointment.records.requested` → `appointment.records.synced` | 当前内部 patient id、有限日期窗口、Provider request id |
| 门诊费用 | `outpatient.payment.records.requested` → `outpatient.payment.records.loaded` | `unpaid`/`paid` 状态与查询结果一致 |
| 普通资料读取/更新 | `user.profile.requested` → `user.profile.loaded`；`user.profile.update.requested` → `user.profile.updated` | 只记录低敏元数据，版本递增且 owner 不串读；更新请求和成功写入不能混为一谈 |
| 普通资料并发冲突 | `user.profile.conflict` | 旧版本返回 409，不覆盖新资料 |
| 依赖故障 | `persistence.probe.unavailable` / `persistence.probe.recovered` | 失败和恢复有明确时间，不能只看一次 ready 200 |

## 5. Redis TTL 直接证据

会话 TTL 必须针对新 API 实际连接的远端 Redis 读取，只输出数量和 TTL 范围，不输出 key、用户 id 或 token。
当前线上新 API 使用共享环境中的远端 Redis DB3；不能使用服务器本机 `127.0.0.1:6379` 的 `redis-cli -n 3`
冒充线上证据，也不能把连接串直接粘贴到聊天、脚本日志或文档。应由运维在受控 shell 中解析已授权的
`REDIS_URL`，将 ACL 用户名/密码通过进程环境传递给 `redis-cli`，然后只保留聚合结果。例如下面的逻辑要求，
具体凭证注入方式由服务器的密钥管理方案提供：

```bash
# 伪代码：不要把 REDIS_URL、密码、ACL 用户名或 session_key 输出到终端。
# 1. 从服务器受控环境解析 host、port、db、ACL username/password。
# 2. 使用 REDISCLI_AUTH 和 --user 调用远端 redis-cli PING。
# 3. 对 hospital:session:* 做 SCAN，只在进程内计算 TTL，不打印 key。
# 4. 只输出 session_count、ttl_min、ttl_max 三个聚合字段。
echo 'session_count=<aggregate> ttl_min=<aggregate> ttl_max=<aggregate>'
```

这条逻辑只能证明当前扫描到的会话 key TTL 范围；它不能证明某一位患者或某一次登录的业务成功。
2026-08-17 约 12:25 CST 的线上探测结果为远端 Redis `PING=PONG`，但 `SCAN hospital:session:*` 被当前
SSH 账号拒绝，因此 TTL、会话数量和范围仍为“未验证”。若 Redis ACL 不允许 `SCAN`，应由运维在不暴露 key
的情况下提供等价聚合结果，不要临时放宽 ACL；在取得结果前，P0 会话 TTL 门禁保持未通过。

2026-08-18 13:08 CST 对当前 `38bc553` 使用 systemd 同一生产环境执行了受控探测：Redis `PING=PONG`，
但 `SCAN hospital:session:*` 命令被当前授权上下文拒绝；脚本未输出 key、账号或凭证，也没有修改 ACL、会话或 TTL。
因此本 release 的会话数量、TTL 最小/最大值仍未验证；必须由运维在不暴露 key 的前提下提供等价聚合，不能把
Redis 连通性或 HTTP 登录成功误认为 TTL 证据。

后续候选 release 会提供独立维护命令 `apps/worker/dist/redis-session-ttl-audit.js`：

```bash
# REDIS_SESSION_AUDIT_URL 必须通过密钥管理或受控进程环境注入，不要写入命令历史或输出。
/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/redis-session-ttl-audit.js"
```

命令只输出 `sessionCount`、`ttlMin`、`ttlMax`、`noExpiryCount`、`ttlErrorCount`、`truncated` 和
`verified`；退出码 `0` 仅表示非空且未截断的完整扫描中每个 key 都有非负 TTL，退出码 `1` 表示聚合完成但
证据不完整，退出码 `2` 表示配置/连接/权限错误。它不会重启 API、不会触碰旧 Python 服务，也不会写 Redis。

## 6. 验收结果记录模板

| 领域 | 真机结果 | HTTP/request id | journald 事件 | 结论 |
| --- | --- | --- | --- | --- |
| 微信登录 | 待填写 | 待填写 | 待填写 | 未验收 |
| 会话恢复/TTL | 待填写 | 待填写 | 待填写 | 未验收 |
| 患者目录 | 待填写 | 待填写 | 待填写 | 未验收 |
| 多患者切换 | 待填写 | 待填写 | 待填写 | 未验收 |
| 我的挂号 | 待填写 | 待填写 | 待填写 | 未验收 |
| 爽约记录 | 待填写 | 待填写 | 待填写 | 未验收 |
| 门诊待缴费 | 待填写 | 待填写 | 待填写 | 未验收 |
| 门诊已缴费 | 待填写 | 待填写 | 待填写 | 未验收 |
| 普通资料读取/更新 | 待填写 | 待填写 | 待填写 | 未验收 |
| 普通资料 409 冲突 | 待填写 | 待填写 | 待填写 | 未验收 |

只有当真机结果、服务端事件和响应语义相互一致时，才能把对应领域从“代码已实现”更新为“真实业务已验收”。当前仍不能据此开放预约写入、支付、医保、退款或 HIS 回写。

## 7. 当前未完成事项

1. 当前服务端基线为 `0e360d3`，当前本地真机候选来源为
   `3a6bf3ea3d2b8944e05ffcad254a37afdbca2aab`（提交 `3a6bf3e`）；截至本记录，公网 live/ready 和未登录 401 已复核，
   但尚未取得这份候选在有效微信会话下的登录、患者目录、预约历史或门诊费用真机业务事件。后续必须以真实验收开始时间
   为起点重新取证，不能沿用历史 release 日志。
2. Redis 实际 TTL 尚未保存为本 release 的直接证据；`expiresInSeconds` 不能替代远端 Redis TTL 聚合。
3. 多患者切换、inactive/恢复和跨页面患者上下文尚未取得真实 Provider 事实。
4. Provider 新版文档尚未收到；医疗病历、费用明细/电子票据、患者新增绑定、动态院区路由、二维码、住院、输血和其他高风险写入继续保持待合同状态。
