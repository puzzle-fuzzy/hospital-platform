# 下一阶段实施路线图

本文档是新会话继续工作的入口，描述当前真实边界、业务优先级、工程治理和上线验收顺序。
其中“已完成”只表示代码、测试或部署证据，不代表微信、众阳、医保、HIS、支付或真机已经完成真实验收。

## 当前执行检查点（2026-08-18）

- 微信开发者工具的 `miniprogram` 项目已确认使用 `miniprogramRoot=dist/`，当前运行包来源为
  `dist/build-info.json.sourceRevision=d4261e5a59e0a9bfe69534169504d8a118ebca7f`，14 个页面脚本和根文件均已通过运行包校验。
- “二维码真机调试”弹窗已经生成 iOS 调试二维码，但截至本检查点尚未观察到手机扫码后的连接状态；二维码存在不等于微信会话、患者切换或业务已经验收。
- 本地 `pnpm check` 已通过；随后仅做了路线图文案修正和文档门禁复核，没有重新发布服务端、没有重启新旧服务，也没有触碰用户已有的 `apps/miniprogram/project.config.json` 修改。
- 当前门禁新增 `pnpm release:baseline:audit`：以只读业务验收候选为基准，自动核对路线图、迁移清单和当前业务审计是否仍绑定同一服务端 release 与小程序完整 `sourceRevision`，历史 release 仍可保留但不会被当作当前状态。
- 重启后发现已有“真机调试”连接属于旧 `mp-weixin` 项目，而不是新 `apps/miniprogram`；旧窗口保持原样不操作，新项目二维码尚未产生连接。边界记录见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。
- 2026-08-18 17:09 CST 已在新 `miniprogram` 项目窗口重新生成 iOS 真机调试二维码；截至记录时仍无新设备连接。二维码已生成不等于扫码成功，继续按上述边界区分旧项目连接和新项目验收。
- 2026-08-18 18:36 CST：`07d3988` 候选重新编译后，新项目模拟器首页正常显示，`appService.js: define is not defined` 的 2 个错误已消失；最终二维码已重新生成，但窗口枚举仍未发现新设备连接，活动真机窗口仍属于旧 `mp-weixin` 项目。本次不增加真机业务证据。
- 2026-08-18 18:38 CST：公网只读探针再次确认 `/api/v2/health/live=200`、`/api/v2/health/ready=200`（`database/redis/schema=ok`）、`/api/v2/system/ping=200`，未登录 `/api/v2/me/profile=401 unauthorized`。该结果只覆盖公网运行层和认证边界，完整低敏记录见 [`release/current-public-readonly-smoke-2026-08-18-1838.md`](release/current-public-readonly-smoke-2026-08-18-1838.md)。
- 2026-08-18 18:40 CST：重启后重新核对新 `miniprogram` 窗口，资源树确认是 `dist/`，二维码代码包约 607 KB，模拟器首页正常，调试器为 0 errors / 3 条微信基础库提示；仍未观察到新手机连接。本次只恢复二维码上下文，不增加微信会话或只读业务真机证据，详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。
- 2026-08-18 18:47 CST：`d4261e5` 提交后的运行包重新构建完成，`dist/build-info.json` 已核对为完整来源指纹
  `d4261e5a59e0a9bfe69534169504d8a118ebca7f`，并通过 `runtime:verify`。此前 `07d3988` 二维码不包含本轮门诊费用失败态修正，不得继续用于验收；本次未部署服务端、未重启新旧服务、未触碰旧 Python 服务。
- 本轮修正门诊费用失败态：费用查询失败时页面现在清空 `selectedPatient`、费用列表和可见批次，但保留本地 opaque 选择并通过空态重新进入选择页；这样不会把上一轮患者卡片与失败/空读模型混在一起。该修正只影响小程序页面、中文注释和静态回归，详情见 [`release/miniprogram-outpatient-error-context-2026-08-18.md`](release/miniprogram-outpatient-error-context-2026-08-18.md)。
- 重启后再次按标题选择新 `miniprogram` 窗口时，窗口句柄与可见画面出现不一致，无法确认当前画面仍属于二维码弹窗；本次未点击、输入或继续扫码，避免误触旧项目。后续必须重新打开新候选项目并同时核对 `dist/` 资源树与二维码上下文，详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。
- 2026-08-18 16:44 CST 公网只读复核通过：`/api/v2/health/live=200`、`/api/v2/health/ready=200`，且 ready 返回 `database/redis/schema=ok`；未登录 `GET /api/v2/me/profile` 返回预期 `401 unauthorized`。这只证明公网运行层和认证边界，不能增加微信会话、患者切换、预约、报告或费用业务验收结论。
- 下一步固定为：用户扫码后先确认微信会话，再按 [`release/miniprogram-readonly-acceptance-candidate-2026-08-18.md`](release/miniprogram-readonly-acceptance-candidate-2026-08-18.md)
  采集页面、HTTP trace 和低敏服务日志三层证据；在三层证据对齐前，不把任何只读业务标记为真实已验收。

### 本轮“我的”页菜单渲染 key 修正（2026-08-18）

- `231a9dc` 修正原生“我的”页未迁移菜单项的 WXML key：这些入口没有 `action`，继续使用 `action` 会让多个项目共享 `undefined` key，真机渲染层可能复用错误节点，造成图标与文案错位。
- 现在按同一分组内稳定且已有的 `title` 作为展示 key，并在原生小程序 acceptance 中固定 `wx:key="title"`、拒绝回退到 `wx:key="action"`。
- 该修正只影响小程序 WXML 与静态门禁；服务端、数据库、Provider、线上 release 和旧 Python 服务均未修改。重新构建后的运行包来源为
  `231a9dc6dd6d65b81121d77d29a54068ef699eaf`，小程序测试为 120 项、1031 个断言。

### 本轮小程序根入口运行时修正（2026-08-18）

- `07d3988` 修复开发者工具控制台出现 `appService.js: define is not defined`、随后首页未注册的真实运行时问题。根因是 Node16 TypeScript 输出给微信全局 `app.ts` 增加了 CommonJS 启动壳；构建器现在会保留 source map 行偏移、移除根入口启动壳，并在构建阶段拒绝 `exports/module/require` 重新进入 `app.js`。
- 修复后开发者工具模拟器首页已正常渲染，原先的 2 个错误消失；微信基础库留下的 3 条文档/兼容性提示没有业务堆栈。该修正只影响小程序根入口、构建脚本和静态门禁，不修改 API、数据库、Provider、线上 release 或旧 Python 服务。
- 新候选运行包来源为 `07d39882dd7bbd71f7b9d5ea83c27ca0c1e8c7af`，小程序回归为 121 项、1035 个断言，14 个页面脚本通过 `runtime:verify`；真实手机扫码后的会话、页面 HTTP 和低敏日志三层证据仍待重建。

## 当前基线

### 本轮认证响应会话代际门禁（2026-08-18）

- 在患者同步代际隔离之外，原生小程序认证请求层现在会在响应交付前再次核对会话代际；旧账号的患者目录、资料、预约、报告、费用或预支付响应不会因为 HTTP 200 而进入新账号页面。
- 401 的既有单次重试仍然保留，但重试会重新绑定新 token 的代际；`session-changed` 不会被当作普通网络错误重试，避免把旧请求无限延长。
- 新增真实延迟响应回归测试和中文业务注释；本轮未修改 API、数据库、Provider、线上 release 或旧 Python 服务。
- 当前小程序候选来源为 `d4261e5a59e0a9bfe69534169504d8a118ebca7f`，14 个页面运行包已重新构建并通过 `runtime:verify`；小程序为 121 项测试、1036 个断言；本轮修正了门诊费用失败态患者上下文，并保留“我的”页未迁移菜单的 WXML key 和根入口全局脚本兼容，未改变服务端或旧服务。
- 详细规则见 [`release/miniprogram-authenticated-response-session-gate-2026-08-18.md`](release/miniprogram-authenticated-response-session-gate-2026-08-18.md)。

### 本轮预约目录日期事件边界（2026-08-18）

- 预约目录在刷新或切换科室期间会先清空当前日期分组；页面现在拒绝已经不属于当前分组的旧日期事件，避免过期 WXML 事件把 `selectedDate` 写成脱离当前科室读模型的状态。
- 该修正只涉及小程序级联页面、静态验收测试和中文业务注释，不扩大 Provider 查询、不开放预约写入、不修改 API、数据库、线上 release 或旧 Python 服务；真机和 Provider 证据仍需按候选验收手册取得。

### 本轮普通资料版本上限门禁（2026-08-18）

- `1b94c46` 修正普通资料 service 的版本边界：当请求版本已经达到 MySQL `INT UNSIGNED` 最大值时，在仓储写入前返回 `user-profile-invalid`，不尝试生成越界的下一版本。
- 新增“最大版本不触碰仓储”的回归测试；全仓 `pnpm check` 通过，API 为 115 项测试、525 个断言。代码注释明确区分输入校验、409 并发冲突和版本耗尽三种业务事实。
- `1b94c46` 已按无损 runbook 完成生产切换，当前 release 为 `/home/ps/code/hospital-platform/releases/1b94c46`；普通资料首次 PUT、真实 409 和真机证据仍需 P0 验收，部署证据见 [`release/1b94c46-production-acceptance-2026-08-18.md`](release/1b94c46-production-acceptance-2026-08-18.md)。

### 本地候选与当前线上增量（2026-08-18）

- 本地 `main` 与 `origin/main` 已同步，具体文档提交以仓库当前 `HEAD` 为准；小程序运行输入来源为 `d4261e5`，线上服务端运行 bundle 来源为 `1b94c46`。服务端上一轮在报告目录和门诊费用 adapter 中统一收紧 Provider 患者引用边界，并修正小程序同步回写不能覆盖患者 `stale/unavailable` 状态：即使患者号来自 owner-scoped 映射，
  adapter 也会在 HTTP 请求前拒绝空引用，并新增“不调用 Provider”的测试；报告、门诊费用 gate 和旧服务边界均未打开或修改。
- `1b94c46` 已通过全量 `pnpm check`、真实生产 env preflight、`18082` 隔离 smoke 和 SHA-256 对照后切换；当前真机配套小程序候选由 `d4261e5` 重建，`sourceRevision=d4261e5a59e0a9bfe69534169504d8a118ebca7f`，14 个页面脚本已核对。
  adapter 测试为 78 项、173 个断言。

### 本轮就诊人手动刷新事件修正（2026-08-18）

- `144b5b4` 修正选择页“刷新就诊人”的真机事件边界：WXML `bindtap` 传入的事件对象不再进入只接受数字加载 token 的内部同步流程，手动刷新现在会先创建新的页面加载周期，再复用页面级和进程级 single-flight。
- 本次只修改原生小程序页面和静态验收测试，未修改 API、数据库、Provider、线上 release 或旧 Python 服务；中文业务注释明确记录了此前“点击无同步”的根因。
- 小程序定向门禁为 112 项通过、979 个断言；完整来源指纹为 `144b5b44f6e221569b458fda87e33b064f49a000`。该候选尚未部署，真机验收前必须重新构建并核对 `dist/build-info.json`。
- 详细修正说明见 [`release/miniprogram-patient-refresh-event-boundary-2026-08-18.md`](release/miniprogram-patient-refresh-event-boundary-2026-08-18.md)。

### 本轮患者同步会话代际隔离（2026-08-18）

- `86fa75f` 为真正影响运行包的来源提交；它为客户端会话引入只存在于内存的代际号，token 变化时递增，但不把 token 写入 single-flight key、日志或患者数据。
- 首页、选择页和进程级患者同步都按会话代际隔离；旧会话的在途同步即使晚于重新登录返回，也会以 `session-changed` 拒绝，不会把旧账号患者快照回写给新账号。
- 当时分支最新提交为 `005d961`，只修正静态门禁字符串写法；该历史运行包来源为 `86fa75f3a76718dcf8da96fc6c10f71e5a4b49a2`。当前候选已推进到 `231a9dc`，小程序定向测试为 120 项、1031 个断言。
- 本轮未修改 API、数据库、Provider、线上 release 或旧 Python 服务。详细说明见 [`release/miniprogram-session-generation-isolation-2026-08-18.md`](release/miniprogram-session-generation-isolation-2026-08-18.md)。
### 上一轮 4ae2a31 生产切换（历史）

- 2026-08-18 15:23-15:25 CST 曾按无损 runbook 将 `4ae2a31` 上传、checksum 对照、生产 preflight、18082 隔离 smoke 后原子切换上线；新 API 只重启自身，旧 Python `8001` 监听和 PID 集合保持不变。完整证据见
  [`release/4ae2a31-production-acceptance-2026-08-18.md`](release/4ae2a31-production-acceptance-2026-08-18.md)。

### 当前线上 release 与验收边界（2026-08-18 16:31-16:32 CST）

- 当前线上为 `1b94c46`，运行于 `/home/ps/code/hospital-platform/releases/1b94c46`，生产模式、MySQL/Redis/schema readiness 均正常；
  旧 Python `0.0.0.0:8001` 继续运行，Worker、支付、医保、HIS 写入和报告 gate 保持关闭。
- 切换后公网和内网健康探针均通过，当前服务启动窗口低敏聚合 `parseErrors=0`、`systemdWarningCount=0`，仅有健康请求和预期未登录 401，没有真实资料 PUT/409、患者、预约、费用或报告业务事件。
  运行层成功不等于业务验收成功；下一步继续按 P0 手册取得真机页面、HTTP trace 和低敏业务日志三层证据。
- Redis 会话实际 TTL、多患者切换/失效恢复、预约历史、爽约、门诊费用和普通资料 PUT/409 的当前 release 业务证据仍未完成；支付、医保、退款、报告和 HIS 继续最后处理。

### 上一 release 与验收增量（2026-08-18 14:55-14:57 CST，仅作历史）

- 当前线上 release 仍为 `9acdaf2`。该版本在预约历史成功日志中增加低敏 `statusCounts`，只统计规范化预约状态的数量，
  用于解释“在线挂号”筛选后的结果，不记录患者、Provider 或预约标识；此前 `0ae4194` 的患者上下文空值前置校验仍包含在提交历史中。
- `9acdaf2` 已通过完整 `pnpm check`，并强制重建 API、Worker 和原生小程序运行包；`dist/build-info.json` 的
  `sourceRevision=9acdaf2`、14 个页面脚本均已核对。候选包完成 SHA-256、真实生产 env preflight 和隔离 runtime smoke 后才切换线上。
- 当前新 Bun/Elysia API 为 `/home/ps/code/hospital-platform/releases/9acdaf2`，运行于生产模式，MySQL/Redis/schema 均为 `ok`；
  旧 Python `0.0.0.0:8001` 继续监听，本轮只重启新 API，没有停止、重启或修改旧服务。
- 配对开发者工具的预约历史请求返回 HTTP 200；日志聚合显示 `itemCount=60` 且 `statusCounts={cancelled:60}`。
  在线标签排除已取消记录，因此显示空态符合业务筛选；全部挂号仍保持 fail-closed，因为独立的 `requestChannel=4` 契约尚未开放。
- 当前 release 的预约历史 P0 业务证据门禁通过（请求/成功各 1、失败 0、日志解析错误 0、systemd warning 0）。这仍是开发者工具证据，
  不等同于微信真机、公网分域、Provider 写入、支付、医保或 HIS 验收。详细记录见 [`release/9acdaf2-appointment-status-observation-2026-08-18.md`](release/9acdaf2-appointment-status-observation-2026-08-18.md)。

### 上一轮 38bc553 微信身份边界收紧与无损切换（历史：2026-08-18 13:03-13:08 CST）

- `38bc553` 已完成本地 API/Worker/小程序候选构建、8 个 bundle checksum、真实生产 env preflight 和
  `127.0.0.1:18082` 隔离 runtime smoke；随后按 runbook 原子切换为线上当前 release。
- 当前新 Bun/Elysia API 为 `/home/ps/code/hospital-platform/releases/38bc553`，`runtimeMode=production`、auth ready、
  MySQL/Redis/schema 均为 `ok`；旧 Python `0.0.0.0:8001` 继续监听，本次没有停止、重启或修改旧服务。
- 切换后新 API `10.0.0.3:18081` 和公网 `/api/v2/health/ready` 均返回 `200`；本轮只完成运行层切换和身份 adapter 边界修复，
  没有新的微信、患者、预约历史、门诊费用或报告业务事件，因此不能把任何真机业务域标记为已验收。
- 切换后 journald 低敏聚合为 `parseErrors=0`、`systemdWarningCount=0`，只有健康请求；预约历史和门诊费用证据门禁均缺少
  `requested/success`。当前 release 的 Redis TTL 审计仍按设计返回 `redis-session-scan-unavailable`、退出码 `2`，TTL 继续未验证。
- 当前真机客户端必须使用来源指纹为 `9b1c99d59076188e960e33d5f65863eaa67bae9a` 的小程序 `dist/`，与服务端 `38bc553` 配套；旧的 `1697695` 包与当前服务端不再组成验收组合。
- Redis TTL、真实微信会话、多患者切换/失效恢复、预约历史、爽约、门诊费用和普通资料读写仍按 P0 手册待完成；支付、医保、退款、报告和 HIS 继续关闭。
- 具体产物、preflight、隔离 smoke、切换和回滚边界见 [`release/candidate-38bc553-local-build-2026-08-18.md`](release/candidate-38bc553-local-build-2026-08-18.md)。

## 历史版本与迁移记录（不可覆盖当前基线）

> 以下内容用于追溯此前候选版本的代码修正、生产切换和观察窗口。每个小节中的 release、schema、
> 业务事件和“下一步”只对对应时间窗口成立，不能覆盖上面的 `1b94c46` 当前基线，也不能把历史
> 微信、患者、预约或费用事件回填为当前版本验收。开始新任务时，先以本节前的当前基线、当前执行
> 检查点和最新 release 文档为准。

### 本轮 c63dba9 资料日志链路补齐与生产共存切换（2026-08-18 11:07-11:09 CST）

- `c63dba9` 已完成本地全量门禁、7 个 bundle SHA-256、服务器真实生产 env preflight 和
  `127.0.0.1:18082` 隔离 runtime smoke；当前 release 为 `/home/ps/code/hospital-platform/releases/c63dba9`。
- 新 Bun/Elysia API `10.0.0.3:18081` 以生产模式 active；旧 Python API `0.0.0.0:8001` 继续监听，
  旧服务未被重启、停止或修改，Worker 仍 inactive。切换后公网 ready 连续 6/6，MySQL、Redis、schema 为 `ok`，
  `Cache-Control: no-store` 保持不变。
- 本次只补齐普通资料更新的 `user.profile.update.requested` 开始事件、结果事件测试和 P0 证据门禁，
  不打开支付、医保、HIS 写入、预约写入、报告或 Worker。日志聚合 `parseErrors=0`、`systemdWarningCount=0`。
- 切换后 11:15 CST 出现 1 次患者目录读取 `503/PersistenceUnavailableError`（`PROTOCOL_CONNECTION_LOST`），
  服务正确 fail-closed；11:19 CST 生产 env preflight 恢复 `MySQL/Redis/schema=ok`。这说明存在一次持久化瞬态，
  不能把短时 readiness 当作长期稳定，P0 业务验收需在连续稳定窗口中进行。
- 11:23 CST 重启后复核确认 systemd 服务仍为 `active`，新 `18081` 与旧 `8001` 同时监听，公网和内网 live/ready 均为
  200；使用服务真实 `EnvironmentFiles=/home/ps/code/hospital-platform/shared/api.env` 重跑 preflight，生产模式、
  MySQL/Redis/schema 和微信/患者/预约/门诊只读 Provider 配置均通过。普通 SSH shell 不带该环境文件时的
  `not_configured` 不属于线上服务故障。
- 11:31 CST 受控 Redis 会话探测 `PING=PONG`，但当前授权上下文拒绝 `SCAN hospital:session:*`；没有输出 key、
  凭证或修改 ACL，故当前 release 的会话数量和 TTL 范围仍未验证，不能把 Redis 连通性当作会话 TTL 证据。
- 11:40 CST 候选 `9ca3a89` 已上传到独立 release 目录，8 个 bundle SHA-256 与本地构建产物一致；使用真实生产 env 的
  preflight 通过，并在 `127.0.0.1:18082` 完成 production runtime smoke 后正常回收。候选没有切换 `current`，新旧生产服务均未重启。
  同一候选的 Redis TTL 审计工具在常驻 API Redis ACL 下返回固定 `redis-session-scan-unavailable`、退出码 2，证明权限不足时
  fail-closed；独立维护 ACL 尚未提供，因此 TTL 仍未验证。完整证据见
  [`release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md`](release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md)。
- 12:17 CST 再次通过 SSH 只读复核确认 `c63dba9` 仍为当前 release，新 `18081` 与旧 Python `8001` 共存，内网/公网 ready
  均为 `200` 且 database、redis、schema 为 `ok`。当前 release 尚未包含 TTL 审计 bundle；使用已审计候选工具读取同一生产
  Redis ACL 仍返回 `redis-session-scan-unavailable`、退出码 `2`，所以 TTL 继续保持未验证。由于当前 sudo 规则不允许无密码读取
  journald，本次不把日志聚合声称为通过；详见 [`release/restart-coexistence-readonly-audit-2026-08-18.md`](release/restart-coexistence-readonly-audit-2026-08-18.md)。
- 当前 release 切换后的受控日志窗口已通过微信登录 `4/4`、患者目录读取 `20/20`、患者同步 `10/10` 的请求/成功
  门禁；但这仍需要页面和 HTTP trace 交叉核对，且没有 `appointment.records.*` 或 `outpatient.payment.records.*`
  请求/成功事件，不能把运行层 smoke 或历史 release 业务事件复用为当前业务验收。完整发布证据见
  [`release/c63dba9-production-acceptance-2026-08-18.md`](release/c63dba9-production-acceptance-2026-08-18.md)。
- 本轮继续完成原生小程序入口业务门禁：预约目录未登录时登录成功会继续原动作，门诊缴费不再绕过登录，
  我的挂号/爽约/报告/费用在未绑定当前临床患者时统一进入选择页，不再先发起无意义的 401 或患者上下文错误。
- 2026-08-18 11:54 CST：用户反馈重启后完成 SSH 只读复核；`hospital-platform-api-v2.service` 仍为 `active`，当前 release
  仍为 `c63dba9`，新 `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听。内网 `/health/live`、`/health/ready`、
  `/api/v1/system/ping` 和公网 `/api/v2` 对应探针均为成功；确认内网必须使用无公网版本前缀的健康路径，直接请求内网
  `/api/v2/health/*` 得到 404 属于路径拼接错误，不是服务中断。完整只读证据见
  [`release/restart-coexistence-readonly-audit-2026-08-18.md`](release/restart-coexistence-readonly-audit-2026-08-18.md)。
  该行为由 `patient-navigation.ts` 的三态纯函数和 3 个单元测试覆盖；本地小程序 96 个测试、类型检查、构建及
  14 页面运行包校验均通过。该修改尚未部署，当前线上仍为 `c63dba9`。
- 随后本地客户端继续推进到 `1cd2b07`：除选择页“目录读取 + 临床同步”的页面实例并发竞态外，
  还禁止在临床映射确认前恢复本地“当前”标记；并同步补充中文业务不变量和验收断言。小程序 106 项测试、936 个断言、
  typecheck、build 和 14 页面运行包校验均通过。该客户端仍未部署到线上，真机候选必须使用 `1cd2b07` 重新构建的 `dist/`，
  不能继续使用 `055a784` 或 `c1338a2` 旧包。
- 2026-08-18 12:28 CST：小程序构建新增 `dist/build-info.json` 来源指纹，固定记录 schema 版本、完整 Git 提交号、
  页面数量和构建时间，不携带密钥、会话、就诊人或 Provider 数据。当前验收客户端为 `b86d58b`，构建包中的
  `sourceRevision=b86d58b6dd749ccc7acf53ceb06edd76698fa5aa`，小程序 107 项测试、943 个断言、typecheck、build 和
  14 页面运行包校验均通过；该包仍未部署到线上，真机验收必须先核对来源指纹。
- 2026-08-18 12:31 CST：重启后再次只读复核确认 `c63dba9`、新 API `10.0.0.3:18081` 和旧 Python `0.0.0.0:8001`
  仍共存，内网正确地址 `/health/ready` 与公网 `/api/v2/health/ready` 均为 `200`，database、redis、schema 均为 `ok`。
  `127.0.0.1:18081` 的拒绝仅是错误探针地址，不是服务故障；无服务重启、release 切换、业务写入或旧服务改动。
- 2026-08-18 12:38 CST：应用会话重启后再次只读复核，`c63dba9`、双服务监听和内外网 readiness 均未漂移；本次
  仅产生两条健康探针请求，没有新的 `appointment.records.*`、`outpatient.payment.*` 或报告业务事件。该结果继续证明
  运行层共存，不推进“我的挂号”、爽约、门诊费用、报告或 Redis TTL 的真实验收状态。
- 2026-08-18 12:42 CST：公网未登录边界复核中，患者目录、普通资料、预约历史和门诊费用均返回 `401/unauthorized`，
  没有进入 query 校验或 Provider。该结果只证明认证门禁，不增加微信会话、患者切换、预约历史或门诊费用的业务验收证据。
- 2026-08-18 12:43 CST：补齐普通资料的本地回归边界：service 测试确认非法输入在仓储写入前失败；小程序静态验收确认
  未加载/保存中/延迟回跳期间不重复 PUT，只有服务端返回新 `version` 才显示成功，`user-profile-conflict` 保持刷新提示。
  小程序测试为 108 项、952 个断言，API profile 定向测试 9 项通过；该变更尚未部署，不改变旧服务、数据库或生产 gate。
- 2026-08-18 12:46 CST：应用会话重启后补跑全仓门禁：`pnpm test` 为 9/9 package 成功（API 114/114、528 个断言），
  `pnpm typecheck` 为 9/9 package 成功，`pnpm test:tools` 为 10/10 成功。当前工作树仍只有用户已有的
  `apps/miniprogram/project.config.json` 修改；本次验证没有重建、上传、切换 release、重启服务或修改旧 Python 服务。
  生产真机候选仍固定使用 `1697695` 的 `dist/`，`3b4397d` 仅是测试/文档提交，不改变候选包来源指纹。
- 2026-08-18 12:47 CST：再次通过 SSH 只读复核重启后的线上共存状态：当前 release 仍为 `c63dba9`，新 Bun 服务
  `10.0.0.3:18081` 与旧 Gunicorn `0.0.0.0:8001` 同时监听，内网 `/health/ready` 与公网
  `/api/v2/health/ready` 均返回 200，`database/redis/schema` 均为 `ok`。本次没有业务写入、release 切换、
  旧服务操作或 Redis 会话探测；真实微信会话、患者显式切换、预约历史和门诊费用仍按 P0 手册待真机三层验收。
- 2026-08-18 12:49 CST：补跑当前工作树门禁：架构边界 62/62、迁移台账、Provider 文档接收审计和 lint 均通过；
  `apps/api`、`apps/worker`、小程序 `src/scripts`、`packages`、`tools`、`infra` 定向格式检查共 218 个文件通过。
  全量格式检查唯一失败项仍是用户已有的 `apps/miniprogram/project.config.json`，本轮未格式化、未暂存、未提交该文件，
  以保留其他会话的工作内容。
- 2026-08-18 12:53 CST：对当前服务执行低敏 P0 日志观察，SSH 账号可正常读取 journald；从 12:49 起输入行数为 `0`，
  因此不是解析或权限失败，而是没有新的微信、患者、预约、门诊费用、报告或资料业务操作进入当前 API。业务证据门禁
  的各域 requested/success 均为 `0`，不能把这个结果当成任何业务的成功空列表，真机验收仍需实际触发请求。
- 2026-08-18：收紧微信 code2session 身份边界：adapter 现在拒绝 `openid/unionid` 的非字符串、控制字符、空白和超长值，
  不再静默忽略畸形 `unionid`。这样“登录成功但患者同步缺少身份”的错误链会在身份交换阶段 fail-closed；新增 adapter 测试、中文业务注释和
  Provider contract 说明，未修改 API 响应、数据库 schema、旧服务或线上 release，待后续候选发布。
- 2026-08-18：`38bc553` 已完成本地 API/Worker/小程序候选构建和 14 页面运行包校验，产物来源指纹为
  `38bc553395f07c017446ee2539677431c6835f13`；随后上传、通过真实 production env preflight 和 `127.0.0.1:18082` 隔离
  runtime smoke，并切换为当前 release。真实微信会话、患者业务和 Redis TTL 仍未验收；候选边界见
  [`release/candidate-38bc553-local-build-2026-08-18.md`](release/candidate-38bc553-local-build-2026-08-18.md)。
- 2026-08-18 12:35 CST：修正患者选择页的一个隐式状态副作用：同步前的展示列表现在只用纯函数读取已有
  `selectedPatientId`，不会因为目录中存在 ready 患者就提前写入本地选择；只有完整临床同步成功后才允许恢复当前标记。
  该修正通过小程序 107 项测试、945 个断言、typecheck、build 和 14 页面运行包校验，提交为 `1697695`，未改变 API、
  Provider、数据库或旧服务；真机多患者和失效/恢复证据仍待完成。
- 下一步优先用页面操作和 HTTP trace 核对当前会话的患者显式切换，再完成预约历史/门诊费用只读三层验收；支付、医保、预约写入、
  退款、报告 Provider 和 HIS 写回继续最后处理。

### 本轮 e5bafd3 资料边界修正与生产共存切换（2026-08-18 10:05-10:07 CST）

- `bac6f7f` 收紧普通资料的 Unicode 昵称长度和 MySQL `INT UNSIGNED` 版本边界，`e5bafd3` 修正配置格式门禁与迁移文档测试；定向测试、全量测试和构建均通过。
- 当前 release 为 `/home/ps/code/hospital-platform/releases/e5bafd3`，新 Bun/Elysia API
  `10.0.0.3:18081` active；旧 Python API `0.0.0.0:8001` 继续监听，旧进程 PID 未变，Worker 未启动。
- 生产 preflight、候选隔离 `/api/v1` runtime smoke、切换后内网 live/ready 和公网 `/api/v2` runtime smoke 均通过；公网 ready 保留 `Cache-Control: no-store`，MySQL、Redis、schema 为 `ok`，支付、医保相关支付链路和报告 gate 保持关闭。
- 切换后已取得一次真实微信会话：`POST /auth/wechat` 200、患者目录读取 200、患者同步 200，返回 1 条 active 患者和 1 条 `his-patient` 映射；但没有新的 `appointment.records.*`、`outpatient.payment.*` 或 `report.*` 事件，不能把“我的挂号”、爽约记录、门诊费用或报告标记为真实业务验收。详细低敏证据见 [`release/e5bafd3-p0-business-observation-2026-08-18.md`](release/e5bafd3-p0-business-observation-2026-08-18.md)。
- 当前预约历史页面只开放已确认的在线渠道读模型；“全部挂号”保留原版标签位置但 fail-closed 提示迁移中，不能把在线结果复制为全部渠道结果。
- 当前服务器只读 Provider smoke 在配置校验阶段因缺少临时平台 access token 停止，未发出任何预约/费用请求；后续命令行验收必须使用受控临时注入，不能从 Redis 导出真机 token。
- 完整证据见 [`release/e5bafd3-production-acceptance-2026-08-18.md`](release/e5bafd3-production-acceptance-2026-08-18.md)。

### 本轮 10:27 CST 共存与公网健康复核

- 当前 `hospital-platform-api-v2.service` 仍运行 `/home/ps/code/hospital-platform/releases/e5bafd3`，新 API 监听
  `10.0.0.3:18081`；旧 Python/Gunicorn 仍监听 `0.0.0.0:8001`，旧服务没有被本轮操作停止或修改。
- 公网 `/api/v2/health/live`、`/api/v2/health/ready` 均为 HTTP 200，ready 的 MySQL、Redis、schema 为 `ok`，
  但当前没有新增个人资料、挂号历史或门诊费用业务事件。
- 因此下一步不是继续改动运行层，而是使用匹配当前 release 的小程序运行包，按
  `我的 → 我的挂号（在线渠道） → 爽约记录 → 门诊缴费（待缴/已缴） → 更换就诊人后重复读取`
  逐项触发真实请求；没有页面结果和对应低敏日志前，相关域仍保持“未完成三层验收”。
- 复核记录见 [`release/e5bafd3-p0-business-observation-2026-08-18.md`](release/e5bafd3-p0-business-observation-2026-08-18.md)。

### 本轮 4cf9e66 生产共存切换与候选验收（2026-08-18 09:16-09:20 CST）

- `4cf9e66` 已完成本地全量 `pnpm check`、服务器真实生产 env preflight、`127.0.0.1:18082` 隔离
  runtime smoke、7 个 bundle SHA-256 校验和原子 `current` 切换。
- 当前 release 为 `/home/ps/code/hospital-platform/releases/4cf9e66`，新 Bun/Elysia API
  `10.0.0.3:18081` active；旧 Python API `0.0.0.0:8001` 继续监听，旧进程未被停止，Worker 仍未启动。
- 切换后的内网 `/health/live`、`/health/ready` 均通过，启动日志确认 `environment=production`、
  `runtimeMode=production`、MySQL/Redis/schema `ok`，微信身份和只读业务依赖已配置；支付、报告保持关闭。
- 这次只完成运行层共存和产物可追溯，尚未取得当前 release 的微信真机、患者显式切换、我的挂号、爽约记录和门诊费用三层业务证据。
- 完整证据见 [`release/4cf9e66-production-acceptance-2026-08-18.md`](release/4cf9e66-production-acceptance-2026-08-18.md)。
  下一步使用匹配的小程序运行包，按“登录 → 刷新/显式切换就诊人 → 我的挂号 → 爽约记录 → 门诊费用只读”取证。

### 本轮 0995f7c 生产切换与停机边界复核（2026-08-18 02:34 CST）

- `0995f7c` 已完成全量 `pnpm check`、真实生产 env preflight、`127.0.0.1:18082` 隔离 readiness 和
  约 106ms 的 SIGTERM 回收；生产切换后新 API active，旧 Python `8001` 继续监听，Worker 仍 inactive。
- 当前 release 为 `/home/ps/code/hospital-platform/releases/0995f7c`，内网/公网 readiness 均返回
  database/redis/schema `ok`。新停机 deadline 已避免上次 `systemd stop-timeout/SIGKILL`，最近窗口为
  `parseErrors=0、systemdWarningCount=0`。
- 本次只修复服务生命周期和日志证据边界，没有打开预约写入、支付、医保、报告或 HIS；最近窗口中的历史业务事件不能替代
  当前 release 的微信真机、患者切换、我的挂号和门诊费用三层证据。
- 完整证据见 [`release/0995f7c-production-acceptance-2026-08-18.md`](release/0995f7c-production-acceptance-2026-08-18.md)。
  下一步仍按“登录 → 刷新/显式切换患者 → 我的挂号 → 门诊费用只读”取证。

### 上一轮 1a8a898 生产切换与公网复核（2026-08-18 02:04-02:05 CST）

- 候选 `1a8a898` 已完成本地 `pnpm check`、服务器真实生产 env preflight、`127.0.0.1:18082` 隔离
  runtime smoke 和 SHA-256 产物校验；随后原子切换为当前 release，只重启新 Bun/Elysia API。
- 当前 release 为 `/home/ps/code/hospital-platform/releases/1a8a898`，新 API `10.0.0.3:18081` active；旧
  Python `8001` 继续监听，Worker 未启动。内网和公网 `/api/v2/health/ready` 均返回 database/redis/schema
  `ok`，启动日志确认 `runtimeMode=production`、微信身份配置已加载，支付保持关闭。
- 本次切换窗口没有真机业务请求，不能把微信登录、患者切换、我的挂号或门诊费用标记为真实业务验收完成。
  journald P0 聚合还出现 `parseErrors=5`，日志输入边界需要先治理到 `parseErrors=0`，再用于业务证据门禁。
- 完整部署证据见 [`release/1a8a898-production-acceptance-2026-08-18.md`](release/1a8a898-production-acceptance-2026-08-18.md)。
  下一步使用与该 release 匹配的小程序运行包，按“登录 → 刷新/显式切换患者 → 我的挂号 → 门诊费用只读”取得页面、
  HTTP、低敏日志三层证据；支付、医保和 HIS 写回继续最后处理。

### 上一轮 52e9624 生产切换与公网复核（2026-08-18 01:26-01:32 CST）

- 候选 `52e9624` 已完成本地 `pnpm check`、7 个 bundle checksum、服务器真实生产 env preflight、
  `127.0.0.1:18082` 隔离 production runtime smoke、SIGTERM 回收和原子 `current` 切换；当前 release 为
  `/home/ps/code/hospital-platform/releases/52e9624`。
- 切换后只重启 `hospital-platform-api-v2.service`；新 API `10.0.0.3:18081` active，旧 Python
  `8001` 继续监听，Worker 仍未启动。内网 live/ready、公网 `/api/v2/health/ready` 均通过，启动日志确认
  `environment=production`、MySQL/Redis/schema `ok`，支付和报告 gate 保持关闭。
- 当前 release 切换窗口的低敏日志聚合为 `parseErrors=0`，但只有运行时健康请求和未登录 401，没有微信登录、患者同步、
  `appointment.records.*` 或 `outpatient.payment.*` 业务事件；不能把“我的挂号”或门诊费用标记为真实业务验收完成。
- 完整证据见 [`release/52e9624-production-acceptance-2026-08-18.md`](release/52e9624-production-acceptance-2026-08-18.md)。
  下一步必须用当前 release 对应的小程序运行包，在有效微信会话中取得登录、患者切换、预约历史和门诊费用的页面/HTTP/日志三层证据。

### 本轮患者目录真实运行观察（2026-08-18）

- 当前 `52e9624` 启动窗口已经出现患者目录同步 `2 requested / 2 succeeded` 和患者目录读取
  `4 requested / 4 loaded`；日志 `parseErrors=0`，患者同步与读取业务证据门禁均通过。完整低敏记录见
  [`release/52e9624-patient-directory-observation-2026-08-18.md`](release/52e9624-patient-directory-observation-2026-08-18.md)。
- 该结果只证明患者目录链路进入当前 release，不能证明多患者切换、失效/恢复、页面展示一致性，
  也不能回填为“我的挂号”或门诊费用证据；当前窗口预约历史和门诊费用事件仍为 `0`。
- 下一次真机验收按“患者刷新/显式切换 → 我的挂号 → 爽约记录 → 门诊待缴/已缴”的顺序执行，
  每个域必须同时保留页面、HTTP 和低敏日志证据；预约写入、支付、医保和 HIS 继续最后处理。
- 2026-08-18：预约历史服务层新增日期窗口二次校验。每条 Provider 记录的 `workDate` 必须位于
  请求的闭区间 `[startDate, endDate]`；发现窗口外记录时整批 fail-closed，不过滤坏行伪装成功，
  并只记录 `work-date-outside-query` 等稳定低敏原因。详细规则见
  [`release/appointment-record-window-validation-2026-08-18.md`](release/appointment-record-window-validation-2026-08-18.md)。
- 2026-08-18：门诊费用服务层补齐账单时间二次校验。`billDate` 必须是严格有效的中国标准时间，
  且落在服务端生成的最近 30 个中国标准时间日闭区间；发现窗口外账单时整批 fail-closed，
  不过滤坏行伪装成功，并记录 `bill-date-outside-query` 等稳定低敏原因。详细规则见
  [`release/outpatient-payment-bill-window-validation-2026-08-18.md`](release/outpatient-payment-bill-window-validation-2026-08-18.md)。

### 上一轮生产切换与公网复核（2026-08-18 00:04-00:06 CST）

- 候选 `b3c9a99` 已完成本地构建、7 个 artifact checksum、服务器真实生产 env preflight 和
  `127.0.0.1:18082` 隔离 runtime smoke；随后原子切换为当前 release，只重启新 Bun/Elysia API。
- 当前 release 为 `/home/ps/code/hospital-platform/releases/b3c9a99`，新 API 监听 `10.0.0.3:18081`；
  旧 Python 服务继续监听 `8001`，Worker 保持 inactive。内网和公网 live、ready、system-ping 均通过，
  公网认证边界仍返回 `401/unauthorized`。
- 当前 release 启动后至 00:17 CST 的 journald 脱敏聚合为 `parseErrors=0`、HTTP `200=20/401=7`；随后 00:12-00:14 CST 观察到 1 次微信登录成功、2 次患者同步成功和 4 次患者目录读取成功，但仍没有 `appointment.records.requested/synced` 或 `outpatient.payment.records.requested/loaded`。预约历史和门诊费用仍不能标记为真实线上业务验收完成。
- 发布与共存证据见 [`release/b3c9a99-production-acceptance-2026-08-18.md`](release/b3c9a99-production-acceptance-2026-08-18.md)。
  首次真实会话观察见 [`release/b3c9a99-p0-business-observation-2026-08-18.md`](release/b3c9a99-p0-business-observation-2026-08-18.md)。
  下一步是使用有效微信会话完成真机三层业务验收，不是继续用 readiness 或未登录 401 代替业务证据。
- 本轮继续收紧预约/门诊费用只读边界：Provider 展示文本和预约排班快照引用现在拒绝控制字符、首尾空白及超出长度的值，避免异常文本进入小程序读模型、数据库快照或后续写入前事实。该修正不猜测 Provider 字段、不打开预约写入、支付、医保或 HIS；新增 adapter、domain 和 persistence 回归测试已随全量门禁通过。
- 2026-08-18：门诊费用读取新增服务层第二道 Provider 结果校验。即使网关适配器返回了结果，服务仍会再次确认返回集合、请求状态、有限且唯一的费用引用、日期、金额和展示文本；错状态、重复引用或结构异常统一返回 `502/provider-response-invalid`，不会降级为空列表，也不会把原始 Provider 响应写入日志。该修正只收紧只读数据边界，未打开门诊缴费、医保支付或 HIS 写回；定向测试和全量 `pnpm check` 已通过。
- 2026-08-18：继续收紧预约历史只读链：根据旧 Python/小程序源码确认众阳预约包络的成功码为 `success=true` 或 `code=0/0000`，`HTTP 200 + 业务失败空数组` 不再被当作“没有预约”；service 增加第二道读模型校验和公共字段重新投影，异常统一为 `502/provider-response-invalid` 并记录有限原因。该修正未打开预约详情、取消、支付、医保或 HIS 写回，真实 Provider/公网/真机证据仍待重新取得。
- 本轮继续按旧端 `user.vue`、`userNavData.json`、`my_registration.vue` 和
  `patient-hospital-selector.vue` 对照“我的/我的挂号”：再次核对背景、头像、家庭成员箭头和 9 个菜单图标均与旧资源逐字节一致，
  并为挂号页院区行补齐旧端右侧箭头和底部选择面板。当前面板只展示已确认的单院区，不猜测动态院区或透传 provider 参数；
  小程序 92 项测试、873 个断言、全仓 `pnpm check` 均通过。该修正只改变页面视觉和单院区静态交互，尚未取得新的微信工具/真机业务证据。
- 登录手册、P0 验收手册、迁移检查点和差距审计已同步当前 `b3c9a99`；旧 release 业务结果明确标记为历史窗口，不能直接替代当前版本的微信、预约或门诊费用三层证据。

### 切换前生产与公网复核（2026-08-17 22:57-22:58 CST）

- 已通过 SSH 对 `192.168.112.172` 完成只读核验：新 Bun/Elysia 服务由 `hospital-platform-api-v2.service`
  托管，当前 release 目录为 `bf67b9673708a6e5188880eba9a6d29b8e78f0c5`，监听 `10.0.0.3:18081`；旧
  Python 服务仍在 `8001` 监听，未发生覆盖或停机。
- 新服务以 production 模式运行，MySQL、Redis、schema 探针均为 `ok`；微信身份、预约目录、预约记录和
  门诊缴费查询配置已加载，微信支付和报告仍关闭。
- 当前 release 启动后的低敏日志有微信登录 `2 requested / 2 succeeded`、患者目录同步 `31/31`、患者目录读取
  `62 requested / 62 loaded`；`appointment.*`、`outpatient.payment.*` 和 `report.*` 均为 `0`，因此不能把
  “我的挂号”或门诊缴费标记为真实线上业务验收完成。
- 公网 `/health/live`、`/health/ready`、`/system/ping` 均返回 `200`；无会话预约历史和门诊费用均返回 `401`，
  认证边界生效。本次没有读取凭据、修改服务器或重启服务。完整低敏记录见
  [`release/current-server-p0-observation-2026-08-17-2257.md`](release/current-server-p0-observation-2026-08-17-2257.md)。
- 旧端源码对照确认当前原生“我的/我的挂号”已经保留背景、功能分组、图标、固定底部栏和记录卡结构；需要补的
  是微信工具/真机三层视觉和业务证据，不是继续臆造 provider 字段。视觉契约见
  [`migration/personal-center-visual-contract.md`](migration/personal-center-visual-contract.md)。

### 线上实时状态（2026-08-17 20:51 CST）

- 本轮以本地仓库 `main` 的前序提交 `ff5ea6e` 为代码基线；本轮只完成代码、测试和验收工具改进，未部署。对
  `ps@192.168.112.172` 的 SSH 只读复核被当前环境拒绝（`Permission denied (publickey,password)`），
  因而本文此前记录的 `bf67b96`、`5f5915e` 等线上 release 只能作为历史证据，不能在本轮重新宣称为当前线上状态。
  后续任何生产结论都必须先取得新的 release provenance、低敏日志和公网/真机证据。
- 本轮新增 `p0-business-evidence-audit`：它消费 `p0-log-aggregate --json` 的安全计数，要求每个选定业务域
  同时出现请求事件和明确成功事件，并在 `parseErrors` 或事件缺失时失败。该工具只证明服务端业务模块确实
  产生过事件，不替代患者归属、HTTP、页面和 trace 交叉核对；支付、医保、预约写入和病历仍未开放。
- 本轮又将患者范围错误解释收敛到 `patientContextErrorMessage`：预约记录、爽约记录、报告目录和门诊费用页
  不再各自复制 stale/未绑定/临床映射不可用文案；领域服务未配置和费用映射缺失等专属状态仍由页面先处理。
  该修正只改变客户端错误语义复用，不改变 API、Provider、数据查询或支付/医保边界。
- 本轮继续补齐患者切换竞态门禁：上述四个页面在发起查询和落地异步响应前都校验
  `isCurrentSelectedPatient`；页面实例 request guard 无法识别跨页面换人时，旧患者响应会被丢弃。
  该修正只改变客户端状态回写边界，不改变 API、Provider、数据查询或支付/医保边界。
- 本轮又将首页、我的和患者选择页的目录状态错误码收敛到
  `patientSelectionResolutionError` / `patientSelectionResolutionMessage`，稳定中文文案继续由公共 API 错误表维护，
  页面不再复制 stale、未绑定和临床映射不可用的分支。该修正只改变客户端错误解释，不改变患者目录、Provider 或支付/医保边界。
- 本轮继续修正预约目录的级联加载权：初始科室排班被用户切换淘汰后，外层目录请求不能提前关闭新科室的
  `loading`；只有仍持有对应 schedule token 的请求才能结束加载。该修正只改变小程序状态机，不改变预约目录
  Provider 请求、号源字段或预约写入边界。
- 2026-08-17 21:29 CST：再次只读复核当前 `bf67b96`。新 API `18081` 与旧 Python `8001` 仍共存，公网 `health/ready` 返回 `200`、`no-store`，database/redis/schema 均为 `ok`；当前 release 自 `20:30:25` 启动后，日志聚合 `parseErrors=0`，有微信登录 1/1、患者同步 9/9、患者目录读取 18/18，但 `appointment.*`、`outpatient.payment.*`、`report.*` 和 `user.profile.*` 均为 0。该结果只推进运行时、认证和患者目录证据，不能标记“我的挂号”、门诊费用、报告或真机业务已验收。详见 [`release/current-release-p0-observation-2026-08-17-2129.md`](release/current-release-p0-observation-2026-08-17-2129.md)。
- 当前 `bf67b96` 仍在生产运行，新 API `10.0.0.3:18081` 与旧 Python `8001` 共存；公网 live/ready/system-ping 为 `200/200/200`，live/ready 返回 `Cache-Control: no-store`。
- 以 `service.started=2026-08-17 20:30:25 CST` 为边界的当前 release 日志聚合 `parseErrors=0`，观察到患者同步成功链 3 次、患者目录读取成功 6 次；没有新的 `auth.wechat.*`、`appointment.records.*` 或 `outpatient.payment.*` 事件。
- 本次只能推进运行时、共存和患者同步日志证据，不能把“我的挂号”或门诊费用标记为真实线上验收；下一步必须由最新小程序运行包在有效微信会话中逐页触发并保存页面、HTTP、低敏日志三层证据。详见 [`release/current-release-p0-observation-2026-08-17.md`](release/current-release-p0-observation-2026-08-17.md)。
- 2026-08-17 21:03-21:04 CST：候选 `23e2faf` 已上传并完成真实生产依赖 preflight、production mode
  隔离启动、ready 连续 6/6、system-ping 和未登录 401 验收；候选端口已释放，线上 `current=bf67b96`、
  新 API `18081` 和旧 Python `8001` 均未改变。候选包含 `profile-read` 只读 smoke，但尚未使用真实 Bearer
  取得资料业务证据，完整记录见 [`release/candidate-23e2faf-preproduction-smoke-2026-08-17.md`](release/candidate-23e2faf-preproduction-smoke-2026-08-17.md)。
- 2026-08-17 21:08 CST：候选清理后再次对公网 current 执行 readiness 6/6、system-ping 和未登录 401，均通过；
  当前 release 的 journald 聚合 `parseErrors=0`，没有新增微信、预约历史、门诊费用或普通资料业务事件。
  该结果只确认公网 current 未受候选上传/停止影响，不能替代真实微信会话和真机业务验收。
- 本轮继续收紧“我的挂号/爽约记录”的客户端查询边界：新增 dashboard service 的
  `createAppointmentRecordQuery`，集中生成 history 前后各 90 天和 missed 过去 90 天窗口，并在发请求前
  校验内部 `patientId`；新增北京时间自然日、窗口差异和空标识回归测试，小程序测试达到 83 项通过。
  该修正未部署、不改变 API/Provider 请求契约，也未新增真实微信、Provider 或真机证据。
- 本轮继续按旧端源码复核“我的/我的挂号”的视觉契约：确认背景、头像、家庭成员箭头、9 个功能图标均与旧资源一致，
  收紧图标填充模式、挂号卡触摸反馈和长患者名布局，并新增 [`migration/personal-center-visual-contract.md`](migration/personal-center-visual-contract.md)。
  详情、预问诊、动态院区、预约写入、支付和医保仍按业务 contract 保持关闭；本轮只改变展示层和文档/验收门禁，未部署且未新增真机视觉证据。
- 前序提交 `ff5ea6e` 继续收敛患者上下文业务边界：预约记录、爽约记录、报告目录和门诊费用页统一使用
  `loadCurrentPatient`，只重读最新 owner-scoped 目录并复用同一套 ready/stale/unavailable 解析；页面读取不会隐式触发 Provider 同步。
  该修正只改变客户端边界复用和静态门禁，未部署、未扩大 Provider 请求，也未打开支付、医保或预约写入；详见
  [`migration/patient-context-read-contract.md`](migration/patient-context-read-contract.md)。
- 本轮门诊费用业务语义复核发现旧端顶部“缴费后如需退费”提示会误导用户认为新页面已开放支付；现改为明确的只读查询提示，并在验收测试与业务正确性文档中锁定该边界。
  本轮不改费用 API、Provider、支付、医保或结算状态机，未部署且未新增真实业务证据。
- 本轮继续收紧原生资料页和患者选择页的页面栈边界：保存/切换成功后的 toast 延迟返回现在绑定当前页面实例，
  `onUnload` 会撤销待返回标志，避免用户手动离开后旧回调误操作新的页面栈；资料性别 picker 也先归一化非法事件值。
  该修正只改变小程序生命周期和输入状态，不改变患者目录、预约历史、费用、Provider、支付或医保边界。
- 本轮继续修正爽约记录的患者快照边界：患者卡片不再早于预约历史请求写入，只有当前请求、当前选择和 `missed`
  派生结果同时通过校验后才提交卡片与列表，避免切换就诊人期间出现卡片与列表短暂错配。该修正只改变只读页面状态
  提交时序，不改变预约状态、Provider 查询窗口或预约写入边界。
- 同一患者快照规则已扩展到报告目录和门诊费用：患者卡片只有在对应只读读模型通过当前请求和当前患者校验后才提交，
  防止报告/费用请求失败或切换患者期间留下未被结果证明的旧上下文。该修正不改变报告、费用、支付或医保 contract。
- 本轮补齐“我的”页首次展示生命周期：移除基于 `loading` 的首次 `onShow` 推断，改为页面实例 `hasShown`，
  避免快速响应时重复请求，同时保证从资料页或患者选择页返回时仍会刷新会话和患者上下文。该修正只改变小程序读取时序。

### 线上实时状态（2026-08-17 17:55 CST）

- 2026-08-17 17:55 CST 已从 `0b6f38f` 原子切换到 `5f5915e`；候选五个 bundle checksum、真实生产 env preflight、`127.0.0.1:18082` 隔离 smoke 和公网 runtime smoke 均通过。新 API `18081` 仅重启自身，旧 Python `8001` 继续监听，Worker inactive。`5f5915e` 收紧普通资料未知字段 contract，支付、医保、HIS、报告和预约写入仍关闭，完整证据见 [`release/5f5915e-production-acceptance-2026-08-17.md`](release/5f5915e-production-acceptance-2026-08-17.md)。
- `f562d61` 继续完成原生“我的/我的挂号”的视觉边界：全宽就诊人/院区区、状态标签、列表背景、预约状态图标、旧端功能分组、背景资源和固定底部导航均已纳入本地运行包；这只改变小程序展示层，不改变 Provider、预约写入、支付、医保或 HIS 边界。75 项小程序测试、TypeScript 构建、Biome 和文档断链审计通过，真实微信/真机视觉仍待取证。
- 上一 release `0b6f38f` 已从 `daee96d` 原子切换完成；其生产 env preflight、候选临时端口 smoke 和公网 `/api/v2` 运行时 smoke 均通过，旧 Python `8001` 保持监听，Worker inactive。此次固定门诊费用 Provider 渠道码只能在 adapter 构造时注入，不打开支付、医保、报告、预约写入或 HIS 写入，历史证据见 [`release/0b6f38f-production-acceptance-2026-08-17.md`](release/0b6f38f-production-acceptance-2026-08-17.md)。
- 上一 release `9833a01` 已完成从 `3ab0a6c` 的原子切换和基础运行时验收；本次已继续切换到 `daee96d`，其历史证据见 [`release/9833a01-production-acceptance-2026-08-17.md`](release/9833a01-production-acceptance-2026-08-17.md)。
- `0016_patient_directory_sync_owner_index` 已由候选 bundle 执行成功，marker、`owner_user_id,provider_name,status,lease_until` 索引列顺序和 schema probe 均通过；错误的跨平台打包在切换前被拦截，未产生 schema 半成品。当前 `5f5915e` 已在目标服务器通过该 schema gate；支付、医保、HIS、报告和 Worker 仍关闭。
- 候选 `0b6f38f` runtime smoke 完成 readiness 连续 6/6、system ping 200、未登录受保护路由 401；这只是运行边界证据，真实微信会话、Redis TTL、多患者切换、普通资料读写/409、预约历史和门诊费用仍待真机三层验收。
- `0b6f38f` 切换后的最新 journald 窗口只有 1 次 production 启动、13 次 HTTP 200 运行/系统探针和 6 次未登录 401；`auth.wechat.*`、`patient.directory.*`、`appointment.*`、`outpatient.payment.*` 和 `report.*` 均为 0。该结果证明运行和认证边界，不证明任何 Provider 业务成功；新 API `18081` 与旧 Python `8001` 仍同时监听，详见 [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md)。
- 2026-08-17 18:23 CST 的当前 release `5f5915e` 低敏 SSH 观察确认：1 次微信登录成功、7 次患者同步成功、14 次患者目录读取，观测目录仍为单患者；最近 30 分钟没有预约、门诊费用或报告事件。该证据只推进微信/单患者目录链的运行观察，不替代 Redis TTL、多患者切换、预约历史、门诊费用或真机验收，详见 [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md)。
- 2026-08-17 19:00-19:01 CST 的当前 release `5f5915e` 取得真实微信会话的普通资料默认值读取证据：`GET /me/profile` 返回 200，日志完成 `requested → loaded` 且 `persisted=false`，页面展示资料字段和边界说明；读取没有创建资料行。首次 `PUT`、409 版本冲突、真机视觉和敏感身份字段仍未验收，自动化开发者工具控制层日志也不能被记作干净真机证据，详见 [`release/user-profile-readonly-observation-2026-08-17.md`](release/user-profile-readonly-observation-2026-08-17.md)。
- 2026-08-17：完成首页就诊人二维码契约审计。旧端第三方二维码 URL 只证明页面展示行为，不证明医院扫码事实；新端保持安全关闭态，未新增 API、外部请求或伪 token。正式开放前仍需医院/HIS 扫码字段、签名、短 TTL、防重放、撤销、扫码回执和真机设备证据，详见 [`release/qr-contract-audit-2026-08-17.md`](release/qr-contract-audit-2026-08-17.md)。
- 2026-08-17 19:17 CST：确认新 API 的真实 Redis 对端为远端 DB3；服务器侧 ioredis 连接成功，但生产 ACL 拒绝 `SCAN hospital:session:*`，因此会话数量、TTL 范围和过期后 401 仍未验收。本机 Redis 空库不再作为证据；不放宽应用 ACL，后续需要独立最小权限审计身份或运维聚合结果，详见 [`release/redis-session-ttl-acl-observation-2026-08-17.md`](release/redis-session-ttl-acl-observation-2026-08-17.md)。
- 2026-08-17 19:48 CST：重新按当前 `5f5915e` 的 `service.started=17:55:17` 切分 journald，观察到微信登录 2/2、
  患者同步 22/22、患者读取 57/57、预约历史 3/3、门诊费用 2/2、普通资料读取 11/11，HTTP 200/401 为 137/7，
  `parseErrors=0`，去重 `providerRequestId=29`。这只证明当前 release 已进入相关只读链路，不能证明多患者、TTL、
  非空费用、资料 PUT/409、页面字段或真机闭环；支付、医保、退款和 HIS 继续关闭，详见
  [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md)。
- 2026-08-17：旧仓库迁移台账复核发现 `module_common` 实际 38 个挂载路由、旧服务总数 195 个，
  并补登记挂号插件支付/退款的 4 条旧编排入口及第 3 个微信支付调起页面；`pnpm migration:audit`
  已恢复通过。它们只作为迁移事实和风险边界记录，仍归入支付/医保/退款/HIS 的“最后处理”，没有注册到
  新患者端 API。

### 线上实时状态（历史快照：2026-08-17 02:56 CST）

- 新 API `current=131fb5a`，systemd unit active，公网入口为 `https://test-hp.meiyi.pro/api/v2`；内外网 live/ready、no-store、system-ping 已通过，启动日志确认 `runtimeMode=production` 且 MySQL/Redis/schema 为 `ok`。本次只标准化持久化瞬态错误码日志，不改变业务 response 或写入重试边界；这是 `6d58c9c` 发布前的历史快照，证据见 [`release/131fb5a-production-acceptance-2026-08-17.md`](release/131fb5a-production-acceptance-2026-08-17.md)。
- 旧 Python API 仍监听 `0.0.0.0:8001`，未停止；Worker 仍 inactive。支付、医保、HIS、报告 gate 仍关闭。
- 02:18:26 CST 的一次真实微信登录因 `PersistenceUnavailableError` 返回 503；约 3 秒后下一次登录成功，随后 `/patients` 和完整患者同步均返回 200，记录 1 条 active 患者和 1 条 `his-patient` 映射，并读取到预约科室 62 条、排班 1 条。该组真实微信登录与单患者目录同步事件发生在 `527d163` 切换前，只能作为 `ca5a372` 的部分验收证据；当时没有安全底层错误码，不能断言具体网络/数据库根因。
- 23:50:17-23:50:18 的预约科室/排班只读证据来自前一 release `41c9c18`；02:18 CST 的科室/排班读取来自 `ca5a372`，科室 62 条、排班 1 条均返回 200，且 `snapshotPersistenceStatus=persisted`；Redis 实际 TTL、多就诊人切换/失效恢复、预约历史/报告/门诊费用 Provider 读操作、真机页面网络对齐和普通资料真实读写仍未完成。这些是历史业务证据，当前 release 的运行证据见 [`release/5c4e7cf-production-acceptance-2026-08-17.md`](release/5c4e7cf-production-acceptance-2026-08-17.md)。

### 2026-08-17 迁移差距审计

- 当前下一块不是继续增加静态页面，而是完成已有只读纵向切片的真实证据：患者 TTL/多患者、预约历史、门诊费用列表和普通资料；`5f5915e` 已部署但资料真实读写/409 尚未验收，报告详情、病历、绑定、动态医院和外部入口仍等待新的 Provider 文档及脱敏样例。
- `7807aa8` 修正“我的”页的资料上下文：资料卡现在读取已冻结的普通资料昵称；普通资料读取失败只降级为安全兜底并提示重试，不会清理已经确认的患者上下文；资料卡提示也与实际跳转的个人资料页一致。该修正已通过 63 项小程序验收、typecheck、lint、格式和运行包构建，真实微信资料读写/409 与真机证据仍待完成。
- 2026-08-17 线上只读复核确认新旧服务共存、production mode、MySQL/Redis/schema readiness 和公网基础边界均正常；远端 Redis `PING` 通过但当前 SSH 账号不具备会话 key `SCAN` 权限，TTL 仍未验证。不得把本机 Redis 空库或 ACL 拒绝解释成“没有会话”，证据见 [`release/current-server-readonly-observability-2026-08-17.md`](release/current-server-readonly-observability-2026-08-17.md)。
- 本轮修复门诊费用 adapter 的金额边界：缺失金额不再降级为 `0` 分，显式零元仍可通过；这条规则已加入 adapter 测试和迁移差距审计。完整分层、证据等级和新文档接收门禁见 [`migration/migration-gap-audit-2026-08-17.md`](migration/migration-gap-audit-2026-08-17.md)。
- `d71ecd4`、`3609944` 和 `7a03df7` 继续收紧只读 adapter：门诊费用展示字段按公开 contract 限长，LIS 单位限制为 64 字符；2.6.33 未确认的 `waitPayAmount`、`registerDept`、`registerDoctor` 不再覆盖已确认字段，只有 `amount` 缺失时保持 fail-closed。该修正不改变支付/医保 gate，也未部署线上。
- 本轮预约排班审计进一步移除 `usableNum`/`remainingNumber` 号源 fallback；当前只接受已确认的 `usableSourceNum`，缺失时 fail-closed，避免旧端不同接口字段被错误合并。该修正仅影响只读 adapter 边界，未打开预约写入或锁号。
- 本轮为 runtime/provider smoke 增加有界 readiness 连续采样：库调用默认保持单次兼容语义，命令行默认 3 次，正式生产验收建议显式使用 6 次、间隔 2000 毫秒；任意中间 `not_ready` 都不能被最后一次恢复掩盖。该门禁只证明运行前置稳定，仍不替代真实微信、患者、Provider、真机或支付验收，规则见 [`release/readiness-stability-gate.md`](release/readiness-stability-gate.md)。
- `ed250ec` 的本地 runtime smoke 已对公网 `/api/v2` 完成 6/6 readiness、no-store、system-ping 和未登录 401 连续复核；该证据仍不代表 `ed250ec` 已部署，也不替代服务器 bundle provenance、journald、微信会话或真机业务验收。详见 [`release/current-public-readiness-stability-2026-08-17.md`](release/current-public-readiness-stability-2026-08-17.md)。
- 上一 release `9833a01` 已完成真实生产 env preflight、`127.0.0.1:18082` 隔离 runtime smoke、原子切换和切换后公网 6/6 runtime smoke；本次只包含报告详情引用故障隔离和文档修正，不打开支付、医保、报告、预约写入或 HIS 写入。真实微信登录、多患者和 Provider 业务仍待在当前版本重新验收，历史证据见 [`release/9833a01-production-acceptance-2026-08-17.md`](release/9833a01-production-acceptance-2026-08-17.md)。
- `daee96d` 已把 Provider 失败诊断统一为低敏白名单字段，并覆盖预约、门诊费用、报告和微信登录失败日志；该版本已通过本地门禁、生产 preflight、隔离 smoke 和公网运行时 smoke。该能力只增强关联性，不替代 Provider contract 或真实业务验收，证据见 [`release/daee96d-production-acceptance-2026-08-17.md`](release/daee96d-production-acceptance-2026-08-17.md)。
- 原生小程序补齐患者同步期间的进程级协调和统一路由门禁：任意页面在同步快照时，新增或更换就诊人不会再进入选择页并发发起第二条幂等同步；新增跨页面源码验收和协调器测试通过，待下一次真机更新运行包后观察真实提示。

### 已经具备

- 新旧服务共存：旧 Python 服务继续使用 `8001`，新 Elysia 服务使用 `18081`，公网通过 `/api/v2` 隔离。
- 新旧服务已通过当前服务器配置的脱敏比对确认共用远端 MySQL `8.130.127.184:3306/hospital-dev`，新服务
  只使用 `hp_*` 表，旧服务继续使用 legacy 表；旧 Redis 使用 DB1、新 API 使用 DB3，Redis 会话空间隔离。
  MongoDB、旧 Redis namespace、旧任务和其他旧基础设施仍不属于已迁移能力。
- 新服务已具备生产模式启动日志、MySQL/Redis/schema 探针、Pino 结构化日志和 fail-closed 依赖注入。
- 微信登录、平台会话、就诊人列表、就诊人独立选择页面已经形成患者端纵向切片；服务端真实登录和单患者同步已有生产日志证据，患者切换与真机完整验收仍未完成。
- 普通个人资料已形成独立纵向切片：`GET/PUT /api/v2/me/profile` 只处理昵称、性别、年龄、邮箱，使用 `version` 乐观锁；0014、生产 schema、API 重启、ready 和未登录公网 401 已验收，未知字段 `400 validation` 已合入 `5f5915e` 的 contract 与回归测试，但尚未取得带真实会话的公网请求证据；真实微信读写/409 与真机证据仍待完成，头像、实名、手机号和微信身份继续关闭。证据见 [`release/5f5915e-production-acceptance-2026-08-17.md`](release/5f5915e-production-acceptance-2026-08-17.md)。
- 预约科室、排班、预约历史的只读 contract、adapter、服务端脱敏和排班短期快照已经实现；前一 release `41c9c18` 已取得科室/排班真实 Provider 结果且快照持久化成功，但不能把目录 200 或快照 `persisted` 当成锁号/预约写入授权。
- 爽约记录已实现为预约历史 `status=missed` 的安全派生子视图，固定查询过去 90 天并支持切换就诊人；未知状态不推断为爽约，真实 provider、公网和真机证据仍待完成。
- 预约挂号页面已恢复旧版“两列级联”交互：左侧科室独立滚动，右侧按日期和 12 条分批展示号源，避免一次性渲染全部 provider 排班。
- 门诊缴费只读目录、原生页面和“我的”页面基础入口已经接入；支付调起、医保授权、结算回写仍保持明确未开放。
- 门诊费用查询窗口已固定为 `Asia/Shanghai` 的最近 30 个中国标准时间日；不会因服务器运行时区是 UTC 或其他时区而改变 provider 查询语义。
- 预约排班、预约历史和报告目录已冻结当前“起止日期差值”校验边界（31/366/366 天），并补齐等于上限、超过上限和 provider 不调用的测试；provider `endDate` 包含规则仍待新文档确认，边界审计见 [`migration/date-window-boundary-audit.md`](migration/date-window-boundary-audit.md)。
- 小程序预约历史、报告和门诊费用窗口已同步采用中国标准时间日历算法；跨中国标准时间零点时不会继续使用设备本地自然日。
- 首页就诊人卡片已改为展示服务端脱敏卡号，绑定入口进入独立选择页；报告查询已从首页后台状态改为独立报告目录页，并按 10 条分批展示。
- 首页和“我的”页的患者目录读取已补齐最后一次请求获胜守卫，避免会话恢复、同步、下拉刷新或返回选择页时旧响应覆盖当前就诊人；真机并发操作证据仍待补齐。
- 首页返回生命周期已补齐失效目录保护：从患者选择页返回时不再只比较本地 `patientId`，而是重新读取 owner-scoped 目录；旧患者被标记 inactive 或目录为空时，首页会清除展示上下文并要求重新选择。空目录不会删除本地选择，避免目录恢复后静默默认第一位；该逻辑已有原生 acceptance 断言，真机返回/同步竞态仍待验收。
- 医院列表的旧端静态单院区卡片已按原始图片、提示栏、卡片布局和预约前置语义迁移；公众号静态通知说明页、意见反馈帮助页已按旧端文案和静态交互迁移；院内导航的旧端静态地图页也已按原始图片、背景色、`aspectFit` 和点击预览行为迁移；动态医院/院区、楼层定位和实时路线仍未开放。
- 微信支付订单、预支付尝试、回调去重、查单补偿的领域和持久化基础已经实现，但支付 gate 仍关闭。
- 健康知识已完成旧端接口/表结构到新版本化 schema 的静态映射和导入时间边界；真实内容与临床审核未到位前，患者 GET 路由继续不挂载。
- 门诊就诊记录目录已完成旧端字段差异和候选 contract 草案；provider 文档确认前不注册 `medical-records` 路由，不开放病历正文或诊断字段。
- 便民服务已完成旧 13 个路由、旧表覆盖逻辑和患者/医生字段风险审计；新端仍未注册，边界已拆为反馈、临床问卷、医生关系和预约后预问诊四个领域。
- 个人中心扩展、患者新增/绑卡、法律协议、签名、订阅、外部 WebView、互联网医院和采血预约已完成旧页面副作用审计；旧首页顶部实际跳转的静态医院列表入口已恢复，但旧顶层互联网医院 web-view、真实反馈写入、动态机构/院区、路线、关注状态和票据仍必须按独立 contract 重做。
- 患者新增/绑卡已进一步形成独立契约草案：明确旧端“查询异常即继续建档”的禁止迁移行为、服务端状态机、owner/协议/幂等/超时恢复不变量和 PB-01 至 PB-16 provider 问题；在新 provider 文档冻结前，写入路由继续关闭。
- 旧端非页面逻辑（直连 provider、WebSocket、身份/患者持久化、临床问卷组件和静态入口配置）已完成单独审计；新端不得把这些旧 helper 当作可兼容迁移，边界见 [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md)。
- 静态页面与关闭能力已完成真值审计：意见反馈旧端没有真实提交接口，公众号二维码是注释代码，订阅开关只是内存假保存；静态医院卡片、公众号说明、反馈帮助和院内地图按旧端真实行为迁移，未来工单/二维码/订阅授权继续作为独立 contract，不复制假成功。详见 [`migration/static-and-closed-feature-parity.md`](migration/static-and-closed-feature-parity.md)。
- 旧服务基础设施与运维边界已完成单独审计：旧 Redis 多 namespace、Mongo 连接、APScheduler/任务管理、本地文件资源、AI/WebSocket 和 Admin/RBAC 均未被新患者 API 全量替代；共存门禁见 [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md)。
- 2026-08-16 生产 Redis 会话隔离已完成：新 API 使用独立 DB3/`hospital_v2` ACL，旧 Python 仍使用 DB1/旧全权限账号；新 API 已由 systemd 运行且公网 v2 健康检查可达，但新 Worker 未启动、报告 gate 关闭、旧 Python 仍由手工进程运行；证据见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- `f2c6d99` 和 `cb11bc8` 已通过本地完整门禁，并在生产 env 隔离的临时端口 `18082` 完成候选 release smoke：中文稳定错误契约、认证失败边界和 persistence 探针状态日志均已验证；当前生产 `current` 仍为 `55fce6c`，候选版本尚未切换公网。证据见 [`release/observability-error-contract-smoke-2026-08-16.md`](release/observability-error-contract-smoke-2026-08-16.md)。
- `3a37e7e` 已通过本地完整门禁，并在生产 env 隔离的临时端口 `18082` 完成最新候选 smoke：预约排班、预约记录和报告查询错误契约统一为稳定中文文案；当前生产 `current` 仍为 `55fce6c`，公网、provider 和真机验收仍未完成。证据见 [`release/query-error-contract-smoke-2026-08-16.md`](release/query-error-contract-smoke-2026-08-16.md)。
- 当前架构边界审计已从单一 API 客户端检查扩展为扫描原生小程序全部生产源码的 26 条规则；新增未验证外部入口和旧端假患者标记的回流保护。它只证明旧 provider/敏感标识边界没有回流，不替代 provider、公网和真机业务验收。
- 原生小程序构建已增加动态页面一致性门禁：从 `app.json` 读取全部页面，逐项检查 `.json/.wxml/.wxss/.ts` 源文件和 `dist/*.js` 运行文件，并校验 WXML 事件方法、页面跳转目标、本地资源和 WXSS 图片边界，避免新增页面再次出现真机找不到 `.js`、跳转 404 或 WXSS 本地资源错误。
- 当前公共 API 文档已增加列表语义门禁：明确 `total = items.length`、空列表与依赖失败的区别、各只读接口的排序/日期窗口，以及预约排班和报告页的本地渲染分批不等于服务端分页；后续取得 provider 分页文档后必须先更新 contract 再改代码。
- 候选代码已为健康探针响应明确设置 `Cache-Control: no-store`；公网切换到 `d177991` 后 live/ready 已确认保留该指令。后续发布判断仍必须以未缓存的 `/api/v2/health/ready` 和服务端日志为准，不能用单次 200 推导业务验收完成。
- 2026-08-16 17:02 CST 只读复核修正了 16:57 的临时判断：唯一公网 `X-Request-Id` 已在 SSH 主机 PID `2935571`（`current=55fce6c`）的 journald 中关联到同一个 `/health/ready` 请求，随后内网探针也恢复 `database/redis/schema=ok`；此前差异属于瞬时 readiness 恢复，不是另一 upstream。当前 `55fce6c` 内外层响应仍缺少候选代码要求的 `Cache-Control: no-store`，且尚未部署仓库 `main` 的待发布最新提交；发布前必须以 `git rev-parse HEAD` 固定候选版本。详见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 17:59-18:00 CST 复核确认服务器 `current=55fce6c`、API active、旧 Python `8001` 仍在、Worker inactive；仓库 `main=3c8c01b` 尚未部署。公网系统探针和患者端未登录路由的 200/401 边界正常，但 health/live、health/ready 仍缺 `Cache-Control: no-store`；下一步先完成候选 release 固定、临时端口验证和原子切换，再进行 P0 真实业务验收，详见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 18:06-18:07 CST 使用修正后的 Smoke 显式验收公网 `/api/v2`：system-ping 通过，live/ready 均因公网响应缺少 `Cache-Control: no-store` 被门禁拒绝；同时确认 Nginx 透传 `x-request-id`。这证明公网 Smoke 已不再错误地把 `/api/v1` 当作公网路径，但 no-store 仍是线上发布阻断项，证据见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 已为 `ps` 安装新 API 的窄权限 systemd NOPASSWD 规则，并验证 API `is-active` 可无密码执行、worker 不在授权范围；随后候选 `d177991` 已完成固定、临时 smoke、原子切换和公网 no-store 验收，旧 Python `8001` 保持运行。权限证据见 [`release/systemd-narrow-permission-acceptance-2026-08-16.md`](release/systemd-narrow-permission-acceptance-2026-08-16.md)，切换证据见 [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md)。
- 2026-08-16 收到 2.6.7 挂号登记、2.10.4.2 支付挂号和 2.6.65.7 外部退款 Provider 文档，已完成脱敏元数据、字段、状态和依赖标准化，记录见 [`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md)。由于执行预约、排班/号源、患者档案、支付登记和退款查单文档缺失，当前状态保持 `normalized`，没有把预约写入、支付挂号或退款误标为已迁移。
- 候选 `d8f14f1` 已完成患者归属门禁的代码测试、真实生产 env preflight 和临时 production runtime smoke，但没有切换公网 `current`；真实 session、Provider 只读业务和真机证据仍待完成。证据见 [`release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md)。
- 2026-08-16 21:00-22:06 CST 复核 `d177991` 切换窗口的真实日志：没有出现该 release 的微信、患者、预约、报告或门诊费用业务事件；MySQL 与 Schema 探针发生四次同步瞬态不可用后恢复，Redis 始终正常。该历史证据不能替代当前 release 的真实业务验收，详见 [`release/current-d177991-observability-acceptance-2026-08-16.md`](release/current-d177991-observability-acceptance-2026-08-16.md)。
- 候选 `a11f117` 已完成 MySQL/Schema 只读探针一次有界重试的本地完整门禁、真实生产 env preflight、`127.0.0.1:18088` 隔离 smoke，并于 22:24 CST 原子切换为当前 `current`；该修复降低坏连接造成的瞬态 readiness 误报，但不替代数据库稳定性观察或真实业务验收，证据见 [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md)。
- 2026-08-16 22:24-22:25 CST：`a11f117` 在依赖探针恢复后原子切换到生产 `current`，只重启新 API；内网 `10.0.0.3:18081`、公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 全部通过，旧 Python `8001` PID/监听保持不变，Worker 仍 inactive。启动日志确认 production mode、MySQL/Redis/schema `ok`；本次没有业务 Provider 请求或业务写入，真实微信/患者/预约/费用/真机仍待分层验收。证据见 [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md)。
- 2026-08-16 23:37-23:50 CST：`a11f117` 首次观察到预约目录的快照持久化暂时不可用；切换 `41c9c18` 后再次打开页面，科室 Provider 返回 62 条、排班 Provider 返回 1 条，快照持久化成功并记录 `snapshotPersistenceStatus=persisted`。该策略已在服务代码、测试和日志字段中明确，只有 `persisted` 才能作为未来写入前置观察事实；证据见 [`release/41c9c18-production-acceptance-2026-08-16.md`](release/41c9c18-production-acceptance-2026-08-16.md)。
- 2026-08-16 22:37 CST：`a11f117` 切换后连续 10 次、约 21 秒 readiness 均为 `ready`，切换后日志没有新的 persistence 探针抖动或业务事件；运行时前置已稳定，可以进入真实微信会话验收，但不能把这段观察当作患者、Provider 或真机业务成功。
- 2026-08-16：公网冻结检查确认带完整查询参数的报告、预约排班和门诊费用入口在未登录时均返回 401；病历、医保授权、预约写入等未注册入口返回 404。完全缺少报告参数时仅返回通用 400 `validation`，不包含 schema 细节、患者数据或 Provider 错误；该行为作为当前 Elysia 协议校验顺序记录，不改变业务 route 的 fail-closed 边界。

### 当前已验证的问题

- 线上预约 gate 曾经出现过未配置依赖；目前 gate 已经配置，科室/排班目录的 provider 只读请求已恢复。
- 从同一服务器直接请求众阳科室和排班地址可得到 HTTP 200，说明不能继续把问题归因于“上游不可达”。
- 新 API 旧日志只记录 `ProviderRequestError/UNKNOWN`，缺少上游状态码和操作名，已经补充低敏 provider 诊断字段。
- 认证、依赖未配置、provider 拒绝/暂时不可用和持久化暂时不可用已经统一为稳定错误码与中文安全文案；小程序按错误码兜底，服务端只在探针状态发生变化时记录 persistence unavailable/recovered，避免重复刷屏。`d177991` 的真实进程和公网基础运行时证据已完成，但不能用它替代真实 provider/真机业务证据。
- 2026-08-16 已定位并修复预约科室/排班目录错误：科室接口需要日期窗口，排班响应中的 `remainingNumber` 可能为 `null`，服务端只使用已确认的 `usableSourceNum` 映射可用号源；线上新版本已直接回归科室和排班 provider。
- 预约历史的标识根因已经确认：患者目录的 `thirdPatientId` 不能直接当作预约历史接口的患者标识；新代码已增加 `patInfosFind` 档案查询和 `his-patient` 独立映射，release `b1b84d7` 与 `ca3a877` 已上线，`0012_patient_provider_references`、`0013_patient_directory_snapshot` 均通过生产 schema probe，仍需重新同步真实账号并完成公网业务 smoke/真机验收。
- 预约写号、锁号、取消、实际挂号费、医保和微信支付不能仅凭旧页面字段直接开放；仍需 provider 合同和脱敏 fixture。
- 当前优先级上调为“持久化稳定性观察 → 当前 release 真实只读业务验收”：readiness 只能在 `database/redis/schema` 连续稳定后作为验收前置，且排班快照必须出现 `snapshotPersistenceStatus=persisted`；不能把历史 release 的业务日志或一次 preflight 通过当成当前版本成功。

## 业务实施顺序

### 2026-08-18 原生“我的”与“我的挂号”布局边界纠正

重新对照旧端 `my_registration.vue` 与 `src/layouts/default.vue` 后确认：旧端“我的挂号”页使用
`default` 布局，不渲染固定底部导航；固定四项底栏只属于首页和“我的”页。原生挂号记录页已移除
之前误加的四项底栏及对应安全区留白，恢复旧端 `pb-20` 的 160rpx 底部节奏；筛选、患者 owner
校验和预约只读边界没有变化。代码和验证记录见
[`release/miniprogram-personal-center-tabbar-parity-2026-08-18.md`](release/miniprogram-personal-center-tabbar-parity-2026-08-18.md)。

本次只完成源码与构建验证，尚未把新的小程序包上传到微信开发者工具或进行真机视觉验收。

### 阶段 A：患者基础闭环

1. 微信登录：`wx.login`、服务端 code2session、平台会话和 Redis TTL。
2. 就诊人：服务端同步、当前就诊人、独立选择页、owner 隔离和脱敏展示。
3. 患者端公共状态：登录失效、网络异常、服务不可用、空数据和重试文案统一。

验收标准：真机登录成功；就诊人切换后预约、挂号记录、报告都使用新的内部 `patientId`；小程序网络请求不出现 provider 域名。

### 阶段 B：预约只读业务

1. 修复众阳请求差异：对比 URL、请求头、超时、TLS、代理出口和响应状态。
2. 科室和排班：只展示平台白名单字段，失败时显示可重试的服务状态。
3. 预约记录：服务端根据 owner 解析 `his-patient` 临床映射，返回脱敏摘要；禁止回退到目录 `thirdPatientId`。
4. 排班快照：只作为服务端观察事实，带 TTL；不把客户端 `scheduleId` 当成锁号授权。

验收标准：真实 provider 只读请求在服务器、公网 API 和真机三层均有证据；日志能按 `traceId` 找到 provider 操作、请求号、HTTP 状态和重试判断；排班快照的 `snapshotPersistenceStatus` 必须明确，只有 `persisted` 才能进入后续写入前置评估。

### 阶段 C：预约写入

只有取得以下证据后才开始：

- 锁号接口、锁号 TTL、释放/过期语义和并发冲突样例；
- 实际挂号费单位、费用查询时序和金额边界；
- 执行预约幂等键、超时后的最终状态查询和业务失败语义；
- 取消窗口、退款/撤销、HIS 回写和补偿矩阵。

目标状态机：

```text
available -> hold_pending -> held -> booking_pending -> booked
                                      |                  |
                                      v                  v
                              awaiting_confirmation  cancellation_pending
                                                         |
                                                         v
                                                     cancelled
```

任何超时、重复请求或无法确认的 provider 结果都进入 `awaiting_confirmation`，不能从 HTTP 200 或小程序支付回调推导成功。

### 阶段 D：支付与医保

1. 先完成门诊费用读模型的 provider、公网 API 和真机只读验收，确认状态、金额和就诊人切换均正确。
2. 再完成现金支付订单和微信支付真机链路；门诊费用查询结果不能直接当作支付订单。
3. 再完成医保授权、6201/6202、6301 查单、6203 退款和 6401 结果边界。
4. 最后接入 HIS 写回和对账 worker。

金额统一使用整数分；6202 的预结算状态不能直接当最终成功，最终状态必须由权威查单/回调事实决定。

### 阶段 E：报告与健康内容

- 报告目录先做真实 provider 只读验收，再开放带 owner/patient/TTL 的 LIS 详情引用；首页入口必须进入独立目录页，不能在首页后台加载后丢失结果。
- 报告详情、云影像、下载和分享需要独立的资源授权；没有安全文件 URL 和审计契约时只展示摘要或迁移提示。
- 健康百科先按 [`health-knowledge-content-mapping.md`](migration/health-knowledge-content-mapping.md) 完成脱敏导出、审核和版本化导入，再注册患者端路由。
- AI 导诊和报告解读必须独立于医疗事实库，保留免责声明、内容版本和审计日志。

### 阶段 F：便民服务、管理端和运维

- 便民服务按 [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) 的顺序逐项迁移：先医生关系只读，再患者反馈，再临床问卷，最后预约后预问诊/出院随访；不能把旧管理端接口整体透传。
- 管理端使用独立权限模型和独立路由，不能复用患者端 token 语义。
- 个人中心和外部入口按 [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) 拆分；患者新增/绑定先遵循 [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md) 冻结查档、建档、绑卡和协议事实，再做普通资料，最后跨小程序、WebView、订阅和外部服务。
- 增加指标、告警、备份恢复演练、发布回滚和旧服务下线检查。
- 基础设施迁移按独立边界推进：新 API Redis DB/ACL 隔离已完成，但旧 DB1 namespace、Mongo/本地文件资产仍需确认，随后分别设计通用任务、文件资源、AI/WebSocket 和 Admin/RBAC；不能用新 worker 或连接探针代替这些能力。

## 工程与运行治理

### 每个业务域必须同步交付

1. `contracts`：请求、响应、错误码和敏感字段边界；
2. `domain`：状态机、金额/时间/owner 规则；
3. `adapters`：外部协议、签名、超时、重试和字段白名单；
4. `persistence`：migration、索引、幂等键、版本条件更新和恢复策略；
5. `api`：鉴权、输入校验、错误映射和 OpenAPI；
6. `miniprogram`：加载、空态、错误、重试、就诊人上下文和页面验收；
7. `worker`：回调、查单、outbox、lease 和补偿；
8. `docs`：contract、日志事件、配置、验收和回滚手册。

### 日志最小字段

- HTTP：`requestId`、`traceId`、方法、路径、状态码、耗时；
- provider：provider 名、操作名、provider 请求号、状态码、是否可重试；
- 业务：内部资源 id、owner 维度、状态迁移和幂等冲突；
- 禁止：Authorization、openid、unionid、session_key、患者身份证/手机号、provider 原始报文、支付签名和密钥。

### 发布门禁

```text
代码门禁 -> 本地真实 MySQL/Redis -> staging provider -> 线上只读 smoke
         -> 公网 HTTPS -> 微信开发者工具 -> 真机 -> 支付/医保/HIS 专项验收
```

静态检查、单元测试和本地集成测试不能替代真实 provider、生产代理或真机证据。旧服务在新业务逐项通过验收前保持运行。

## 本次立即执行项

1. 在真机重新验收首页患者卡片、切换就诊人和报告目录，确认页面只显示脱敏卡号与平台摘要；
2. 在真机验收预约科室和排班，保存公网请求的 `requestId` 与页面证据；
3. 使用当前已上线的 `5c4e7cf` 重新同步真实账号的患者目录，先运行显式 `patient-sync` smoke，再补做 `his-patient` owner-scoped 记录查询验收；
4. 验收门诊缴费只读页面：切换就诊人、待缴/已缴状态、空列表、异常重试和大数据滚动；
5. 取得二维码医院扫码协议，完成短期 token 设计前保持入口未开放；
6. 先取得患者绑定 PB-01 至 PB-16 的 provider 文档、脱敏样例和超时/重复请求证据；在此之前只维护患者目录读取和迁移提示，不开发建档/绑卡兼容代理；
7. 再处理报告真实 provider 只读验收、医院列表动态能力/病历和便民服务逐域迁移；静态医院卡片与静态院内地图只作为已完成子集，不能代替机构或路线 contract；个人中心扩展和外部入口先完成 contract/allowlist/旧数据隔离，非页面逻辑按新审计文档逐项清除直连和敏感缓存，院内导航动态能力必须先取得地图数据与路线 contract；
8. provider 只读稳定后，才进入预约写入合同和锁号设计；
9. 最后按现金支付 → 医保结算 → HIS 回写顺序做专项验收。
10. 旧生产 env 文件权限已收紧到 `0700/0600` 且旧进程存活；新 API Redis 会话已切换至 DB3/`hospital_v2` 最小 ACL 并完成公网 readiness 验收；0014 普通资料已完成生产 schema/API 运行验收，但真实微信资料读写和真机证据仍待完成。下一步完成历史读取风险/秘密轮换判断，再继续报告、病历和文件资源 contract；旧 DB1 全权限账号、旧任务和其他基础设施仍不得视为已迁移。
11. 收到新的 provider 文档后，先按 [`provider-document-intake.md`](provider-document-intake.md) 登记来源、版本、环境、脱敏样例和错误样例，再补齐 [`provider-contract-template.md`](provider-contract-template.md)；没有文档和样例的字段不得进入业务 schema、数据库或小程序页面。
12. 首个文档驱动的业务优先处理门诊就诊记录目录：先确认病历查询使用的 `his-patient` 映射、日期窗口、空结果、超时、资源授权和诊断字段白名单，再决定是否从草案注册 API；当前 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md) 仍是 draft，不开放正文、诊断和文件下载。
13. 候选 `d177991` 已按 [`infra/systemd/api-v2-release-runbook.md`](../infra/systemd/api-v2-release-runbook.md) 完成原子 `current` 切换和新 API 单元重启；`18081`、公网 `/api/v2`、旧 `8001` 已复测通过。下一步进行真实微信登录、患者切换、预约只读和门诊费用的分层验收，任何业务层失败只回滚新 API，不触碰旧 Python 服务。
14. 已用公网 runtime smoke 的 traceId/requestId 证明 `/api/v2` 请求进入当时的 `d177991` Bun 进程；随后经历 `6d58c9c` 并已切换到当前 `5c4e7cf`，不再重复基础路由检查，转入真实 session、owner 映射、provider 状态和真机页面证据。

15. 2026-08-16 21:20 CST 使用候选 `3dc6f5f` 的 runtime smoke bundle 复测当前公网 `/api/v2`，live、ready、system-ping 和未登录认证边界全部通过；本次无会话、无患者/Provider 业务请求，不能替代真实微信 session 验收。证据见 [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md)。

## 业务正确性加固记录

- 2026-08-16：开发者工具观测到一次 `/api/v2/auth/wechat` `503`，但旧页面层仍显示脱敏患者卡片；
  已确认页面可见患者不等于本次微信登录成功。首页会话恢复或重新登录失败时现在清理当前页面患者派生状态，
  仅在本地 token 已被判失效时进入无会话态，避免把 Redis/网络暂时故障误处理成永久退出；真实登录仍需
  `auth.wechat.login.succeeded`、`/me`、患者同步和 Redis TTL 的同链路证据。

- 2026-08-16 23:19-23:20 CST：当前公网只读观察确认新 API 的 live/ready/system-ping、数据库/Redis/schema
  readiness、未登录患者 401 和病历 404 冻结边界均符合预期；没有触发微信登录、患者同步、预约、支付、医保或 HIS
  写入。该观察不能替代真实 session、Provider 和真机证据，详见
  [`release/current-public-readonly-smoke-2026-08-16.md`](release/current-public-readonly-smoke-2026-08-16.md)。

- 2026-08-16：将旧端 WebSocket、跳转其他小程序、web-view、支付调起、二维码/公众号和医保回跳纳入文件级迁移审计；这些入口仍保持“待契约/未迁移”，不因普通 HTTP endpoint 台账通过而提前开放。

- 2026-08-16：补齐患者临床映射生命周期：完整快照缺少 `his-patient` 时在同一事务内清理旧 `patId`，旧快照和普通单条 upsert 不会误触发清理；新增内存/MySQL 回归测试和中文业务规则文档。
- 2026-08-16：修正报告目录批量短期引用的观察时钟：同一次 provider 响应的所有 `reportId` 共享同一 `createdAt`/`expiresAt`，避免批量处理跨时钟边界产生不一致 TTL。

- 2026-08-16：患者目录 adapter 现在先拒绝同一完整快照中的重复 `thirdPatientId`，并在临床档案查询完成后拒绝重复的 HIS `patId`；避免持久化 upsert 把两条 provider 记录静默合并，或让切换就诊人后读取同一份临床数据。空医疗卡号会按旧端约定回退到有效 `cardNo`。
- 2026-08-16：预约排班 adapter 固定使用已确认的 `usableSourceNum`，不再把旧端别名作为 fallback，并拒绝同一响应中的重复 `hisScheduleId`；避免错误号源数量和多个 opaque 排班引用指向同一 provider 号源。
- 2026-08-16：报告 adapter 按来源拒绝重复 `reportId`；无 provider 报告号的摘要继续只展示摘要，不根据标题和时间伪造详情唯一引用。
- 2026-08-16：预约科室 adapter 拒绝同一响应中的重复 `departmentId`；预约历史和爽约页面不再把可缺失/重复的 `serialNumber` 当渲染主键，页面 key 明确仅用于列表 diff，不具备预约或 provider 业务含义。
- 2026-08-16：修复服务端与小程序只读窗口依赖运行时本地时区的问题，并用 UTC 输入验证仍输出中国标准时间；提交 `4c0d255` 只涉及客户端和文档，不需要重启 API，也不会打开支付、医保或结算写入。
- 患者目录失效回收已在代码中实现为 0013 的 active/inactive 事务快照，并保留历史引用；目标环境 migration 和 schema probe 已完成，下一步是失效/恢复数据验收和真机证据，仍禁止物理删除 `hp_patients`。
- 普通个人资料已在 0014 建立独立 `hp_user_profiles` 表；MySQL 首次写入和条件版本更新均有回归测试，下一步必须先做 schema probe、默认值/冲突公网验收，再允许真机使用资料编辑入口。
- 2026-08-16：0014 已在生产受控应用，schema probe 返回 `ready`，当时 `d177991` 已切换新 API；该历史窗口随后运行 `b186098`，未登录 profile 401 已验证，真实微信资料默认值、首次更新、409 冲突和真机仍未完成。该段记录中的 `0b6f38f` 是当时的历史 release；当前线上 release 以本文档顶部最新切换记录为准。
- 2026-08-17：修复普通资料 contract 的未知字段静默清洗问题，并随 `5f5915e` 完成生产切换。Elysia 根应用关闭 `normalize` 后，`PUT /me/profile` 会对 `avatar`、`openid` 等旧端字段返回 `400 validation`，同时保留 owner 隔离和 `version` 冲突语义；新增 API 回归测试和中文业务规则。真实资料读写、409 和真机证据仍未完成。
- 2026-08-16：修复首页与患者选择页下拉刷新提前结束的问题；首页等待健康检查和服务端目录读取，患者选择页继续等待医院目录同步，并移除目录读取完成后提前关闭 `loading` 的时序漏洞，避免临床映射尚未落库时进入预约、报告或费用查询，也不让首页普通刷新隐式放大为 provider 同步。
- 2026-08-16：修复预约目录日期标签使用设备本地时区的问题；`workDate` 现在按固定日历解析，跨时区不会改变医院日期或星期。
- 2026-08-16：患者同步 durable operation ledger、租约代次、同事务快照提交和 409 处理中语义已完成代码、测试和 `0015` migration，生产 schema probe 已通过；该历史窗口公网 `18081` 曾运行 `b186098`，真实患者并发、多患者切换、公网和真机证据仍待完成，契约与证据见 [`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md) 和 [`release/patient-sync-idempotency-production-acceptance-2026-08-16.md`](release/patient-sync-idempotency-production-acceptance-2026-08-16.md)。预约写入、患者绑定前必须完成这些线上验收。
- 2026-08-16：修复患者目录完整快照的乱序并发：`observedAt` 在 provider 请求前采样，内存仓储和 MySQL 条件更新都拒绝旧快照覆盖新状态；新增服务层、内存仓储和 MySQL 回归测试。
- 2026-08-16：收紧普通个人资料页的并发边界；下拉刷新使用最后一次请求获胜守卫，加载/保存期间由 UI 和方法层双重禁止保存，避免旧 GET 覆盖新 `version` 或快速连点制造不必要的 409。首页和患者选择页的患者同步统一使用 `services/single-flight.ts`，自动恢复、生命周期回调和手动刷新在同一页面实例内复用等待中的 Promise，并在成功/失败后释放锁；跨页面/跨进程仍以服务端 operation ledger 为最终幂等事实。真实微信资料读写和真机验收仍未完成。
- 2026-08-16：修正首页、预约记录、爽约记录、报告目录和门诊费用页的首次 `onShow` 生命周期状态：移除模块级 `isFirstShow`，改为页面实例内的 `hasShown`，避免页面栈叠加时不同实例互相消费首次展示标记，造成患者上下文漏刷新或重复请求；新增原生 acceptance 断言和中文业务不变量说明。
- 2026-08-16：继续修正页面栈并发边界：原生页面曾将 `createLatestRequestGuard` 和患者同步 `createSingleFlight` 直接放在模块级，导致同一路径多个实例共享请求状态；现统一使用页面对象作为 `WeakMap` owner，页面实例间不再互相取消患者、预约、报告、费用或资料请求，新增 guard/单飞隔离测试和构建门禁。
- 2026-08-16：完成生产 Redis 会话隔离：新 API 使用 DB3/`hospital_v2`，ACL 只允许 `PING/SELECT/GET/SET` 与 `hospital:session:*`，通过 TTL 和跨前缀拒绝探针；旧 Python DB1 继续运行，未迁移旧 namespace。
- 2026-08-16 20:08-20:11 CST：`b4dc33b` 已在真实生产 env 完成独立 release checksum、preflight、production mode、MySQL/Redis/schema、no-store、system ping 和未登录认证边界 smoke；候选 `18082/18083` 已停止，`current=55fce6c`、新 API `18081` 和旧 Python `8001` 未改变。真实微信、患者同步、预约/报告/门诊费用和真机仍待切换后验收，证据见 [`release/candidate-b4dc33b-production-smoke-2026-08-16.md`](release/candidate-b4dc33b-production-smoke-2026-08-16.md)。
- 2026-08-16 20:37-20:42 CST：候选 `d177991` 已完成真实生产 env preflight、五个 bundle checksum、`18082/18083` 隔离 smoke，并原子切换到生产 `current`；新 API `18081` 的公网 `/api/v2` live/ready（含 `Cache-Control: no-store`）、system-ping 和六路未登录认证边界全部通过，旧 Python `8001` 保持 PID/监听不变，Worker 仍 inactive。真实微信登录、患者同步/切换、预约目录/历史、报告和门诊费用仍需在公网切换后分层验收，证据见 [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md)。
- 2026-08-16：完成 `f2c6d99` 候选 release 的错误契约和 `cb11bc8` persistence 探针状态日志隔离 smoke；HTTP 401、生产模式启动、MySQL/Redis/schema 探针均符合预期，临时端口已清理，生产 `current=55fce6c`、`18081` 和旧 `8001` 保持不变。由于 systemd 管理权限尚未就绪，公网错误文案、患者同步 `0015` 和真机业务仍不能计为已验收。
- 2026-08-16：剩余迁移重新收敛为“文档驱动的 provider 业务”和“已有代码的分层验收”两条线：病历、患者绑定、预约写入、支付/医保/HIS、二维码不允许根据旧端页面猜测实现；每块业务必须先冻结 provider contract、状态机、owner/幂等/超时语义和日志字段，再进入代码和真机验收。
- 2026-08-16：小程序页面错误展示统一经过稳定错误码映射，页面不再直接读取 `Error.message`；未知/未来错误码回退到安全文案，避免 provider 或内部异常文本进入患者界面。
- 2026-08-16：补齐患者端列表的数量、空结果、排序、日期窗口和大结果集语义门禁；修正文档中“失效就诊人自动回退第一项”的错误描述，明确只有首次无选择才默认第一项，已有选择失效必须显式重新选择。
- 2026-08-16：修正报告目录与详情 gate 的边界；provider 缺少稳定报告号时保留安全摘要并省略详情引用，不再把单条详情不可用扩大成整批目录失败；公共文档和回归测试同步固定该不变量。
- 2026-08-16：为患者新增、门诊就诊记录目录/详情和医保授权候选路径增加 404 冻结门禁；在 provider/HIS contract、owner 映射、幂等和真实验收完成前，不允许以旧接口转发或空响应伪造迁移完成。
- 2026-08-16：复核旧端病历源码后明确拆分住院病历 `2.12.4/2.12.5/2.12.6` 与门诊 `out-visit-records`；住院 `patInHosId`、`babyId`、`noteId`、`mrTypeId` 不能复用为门诊记录字段，门诊目录仍等待独立 Provider/HIS contract，详见 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md)。
- 2026-08-16：进一步固定病历异常语义和住院 episode 链：旧门诊页实际使用 `ZY.ts` 的窄响应类型，非数组、请求异常都会被折叠为空列表；旧住院页则按 `patId → patInHosId → 日费用` 串联并默认取第一条 episode。新端不得复制这两个错误边界，必须区分真实空目录、映射缺失、权限拒绝和暂时失败，并在 provider contract 确认多 episode、金额单位和时间窗口前继续保持病历/住院路由关闭。
- 2026-08-16：门诊费用服务补齐空白 `patientId` 的服务层拒绝，并让 owner 映射、持久化和 provider 失败统一进入 `outpatient.payment.records.failed`；失败不能被误记为成功空列表，也不能绕过低敏日志链路。
- 2026-08-16：微信预支付在依赖未配置时也会把已记录的尝试从 `pending` 收敛为 `unknown`，返回 `dependency-not-configured`；同一幂等键不会永久卡在“处理中”，配置完成后必须用新的幂等键重新申请，提交 `b8086d1`。
- 2026-08-16：provider 目录 smoke 补齐门诊费用 `unpaid`/`paid` 两个只读状态，并要求服务端回显状态与请求状态一致；继续拦截金额、订单、医保、患者身份和 provider 原始字段，未触发支付、医保或结算写入。
- 2026-08-17：`0610558` 继续收紧门诊费用状态边界：领域 service 与众阳 adapter 都拒绝运行时未知状态，避免“非 unpaid 即 paid”误发 `tradeStatus=3`；新增稳定的 `outpatient-payment-query-invalid` 错误码、低敏 `status=invalid` 失败日志和回归测试。该修正未部署，不改变门诊费用只读范围，也未打开支付、医保或 HIS。
- 2026-08-17：`0505709` 收紧报告目录 `kind` 的运行时边界：领域 service 与众阳 adapter 都拒绝未知来源，避免默认分支把错误查询降级为 ECG；复用 `report-query-invalid` 稳定错误码，补齐失败日志与回归测试。该修正未部署，不改变报告 gate，也未打开二维码、支付、医保或 HIS。
- 2026-08-17：`87f7171` 补齐预约科室/排班日期校验的失败日志闭环：非法日期和服务端日期生成异常记录 `appointment.directory.*.failed`，不产生 `requested`、Provider 调用或伪造空结果；该修正未部署，不改变预约只读范围，也未打开预约写入、二维码、支付、医保或 HIS。
- 2026-08-17：`c1d10e3` 拆分患者目录同步与读模型读取的日志生命周期：`GET /patients` 新增独立的 `read.requested/read.loaded/read.failed` 事件；快照事务或 durable replay 成功后，如果最后的脱敏读模型读取失败，只记录 `read.failed`，不再追加 `patient.directory.failed`，避免把持久化读取故障误判为 Provider 同步失败。患者服务定向 7 项、API 集成 33 项及全量 `pnpm check` 通过；该修正未部署，线上仍以 `131fb5a` 和生产 schema `0015` 为准。
- 2026-08-17：`9d9e7b1` 将 opaque 标识的形状校验下沉到 domain/service 层，覆盖预约过滤、预约历史、报告目录/详情和门诊费用查询；服务层不再信任绕过 Elysia schema 的非法标识，失败日志只记录固定 `invalid`，不泄露超长或控制字符原值。API 91 项、domain 21 项、原生小程序 62 项及独立架构/provider/文档/格式/Lint/typecheck/test/build 检查通过；完整 `pnpm check` 仅被 `G:\\fuck\\hospital` 另一会话未提交的旧医保改动造成的迁移清单漂移阻塞，本轮不修改该工作树。该修正未部署，不改变只读范围，预约写入、二维码、支付、医保和 HIS 继续关闭。
- 2026-08-17：门诊费用页面补齐大结果集的本地渲染边界：服务端仍返回本次完整只读结果，页面首批渲染 10 条，后续“加载更多”只展开同一次 owner-scoped 查询已取得的数据，不新增 provider 请求、不改变 `total`、金额或状态事实，也不被描述为 provider 分页。小程序 62 项验收、typecheck 和构建通过；该修正未部署，支付、医保、结算和 HIS 继续关闭。
- 2026-08-17：预约历史和爽约派生页补齐同样的本地渲染边界：服务端固定日期窗口和完整结果不变，页面首批渲染 10 条，后续“加载更多”只展开当前已取得的数据；爽约仍只能由服务端归一化的 `missed` 状态决定，不新增 provider 请求、不改变状态或空结果语义。该修正未部署，预约写入、支付、医保和 HIS 继续关闭。
- 2026-08-17：收紧患者同步幂等键生成：首页和选择页不再只使用 `Date.now()`，改为集中生成符合 header 约束的业务前缀、时间片和随机尾部；同一页面单飞调用仍复用同一个 Promise，不同页面实例不会因同一毫秒而误共享 owner/provider/key 操作事实。该修正未部署，患者同步 replay、并发租约和真机证据仍待线上验收。
- 2026-08-17：发现 Provider 空患者目录的语义尚未被正式 contract 区分为“确实无绑定患者”或“不完整/权限过滤/临时异常”，因此服务层新增 fail-closed 保护：首次且确实为空的 owner 仍可成功，已有医院目录患者时返回 `patient-directory-snapshot-unsafe` 并保留旧快照，避免一次不确定响应批量停用就诊人。该修正未部署，待 Provider contract 和真机多就诊人验收后再评估是否放宽。
- 2026-08-17：病历域再次完成只读 contract 审计，仍未发现 `out-visit-records` 的正式 provider/HIS 文档、专用患者映射确认、四类脱敏样例和资源授权定义。旧端门诊记录与住院病案仍是两条不同链路；因此本轮按业务正确性要求停止编码，继续保持 `GET /api/v2/medical-records`、详情、正文、诊断和附件 404/未注册，不以万能转发或空列表伪造迁移完成。后续只有在 MR-01 至 MR-06、MR-13 至 MR-15 和最小交付包完成后才重新评估；当前切换到下一项可取得真实 contract 或可分层验收的只读工作。
- 2026-08-17：补充患者范围只读接口的跨 owner API 集成测试：用户 B 携带用户 A 的内部 `patientId` 访问预约历史、报告目录和门诊费用时，均在 owner 映射前置边界返回稳定错误，Provider gateway 不被调用。该测试强化了“不能把格式正确的内部 ID 当作权限证明”的不变量，不改变线上 release，也不替代真实账号/Provider/真机证据。
- 2026-08-17：修正报告目录详情引用的故障隔离：单条 LIS 短期引用持久化失败时保留安全摘要、隐藏详情入口并记录 `report.detail_reference.failed`；LIS/PACS/ECG Provider 聚合失败仍整批 fail-closed。该修正不打开报告 gate，不改变报告详情、附件和支付/医保/HIS 的关闭边界。
- 2026-08-17：修正预约历史 Provider smoke 的验收窗口偏差：此前 smoke 只请求过去 90 天到当天，无法证明“我的挂号”不会漏掉未来预约；现在与原生 `dashboard-service` 和公共 contract 统一为当前中国标准时间前后各 90 天，并补固定日期回归测试。该修正只增强验收工具，不改变预约历史 API、预约写入或支付/医保/HIS 边界。
- 2026-08-17：继续修正 Provider smoke 的日期基准：绝对时间先转换为 UTC+8 自然日再生成查询参数，并用北京时间午夜临界的 UTC 固定时刻回归，避免 smoke 在服务器时区或 UTC 截取下把预约、报告和排班窗口错移一天。该修正仍只影响验收工具，不改变线上 API。
- 2026-08-17：复核患者完整快照的稳定内部标识边界：MySQL 已按 `(owner, provider, provider_patient_id)` 找回既有患者，并使用数据库稳定的 `hp_patients.patient_id` 清理缺失临床 `his-patient` 引用，不会使用本次 Provider 响应中的候选内部 ID；新增回归测试锁定该语义。本轮不改运行代码、不部署，失效/恢复和真实 Provider 证据仍待验收。
- 2026-08-17：补齐 Provider 失败的低敏诊断链路。认证、预约、门诊费用和报告业务事件现在与统一 HTTP 失败日志共享 `providerOperation`、`providerRequestId`、`providerStatusCode` 和 `providerRetryable` 白名单；不记录 Provider 原文，也不因“外部服务拒绝”而增加盲目重试或打开预约/支付能力。验收说明见 [`release/provider-failure-observability-2026-08-17.md`](release/provider-failure-observability-2026-08-17.md)。
- 2026-08-17 16:40 CST 之后：线上只读日志首次观察到完整微信登录、患者读模型读取、预约历史同步和门诊费用只读加载，并有 3 个可关联的 `providerRequestId`；新旧服务仍共存。该证据只把预约历史/门诊费用推进到“已进入业务链、待页面/Provider/真机闭环”，不代表字段、状态、金额或 Redis TTL 已验收；支付、医保、退款和 HIS 继续最后处理，详见 [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md)。
- 2026-08-17 17:40 CST：当前 `0b6f38f` 启动后的 SSH 低敏聚合观察到微信登录 1 次、患者同步 5 次、患者读模型读取 13 次、预约历史请求/同步各 1 次、门诊费用请求/加载各 1 次，HTTP 200/401 为 37/7，去重 `providerRequestId` 为 8；新 API `18081` 与旧 Python `8001` 仍共存。该证据只确认预约历史和门诊费用进入当前 release 的只读业务链，不证明页面字段、患者切换、金额、状态或真机结果；下一步继续按 P0 手册逐页核对，支付、医保、退款和 HIS 继续最后处理。
- 2026-08-17：按旧端 `user.vue`、`userNavData.json` 和 `my_registration.vue` 完成原生小程序“我的/我的挂号”页面重制：本地化旧端背景、头像占位、功能图标和固定底部导航，恢复家庭成员入口、三组功能分类、在线/全部挂号标签、就诊人/院区信息行、预约卡片和院内导航弹窗。当前资料仍与临床就诊人目录分离，更换就诊人进入独立选择页；在线标签只排除服务端明确的 `cancelled`，预问诊因缺少独立 contract 继续安全提示。院内导航只使用随旧端复核过的静态科室位置，不猜测未知楼层。小程序 76 项验收、全仓 typecheck/test/build、架构/文档审计和 Biome 门禁通过；尚未部署或真机视觉验收，支付、医保、预约写入和 HIS 仍关闭。
- 2026-08-17 19:28 CST：开发者工具普通编译后复核“我的/我的挂号”页面；背景、三组同名分类、旧端本地图标、固定底部导航、就诊人/院区选择区和双标签布局均已加载。挂号卡片补齐旧端的日期/上午下午与时段/序号两级排版；新端仍不增加未取得 contract 的详情、预问诊、取消、退号或支付行为。
- 2026-08-16 18:20-18:21 CST：SSH 只读复核确认 `current=55fce6c`、新 API `18081`、旧 Python `8001` 均存活；公网 `/api/v2` Smoke 的 system-ping 通过，但 live/ready 仍因缺少 `Cache-Control: no-store` 被拒绝，`sudo -n` 仍需密码，未执行任何线上切换或重启。
- 2026-08-16 18:35 CST：更新后的公网 Smoke 进一步确认 system-ping 与六路未登录 `auth-boundary` 通过；live/ready 仍因缺少 `Cache-Control: no-store` 被拒绝。当前只证明公网路由和认证边界，不能替代候选切换、provider 或真机业务验收。
- 2026-08-16：提交 `0dc39aa` 建立以原生 `app.json` 为事实源的 14 页面迁移台账和 `pnpm migration:audit` 门禁，随后以 `09c88b1` 校正发布文档时序；均为文档/静态检查增强，尚未构建、上传或部署，不能改变生产 `current=55fce6c` 和公网 no-store 未通过的结论。
- 2026-08-16 18:44 CST：SSH 只读复核确认 `current=55fce6c`、新 API `18081`、旧 Python `8001` 仍共存，`sudo -n` 仍需密码；公网 live/ready/system-ping 分别返回 200，ready 依赖均为 `ok`，但 live/ready 仍缺 `Cache-Control: no-store`。本次没有重启、切换、migration 或业务写入，requestId 和完整结果已记录在 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 16:57 CST：首次观测到公网与内网 readiness 短时不同；17:02 CST 通过唯一 requestId 和 Bun journald 证明两者实际来自同一个 `55fce6c` 进程，差异属于依赖探针恢复，不是另一 upstream。当前 release 仍缺少候选代码的 `Cache-Control: no-store`，仓库 `main` 的待发布版本尚未部署，仍禁止用公网 `200` 推导业务已验收。

- 2026-08-17：完成会话恢复、就诊人上下文、预约历史/爽约筛选和日志链路的只读代码审计；小程序 76 项、API 97 项
测试和文档链接审计通过。确认 401/503 分流、并发 token 保护、首次默认患者、失效后显式重选、服务端状态归一化
和日志脱敏边界没有新的可安全推断缺陷；Redis TTL、多患者、资料 PUT/409、预约/费用页面三层证据仍未完成，详见
[`session-patient-context-readonly-audit-2026-08-17.md`](release/session-patient-context-readonly-audit-2026-08-17.md)。
- 2026-08-17 20:04 CST：继续收紧“我的/我的挂号”使用的患者上下文：公共患者响应新增 `clinicalAccess`，
  只有完成当前 `his-patient` 映射的记录才标记为 `ready`。旧目录或缺少映射的记录保留展示但标记为
  `unavailable`，选择页不允许默认/显式选中，已有选择失效时也不静默切换；服务端业务页继续在 Provider
  调用前 fail-closed。旧端背景、功能分类、图标、固定底栏和挂号布局不变；本轮已补中文注释、测试和迁移文档，
  未部署且未新增真机/Provider 业务证据。
- 2026-08-17 20:12 CST：修正“我的”页患者上下文提示遗漏：当已保存患者仍在目录中但缺少 `his-patient`
  映射时，页面现在保留家庭成员数量展示，同时明确提示进入选择页处理；患者上下文错误优先于普通资料读取
  的增强提示，避免业务原因被资料提示覆盖。该修正只影响小程序状态展示和验收断言，不打开预约写入、支付、
  医保或 HIS，也尚未部署或取得新的真机/Provider 证据。
- 2026-08-17 20:18 CST：完成当前线上只读复核：新 API 仍运行 `5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c`，
  本地 `main` 为 `efb3d59`；新旧服务 `18081/8001` 共存，内网 ready 和公网 live/ready/system-ping 基础响应
  正常，最近 400 条日志出现相关只读业务关键词且没有探针 unavailable/recovered 命中。该证据只推进运行时和日志
  可见性，不代表真实微信登录、多患者切换、Provider 字段、Redis TTL、资料 409 或真机验收；本地最新小程序修正
  仍待上传后验证。支付、医保、预约写入、报告详情和 HIS 继续关闭，详见
  [`release/current-live-readonly-audit-2026-08-17.md`](release/current-live-readonly-audit-2026-08-17.md)。
- 2026-08-17 20:24 CST：修复线上日志维护工具的发布缺口：worker 构建新增独立的
  `apps/worker/dist/p0-log-aggregate.js`，未来候选 release 必须检查文件存在并纳入 SHA-256 校验；日志聚合只读
  journald JSONL，不连接数据库/Redis/Provider，不接收 token、患者标识或原始 Provider 报文。worker 构建、工具单测
  和 bundle stdin smoke 已通过；当前 `5f5915e` 仍未包含该 artifact，必须随下一次候选发布后再在服务器验证，
  不打开预约写入、支付、医保、退款或 HIS。
- 2026-08-17 20:32 CST：`bf67b96` 已完成六个 artifact checksum、生产 preflight、`18082` 隔离 runtime smoke、
  原子切换和新 API 单独重启；公网 live/ready/system-ping、ready 连续 6/6 和未登录认证边界通过，旧 Python `8001`
  及 Worker inactive 边界保持不变。当前 release 的日志聚合 bundle 对切换后 journald 窗口 `parseErrors=0`，但切换后
  尚未出现真实微信/患者/预约/费用业务事件，因此下一步仍是从本次 service.started 起做真机会话、患者切换和只读业务
  三层验收；支付、医保、预约写入、报告详情和 HIS 继续关闭，详见
  [`release/bf67b96-production-acceptance-2026-08-17.md`](release/bf67b96-production-acceptance-2026-08-17.md)。
- 2026-08-18：继续收紧原生小程序页面栈业务边界。`e1243cf` 修复患者选择页切换成功后的延迟回跳：定时器按页面实例保存，
  `onUnload` 直接清理，页面卸载后不再调用 `setData`。`8b5364d` 增加统一的 `disposePageInstance` 生命周期守卫，
  使患者选择页和普通资料页的目录、同步、资料读取/保存请求在页面离开后失去回写资格。
- 2026-08-18：`fa835c6` 将同一生命周期语义扩展到首页会话恢复/主动登录、预约目录、我的挂号、爽约、报告目录、报告详情和门诊费用页，
  并以注册页面反向静态门禁确保所有使用请求守卫的页面都实现 `onUnload` 失效化。小程序 92 项测试、869 个断言，
  全仓 `pnpm check`、构建、架构/迁移/provider/文档审计均通过；这些是代码级证据，尚未部署最新小程序包，也不能替代多患者真机、
  Redis TTL、Provider 只读字段和公网业务证据。下一步仍按“固定候选版本 → 新旧服务共存发布 → 真机登录/切换患者 → 预约历史/门诊费用只读”执行，
  支付、医保、退款、预约写入、报告真实详情和 HIS 继续保持关闭。
- 2026-08-18：继续收紧“我的”页会话入口。此前入口只判断本地 token 是否存在，可能把过期 token 延迟到资料、
  患者或挂号页面才暴露；现在页面维护 `checking/valid/invalid/unavailable` 四态，只有最近一次 `/me` 成功后才允许打开
  会话或患者范围页面，明确 `unauthorized` 才回首页，临时依赖故障只提示等待/刷新且保留可重试会话。该修正只影响
  原生小程序入口和测试（此前本地小程序 101 项通过、910 个断言），未触碰旧 Python 服务、线上 API、数据库或 Redis；仍需候选小程序包上传后的真机验证，
  真实多患者、预约/费用 Provider 字段、普通资料 PUT/409、Redis TTL 以及支付/医保/HIS 证据仍未完成。
- 2026-08-18：继续收紧患者范围页的“更换就诊人”兜底入口：未传入最近 `/me` 四态结果的旧页面不再使用默认
  `true`，而是实时检查本地 token；上一轮 401 清除 token 后会回首页重新建立会话。该检查只解决明显的无 token 绕过，
  不把 token 存在当作有效期证明；预约历史、爽约、报告和门诊费用的页面级 owner/患者/Provider 门禁保持不变。
- 2026-08-18：继续收紧首页业务入口：预约目录、报告、我的挂号、门诊费用和更换就诊人现在统一消费
  `sessionStatus → checking/valid/invalid/unavailable` 映射；恢复中的 token 不再提前打开页面，明确失效才回登录，
  Redis/网络暂时故障保留 token 并显示可重试状态。该修正只影响原生小程序入口、状态映射、中文注释和回归测试，
  未触碰旧 Python 服务、线上 API、数据库或 Redis；仍需候选小程序包上传后的真机验证，以及预约/费用 Provider 字段、
  普通资料 PUT/409、Redis TTL 和支付/医保/HIS 证据。
- 2026-08-18：真机准备前修正首页会话生命周期：其他页面因 `401/unauthorized` 清理全局 token 后，首页
  `onShow` 会同步收敛为“未登录”；主动重新登录从发起请求起显示“验证会话中”，不再残留旧的“微信已登录”。
  本轮只改原生小程序状态、中文注释、验收断言和业务规则；小程序 106 项测试、932 个断言通过，未触碰旧服务或线上 release。
