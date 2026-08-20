# 下一阶段实施路线图

本文档是新会话继续工作的入口，描述当前真实边界、业务优先级、工程治理和上线验收顺序。
其中“已完成”只表示代码、测试或部署证据，不代表微信、众阳、医保、HIS、支付或真机已经完成真实验收。

## 当前执行检查点（2026-08-21）

- 2026-08-21 05:47 CST（公网只读边界复核）：`https://test-hp.meiyi.pro` 的 `/api/v2/health/live`、`health/ready`、`system/ping`
  返回 `200`；live/ready 返回 `Cache-Control: no-store`。未登录的 `/me`、`/patients`、预约历史和门诊费用返回 `401`，
  门诊病历、医保授权和预约写入保持 `404`。本次不携带 Bearer、不调用 Provider、不写 MySQL/Redis，结果只证明公网路由边界，
  不增加真机或业务验收证据。详见 [`release/current-public-readonly-smoke-2026-08-21-0547.md`](release/current-public-readonly-smoke-2026-08-21-0547.md)。

- 2026-08-21 05:54 CST（当前 release 线上只读复核）：`5a31427` active，Worker inactive，新 API `10.0.0.3:18081` 与旧 Python
  `8001` 共存，readiness 的 database/Redis/schema 均为 `ok`；最近 30 分钟没有登录、患者、预约、门诊费用或普通资料事件。
  该窗口没有新的真机请求，不增加业务验收证据；详见
  [`release/current-5a31427-p0-business-observation-2026-08-21-0554.md`](release/current-5a31427-p0-business-observation-2026-08-21-0554.md)。

- 2026-08-21 05:45 CST（线上只读共存与业务空窗口复核）：服务器确认当前 release `5a31427` active，新 API
  `10.0.0.3:18081` 与旧 Python `8001` 继续共存；使用实际内网监听地址的 readiness 返回 `database=ok`、`redis=ok`、
  `schema=ok`。最近 30 分钟没有微信、患者、预约、门诊费用或普通资料业务事件，最近 10 分钟只有 readiness `200`。
  `127.0.0.1:18081` 不是新 API 的监听地址，回环探针失败不能解释成服务停止。本次没有部署、重启、配置写入、Provider 调用或业务数据写入。
  详见 [`release/current-5a31427-p0-business-observation-2026-08-21-0545.md`](release/current-5a31427-p0-business-observation-2026-08-21-0545.md)。

- 2026-08-21 05:17 CST（线上只读共存与业务窗口复核）：服务器确认服务端 `5a31427` active，新 API
  `10.0.0.3:18081` 与旧 Python `8001` 继续共存，readiness 的 database/Redis/schema 均为 `ok`；最近 30 分钟
  journald 只有 1 条健康检查 `200`，没有新的微信、患者、预约、门诊费用或普通资料业务事件。该结果只证明运行层
  正常，不能升级为真机或 Provider 业务完成；本次没有修改配置、重启服务、调用 Provider 或写入 MySQL/Redis。
  详见 [`release/current-5a31427-p0-business-observation-2026-08-21-0517.md`](release/current-5a31427-p0-business-observation-2026-08-21-0517.md)。

- 2026-08-21 04:51 CST（线上只读观测）：服务器确认服务端 `5a31427` active，新 API `10.0.0.3:18081` 与旧 Python
  `8001` 继续共存；最近 30 分钟没有新的微信、患者、预约、门诊费用或普通资料业务事件。本次没有修改配置、重启服务、
  调用 Provider 或写入 MySQL/Redis，因此仍没有当前候选的真机三层业务证据。详见
  [`release/current-5a31427-p0-business-observation-2026-08-21-0451.md`](release/current-5a31427-p0-business-observation-2026-08-21-0451.md)。

- 2026-08-21（首页患者目录并发边界）：发现并修复首页目录读取在“旧请求已被淘汰”时返回 `[]` 的语义缺陷。
  业务修正已包含在当前 `9340846` 运行包中；登录恢复链只有在 `loaded` 时才会继续患者同步。
  小程序业务测试、运行包构建和 `runtime:verify` 已通过。未修改旧 Python 服务；真实设备和线上新包仍待重新取证。

- 2026-08-21（当前候选全仓门禁复核）：基于服务端 `5a31427` 和小程序来源 `9340846`，API 188/188、众阳及通用
  adapter 105/105、domain 57/57、persistence 83/83、小程序 169/169 全部通过，所有 typecheck、架构审计、迁移清单、
  Provider intake、文档断链和 release baseline 审计均通过。该结果只证明当前代码和文档边界一致，不增加 Provider、
  公网或真机三层业务证据；健康知识、病历、患者绑定、报告资源、支付/医保/HIS 继续按各自契约门禁关闭。详细当前审计见
  [`release/readonly-business-chain-audit-2026-08-21.md`](release/readonly-business-chain-audit-2026-08-21.md)。

- 2026-08-21 06:44 CST（真机扫码前置恢复）：正确的 `miniprogram` 项目已对当前 `6ce1272` 运行包重新执行普通编译，
  工具显示 14 个页面、约 607 KB 的 iOS/局域网二维码，`dist/` 中测试脚本数量仍为 0。该记录只解决开发者工具旧增量索引
  造成的 `single-flight.test.js` ENOENT，不增加微信登录、患者、预约或费用的真机证据；扫码后仍须按三层证据顺序验收。
  详见 [`release/miniprogram-device-qr-session-2026-08-21-0705.md`](release/miniprogram-device-qr-session-2026-08-21-0705.md)。

- 2026-08-21 06:47 CST（线上只读业务空窗口）：SSH 复核确认新 API `10.0.0.3:18081`、旧 Python `8001` 共存，Worker inactive，
  readiness 的 database/redis/schema 均为 `ok`；近 20 分钟没有微信、患者、预约或门诊费用事件。错误版本前缀探针的 `404` 不代表公网代理
  或业务失败，当前仍需真机扫码取得三层证据。详见
  [`release/current-5a31427-p0-business-observation-2026-08-21-0647.md`](release/current-5a31427-p0-business-observation-2026-08-21-0647.md)。

- 2026-08-21（会话恢复状态机修正）：发现 GET 重新登录后第二次 `401` 未清理同代无效 token，已在 `9340846` 增加双重代际/token
  清理条件；并保持 PUT/POST/支付命令不自动重放。小程序 170/170 测试、构建、14 页运行包和测试脚本隔离验证通过。真实微信和 P0
  只读三层证据仍待当前运行包重新扫码，详细规则见
  [`release/miniprogram-session-recovery-logic-audit-2026-08-21.md`](release/miniprogram-session-recovery-logic-audit-2026-08-21.md)。

> 本节以下按时间顺序保留历史观察；凡记录中写旧 release，均表示当时观察窗口，不覆盖顶部最新事实。
> 当前服务端 release 为 `5a31427`（完整提交 `5a314275e9bae43730eab5b32638a8baecda5869`），旧 Python `8001` 继续共存；本地小程序候选为
> `9340846`，完整运行包来源为 `93408462f3eeadffed172f1ea3b10c043d461b1b`，尚未上传线上。
> `d772f09`、`0dccf54`、`ce8d68b` 和 `e050fa0` 仅保留为历史候选。

- 2026-08-21 03:23 CST（历史 `6ce1272` 候选二维码重新建立）：只读检查发现开发者工具先前显示的二维码已于 `01:17` 失效，
  线上最近 30 分钟仅有 readiness 健康检查，没有新的微信/患者业务事件。随后在正确的 `miniprogram` 项目中对当前
  `6ce1272` 运行包重新普通编译，确认 `analyzing codes success`、14 个页面和无测试脚本，再重新生成 iOS/局域网二维码，
  约于 `03:48` CST 失效。该记录只恢复扫码前置，不增加微信登录、患者同步、预约、费用或真机三层验收证据；旧 Python 未修改、未重启。
  详见 [`release/miniprogram-runtime-enoent-recovery-2026-08-20.md`](release/miniprogram-runtime-enoent-recovery-2026-08-20.md)。

- 2026-08-21 03:22–03:23 CST（历史 release `6038560` 的真机微信登录与患者同步）：同一真机二维码产生 `POST /api/v1/auth/wechat` 200、
  `GET /api/v1/me` 200、`GET /api/v1/patients` 200 和 `POST /api/v1/patients/sync` 200；服务端日志包含登录成功、
  owner 读取、同步操作开始、快照提交、同步成功和同步后目录读取。日志中的 `/api/v1` 是公网 `/api/v2` 经 Nginx 转发到
  Elysia 内部路由的预期路径，不是客户端误用旧服务。该历史窗口只把微信会话与患者同步标为已观察，不能升级当前
  `5a31427` 的真机证据；患者显式切换、预约历史、门诊费用和普通资料仍需当前 release 重新取证；详见
  [`release/miniprogram-real-device-login-patient-acceptance-2026-08-21.md`](release/miniprogram-real-device-login-patient-acceptance-2026-08-21.md)。

- 2026-08-21 02:41–02:46 CST（`6038560` 服务端生产切换）：患者目录同步新增的 domain `provider-reference-duplicate` 二次门禁已完成本地全仓门禁，
  8 个运行产物与本地产物 SHA-256 一致，真实生产 env preflight、`127.0.0.1:18082` 隔离 runtime smoke 和公网 `/api/v2` runtime smoke 均通过。
  新 API `current` 已从 `0e360d3` 原子切换到 `6038560`，只重启 `hospital-platform-api-v2.service`；新 `18081`、旧 Python `8001` 仍同时监听，Worker 保持 inactive。
  本次没有调用患者/预约/费用 Provider、没有写入业务数据、没有修改旧 Python；完整证据见
  [`release/6038560-production-acceptance-2026-08-21.md`](release/6038560-production-acceptance-2026-08-21.md)。

- 2026-08-21 03:03 CST（`6038560` 切换后 SSH 只读观察）：新 API `active`、Worker `inactive`，`10.0.0.3:18081` 与旧 Python
  `8001` 继续同时监听，内网 readiness 的 database/Redis/schema 均为 `ok`。切换后日志窗口只有 1 条健康检查 `200`，没有新的
  微信登录、患者、预约、门诊费用或普通资料事件；这只说明当前尚未形成新的真实业务链，不能解释成 Provider 失败或业务完成。
  详细证据见 [`release/current-6038560-readonly-observation-2026-08-21-0303.md`](release/current-6038560-readonly-observation-2026-08-21-0303.md)。

- 2026-08-21 03:51–03:54 CST（`5a31427` 日志链修正生产切换）：真实 production env preflight、`127.0.0.1:18082`
  隔离 runtime smoke 和新旧端口共存检查均通过；`current` 已从 `6038560` 原子切换到 `5a31427`，只重启
  `hospital-platform-api-v2.service`。启动日志明确打印 production 模式，数据库/Redis/schema readiness 为 `ok`，
  内外网 `/health/ready` 均为 200，旧 Python `8001` 继续监听。该次没有调用微信、患者、预约、费用 Provider，
  因此多请求 trace 的真实业务三层证据仍待真机操作；详见 [`release/5a31427-production-acceptance-2026-08-21.md`](release/5a31427-production-acceptance-2026-08-21.md)。

- 2026-08-21 04:02 CST（`5a31427` P0 业务日志空窗口）：使用线上 release 内置日志聚合和业务证据门禁复核
  `03:54` 之后的 journald，`parseErrors=0`、`systemdWarningCount=0`，但微信、患者、预约、门诊费用和普通资料
  所有业务域均为 `requested=0/success=0`。这是“尚未扫码/尚未产生业务请求”的证据，不是 Provider 失败；下一步必须由
  当前 `6ce1272` 真机候选产生新的同链请求。详见 [`release/current-5a31427-p0-business-observation-2026-08-21-0402.md`](release/current-5a31427-p0-business-observation-2026-08-21-0402.md)。

- 2026-08-21 04:09 CST（`5a31427` 线上只读复核）：当前 release 仍为 `5a31427`，新 API `18081` 与旧 Python `8001`
  同时监听且新 API 为 `active`。从 `03:54` 切换窗口开始，当前 release 的日志聚合解析 `10` 条记录，`parseErrors=0`、
  `systemdWarningCount=0`；P0 业务域仍全部为 `requested=0/success=0`，只有启动和健康检查，没有新的真机业务请求。
  该结果继续保持业务门禁关闭，不把“服务正常但没有请求”解释成 Provider 成功或失败。详见
  [`release/current-5a31427-p0-business-observation-2026-08-21-0409.md`](release/current-5a31427-p0-business-observation-2026-08-21-0409.md)。

- 2026-08-21 04:29 CST（`5a31427` 最新只读复核）：当前 release 仍为 `5a31427`，新 API `18081` 与旧 Python `8001`
  同时监听且新 API 为 `active`。最近约 30 分钟日志聚合解析 `3` 条记录，`parseErrors=0`、`systemdWarningCount=0`，
  仅有 3 条基础 HTTP `200`，没有新的微信、患者、预约或门诊费用事件。该结果继续保持业务门禁关闭；详见
  [`release/current-5a31427-p0-business-observation-2026-08-21-0429.md`](release/current-5a31427-p0-business-observation-2026-08-21-0429.md)。

- 2026-08-21（患者目录 trace 保留边界）：domain 现在会保留 gateway 返回且通过统一校验的有界 `requestIds`，
  service 的 `patient.directory.snapshot.committed` / `patient.directory.synced` 同时记录兼容主 ID 和列表；
  P0 聚合器也会读取两种字段并去重统计；当前众阳患者 adapter 尚未因本轮改动而改变，另一个会话的自动化获取不受影响。
  domain 10/10、患者 service 21/21、P0 工具 32/32 定向测试通过；本轮未部署、未重启新旧服务，详见
  [`release/patient-directory-trace-retention-2026-08-21.md`](release/patient-directory-trace-retention-2026-08-21.md)。

- 2026-08-21（预约/门诊费用多请求 trace 日志保留）：补齐预约目录、预约历史、排班快照和门诊费用
  service 对已校验 `requestIds` 的成功/失败日志保留，继续兼容主 `providerRequestId`；不改变 Provider 请求、
  患者归属、状态、金额或真机验收边界。API typecheck、预约/费用 service 37/37 和 Biome 通过；未部署、未重启新旧服务，
  详见 [`release/readonly-provider-trace-retention-2026-08-21.md`](release/readonly-provider-trace-retention-2026-08-21.md)。

- 2026-08-20 23:14 CST（历史候选真机工具复核）：针对 `dist/services/single-flight.test.js` 的 ENOENT，历史 `7f157d4`
  运行包重新通过构建和 `runtime:verify`，`dist/` 中测试运行脚本为 0、14 个页面脚本齐全；微信开发者工具已关闭旧真机调试
  会话、普通编译成功并显示 `analyzing codes success`，随后重新生成 iOS/局域网二维码。该证据只证明本地运行包和工具模块图已刷新，
  尚未证明手机重新扫码后的微信登录、患者同步或业务页面三层证据；旧 Python `8001` 未修改、未重启。详见
  [`release/miniprogram-runtime-enoent-recovery-2026-08-20.md`](release/miniprogram-runtime-enoent-recovery-2026-08-20.md)。

- 2026-08-20（配置与运行包边界复核）：前序配置修正提交为 `a2af341`，随后又完成 Redis 连接并发边界收敛；微信身份和微信支付上游地址的空字符串/空白值现在会
  回退到官方 HTTPS 默认地址，配置闸门与 adapter 收到的地址保持一致；小程序构建仍硬性排除测试脚本，
  `dist/services/single-flight.test.js` 不属于运行包。真实微信会话、Provider 业务和真机三层证据仍未因本次本地门禁通过而完成。
  详见 [`release/configuration-normalization-2026-08-20.md`](release/configuration-normalization-2026-08-20.md)。

- 2026-08-21（患者选择返回期间刷新门禁修正）：`6e6604f` 为前一小程序候选；选择页在延迟返回窗口内禁止刷新命令，资料页继续保留页面实例级 `onShow`，
  页面栈重新可见时重新确认当前会话并读取资料，首次展示不重复 `onLoad` 请求；无平台会话时清理旧资料并回到登录入口。
  `typecheck`、169 项小程序测试、构建和 `runtime:verify` 均通过，运行包没有 `*.test.js`/`*.spec.js`。

- 2026-08-21（患者临床映射一对一边界补强）：继续审计患者目录同步时发现，当前众阳 adapter 虽已拒绝重复 HIS `patId`，
  但可替换的 gateway/回放实现仍可能直接把重复 `his-patient` 引用交给 service。新端 domain 的
  `normalizePatientDirectoryResult()` 现在在快照事务前再次整批拒绝 `provider-reference-duplicate`，API service 回归确认
  `replaceDirectorySnapshot` 调用次数为 0，日志只保留固定 `resultViolation`；MySQL 原有唯一约束继续作为最终持久化防线。
  domain 9/9、患者 service 20/20、adapter 105/105、persistence 83/83 和 API 185/185 定向/包级测试均通过。
  本次只修改新项目本地代码与文档，未部署、未重启新旧服务、未触碰旧 Python、线上 MySQL/Redis 或并行维护的众阳自动化。

- 2026-08-20（Redis 就绪探针并发边界）：发现 readiness、会话读写和 TTL 维护命令在首次连接窗口可能重复调用
  ioredis `connect()`，造成连接竞争被误报为数据服务暂不可用。新端已将同一 Redis 客户端的连接建立收敛为共享单飞，
  但不重放业务命令；连接失败会释放后续重试资格。persistence 83 项测试和类型检查通过，旧 Python、线上 Redis 和 ACL 未修改。
  详见 [`release/redis-readiness-concurrency-audit-2026-08-20.md`](release/redis-readiness-concurrency-audit-2026-08-20.md)。

- 2026-08-20（门诊费用只读逻辑审计）：服务端门诊费用 service、众阳 adapter 和小程序页面的定向测试通过；发现并修正
  Provider 元字符串使用浮点乘法以及客户端使用 `toFixed` 展示的金额精度风险，改为服务端 `BigInt` 精确转分、客户端整数
  拆分展示，并增加安全整数边界测试。患者 owner 映射、状态 1/3、最近 30 个中国标准时间自然日、日期真实性、页面旧请求
  淘汰和本地分批展示均已核对；支付、医保、退费、结算和 HIS 写回继续关闭，真实 Provider/真机证据仍缺失。详见
  [`release/miniprogram-outpatient-payment-logic-audit-2026-08-20.md`](release/miniprogram-outpatient-payment-logic-audit-2026-08-20.md)。

- 2026-08-20（报告目录/详情只读逻辑审计）：继续核对报告 owner/患者映射、多来源聚合、LIS 短期 opaque 引用、页面旧请求
  淘汰和附件存在性。发现并收紧众阳 adapter 的附件字段判定：LIS 只接受字符串数组，PACS/ECG 只接受字符串或空值，
  不再用宽松 `Boolean(...)` 把未知 truthy 结构展示成“含附件”；附件下载、影像/心电详情、体检、报告解读和两个报告 gate
  继续关闭。详见 [`release/miniprogram-report-readonly-logic-audit-2026-08-20.md`](release/miniprogram-report-readonly-logic-audit-2026-08-20.md)。

- 2026-08-20（前一候选 `ac238c6` 的门诊金额修正后运行包重建，历史追溯）：本地小程序运行输入来源为 `ac238c6`，完整 `dist/build-info.json.sourceRevision`
  为 `ac238c6156f085fdb56f5806fefac3613e5f85be`；14 个页面脚本齐全、运行包中没有 `*.test.js`/`*.spec.js`，小程序完整
  测试 169/169，且全仓 `pnpm check` 9/9 通过。该候选尚未上传线上，旧 `8f80b3e` 二维码不能继续用于真机验收；旧 Python
  服务未修改、未重启。

- 2026-08-20 20:59 CST（预约历史/爽约逻辑审计）：服务端预约 service `22/22`、众阳预约 adapter `15/15`、小程序预约服务 `26/26`、
  页面验收 `12/12` 和类型检查均通过。当前逻辑已固定 owner-scoped HIS 映射、历史前后 90 天、爽约过去 90 天、渠道 3 在线标签、
  渠道 4 全部挂号阻断、状态/日期/总数 fail-closed 以及患者切换后的旧回写隔离；未发现需要放宽或修改的业务缺陷。
  真机、当前 release Provider 非空样例和全部挂号渠道 4 合同仍缺失，不把本地测试当作真实验收。详见
  [`release/miniprogram-appointment-readonly-logic-audit-2026-08-20.md`](release/miniprogram-appointment-readonly-logic-audit-2026-08-20.md)。

- 2026-08-20 20:53 CST（普通资料逻辑审计）：服务端资料 service `13/13`、小程序资料验收 `6/6`（149 个断言）和小程序类型检查通过。
  当前代码已覆盖 owner 会话归属、默认值无副作用、版本条件更新、409 冲突、会话失效清理、服务端 canonical 回写和低敏日志；未发现应贸然修改的业务逻辑缺陷。
  真机首次读取、受控资料写入、双会话 409 和日志三层同链证据仍待扫码与专用测试账号，不能以本地测试替代；支付、医保和 HIS 继续关闭。
  详见 [`release/miniprogram-profile-logic-audit-2026-08-20.md`](release/miniprogram-profile-logic-audit-2026-08-20.md)。

- 2026-08-20 20:49 CST（真机调试 ENOENT 恢复）：当前 `8f80b3e` 运行包重新构建并通过 `runtime:verify`，`dist/` 中没有
  `single-flight.test.js` 或其他测试脚本；微信开发者工具已关闭旧真机调试会话并完成普通编译，模拟器恢复到首页，随后重新生成
  iOS/局域网二维码（工具显示约 21:14 CST 失效）。根因是开发者工具旧增量模块索引继续请求历史测试文件，不是当前运行包依赖；本次未修改或重启旧服务。
  详见 [`release/miniprogram-runtime-enoent-recovery-2026-08-20.md`](release/miniprogram-runtime-enoent-recovery-2026-08-20.md)。

- 2026-08-20 20:36 CST（当前新旧服务与 P0 日志只读观察）：新 API `10.0.0.3:18081` 与旧 Python
  `0.0.0.0:8001` 仍同时监听，`hospital-platform-api-v2.service=active`，readiness 的
  `database/redis/schema` 均为 `ok`。最近 15 分钟低敏计数只有健康/系统请求的 HTTP 200 和未登录认证的
  HTTP 401，没有微信、患者、预约、报告、门诊费用或普通资料业务事件；本次未重启、未部署、未写入业务数据，
  旧 Python 未修改。详见 [`release/current-runtime-p0-observation-2026-08-20-2036.md`](release/current-runtime-p0-observation-2026-08-20-2036.md)。

- 2026-08-20 20:30 CST（当前公网只读边界）：新 API 公网 `/api/v2/health/live`、`health/ready`、
  `system/ping` 均为 200，未登录 `/me`、`/patients` 均为 401；本次未携带 Bearer、未创建微信 session、
  未调用 Provider、未写入 MySQL/Redis。详见 [`release/current-public-readonly-smoke-2026-08-20-2030.md`](release/current-public-readonly-smoke-2026-08-20-2030.md)。

- 2026-08-20 20:27 CST（当前真机二维码）：新 `miniprogram` 窗口已重新编译 `8f80b3e` 候选，资源树指向
  `apps/miniprogram/dist/`，14 个页面已编译，iOS/局域网二维码预计 20:52 CST 失效。该记录只证明运行包和扫码入口，
  当前尚未取得手机扫码后的页面、HTTP 和服务端日志三层业务证据。详见 [`release/miniprogram-device-qr-session-2026-08-20-2027.md`](release/miniprogram-device-qr-session-2026-08-20-2027.md)。

- 2026-08-20 20:18 CST（患者同步会话顺序修正）：小程序患者同步现在先用只读 `/me` 建立 owner 会话证明，
  再进入 `POST /patients/sync` 的进程级 single-flight，避免首次登录推进会话代际后把有效同步结果误判为
  `session-changed`。定向回归和全量构建通过；这仍需当前二维码的真实微信会话验证。详见 [`release/miniprogram-patient-sync-session-proof-2026-08-20.md`](release/miniprogram-patient-sync-session-proof-2026-08-20.md)。

- 2026-08-20 18:01 CST（运行包测试文件边界收敛）：当时候选 `767ed9c` 通过 staging 构建，
  `dist/` 实际包含 14 个页面脚本且没有任何 `*.test.js`/`*.spec.js`。构建脚本和
  `runtime:verify` 已把测试脚本排除作为硬门禁；本轮全仓 `pnpm check` 通过（小程序 167 项测试）。
  真机调试曾报告 `dist/services/single-flight.test.js`，但复扫后的服务端窗口只出现健康检查，
  没有新的微信登录或患者请求，因此该现象只能记录为开发者工具旧运行包索引/项目窗口问题，不能计入
  微信授权、患者同步或后续业务验收。详细恢复顺序见
  [`release/miniprogram-runtime-test-file-boundary-2026-08-20.md`](release/miniprogram-runtime-test-file-boundary-2026-08-20.md)。

- 2026-08-20 19:46 CST（当前候选二维码会话）：新的 `miniprogram` 窗口已确认资源树指向 `dist/`，
  重新生成 iOS、局域网模式真机二维码，工具显示将于 20:11 CST 失效；模拟器当前停留在患者选择页，
  能看到服务端脱敏卡号。此记录只证明二维码生成和运行包边界正确，尚未取得手机扫码后的 `/auth/wechat`、
  `/me`、`/patients` 及页面/HTTP/低敏日志三层证据。详见
  [`release/miniprogram-device-qr-session-2026-08-20-1946.md`](release/miniprogram-device-qr-session-2026-08-20-1946.md)。

- 2026-08-20（最新网络边界审计）：新旧服务目前仍通过阿里云公网地址访问 MySQL/Redis；WireGuard 私网
  `10.0.0.3 ↔ 10.0.0.1` 已用真实 MySQL `SELECT 1` 和 Redis `PING` 验证可用。新 API 私网切换脚本已加入仓库，
  但当前 SSH 用户没有 systemd 重启授权，配置试切换已自动回滚，线上仍保持原状态；旧 Python `8001` 未修改。
  详见 [`release/production-network-boundary-audit-2026-08-20.md`](release/production-network-boundary-audit-2026-08-20.md)。

- 2026-08-20（最新本地门禁）：`8817f90` 后全仓 `pnpm check` 通过；这只证明当前代码、文档、迁移台账、
  测试和构建一致，不增加真机、Provider、数据库私网切换或业务成功证据。获得授权后先执行新 API 私网切换和
  readiness 观察，再继续患者选择、多患者切换、预约历史、门诊费用只读和普通资料真实写入；支付、医保、退款和 HIS
  仍最后处理。

- 2026-08-20 09:15 CST（公网只读复核）：`/health/live`、`/health/ready`、`/system/ping` 分别返回 200，
  readiness 为 `ready`；未带凭证的 `/me`、`/patients` 均返回 401/`unauthorized`。本次没有 Provider 调用、
  MySQL/Redis 写入或微信 session，不能据此证明本地 `1186937` 已部署、旧 Python 共存、患者同步、预约、报告、
  门诊费用或真机业务成功。详见 [`release/current-public-readonly-smoke-2026-08-20.md`](release/current-public-readonly-smoke-2026-08-20.md)。

- 2026-08-20 12:05 CST（公网与 SSH 运行层只读复核）：确认线上 `current` 为完整 release
  `398be8eca74d4f0245b88695056061ac43c7f860`，新 Bun API 监听 `10.0.0.3:18081`，旧 Python API 仍监听
  `0.0.0.0:8001`；systemd 服务为 `active`，公网 live/ready/ping 均为 200，ready 依赖为
  `database=ok`、`redis=ok`、`schema=ok`，未授权患者/预约接口均返回 `401 unauthorized`。本次没有重启、
  部署、Provider 调用或 MySQL/Redis 业务写入；本地 `e050fa0` 尚未部署，真实微信会话、患者同步、预约、
  报告、门诊费用和真机业务仍没有新增验收证据。详见 [`release/current-public-readonly-smoke-2026-08-20.md`](release/current-public-readonly-smoke-2026-08-20.md)。

- 2026-08-20 13:06 CST（线上运行层与 journald 只读复核）：线上仍为 `398be8e`，新 API `10.0.0.3:18081`
  与旧 Python `8001` 同时监听，Worker 保持 inactive，readiness 的 `database/redis/schema` 均为 `ok`。
  最近 30 分钟聚合为 3 条基础设施健康请求，`parseErrors=0`、`systemdWarningCount=0`，没有新的微信、患者、
  预约、报告或门诊费用业务事件；本次未修改旧服务、未重启、未调用 Provider、未写入 MySQL/Redis。详见
  [`release/current-runtime-readonly-observation-2026-08-20-1306.md`](release/current-runtime-readonly-observation-2026-08-20-1306.md)。

- 2026-08-20 13:42–13:44 CST（`0e360d3` 候选生产切换）：候选完成本地全仓门禁、真实生产 env preflight、
  `127.0.0.1:18082` 隔离 smoke 后，原子切换为线上 `current`。新 API 内外网 readiness、生产启动模式、
  公网 runtime smoke 和 journald 低敏聚合均通过；旧 Python `8001` 的 master/worker PID 和启动时间未变化。
  本次只部署 `patId` 字符串契约修正，没有调用 Provider、支付、医保或 HIS。完整证据见
  [`release/0e360d3-production-acceptance-2026-08-20.md`](release/0e360d3-production-acceptance-2026-08-20.md)。

- 2026-08-20（旧 Python `6201` 日志路由只读观察）：确认 `/common/mbs-fsi/6201` 的原始记录存在于
  `logs/info_2026-08-19.log`，但没有出现在 `logs/all.log`。原因是旧 Gunicorn 多 worker 各自持有并轮转
  文件 handler，`all.log` 不是完整索引；本次未修改旧项目、未重启旧服务、未主动发送医保请求。新服务继续
  使用 Pino + journald 的结构化日志链，不依赖旧 `all.log`。详见
  [`release/old-python-log-routing-observation-2026-08-20.md`](release/old-python-log-routing-observation-2026-08-20.md)。

- 2026-08-20（小程序运行包发布竞态）：微信开发者工具日志证明旧构建会在 TypeScript 编译前删除整个
  `dist/`，从而在页面 JS 尚未重新生成期间报告 `pages/report-directory/report-directory.js` 404。
  新构建先在 staging 完成编译、静态资源复制、来源指纹和页面门禁，再替换 live `dist/`；替换失败时
  保留旧运行包。本次不修改旧 Python、线上服务、数据库、Redis 或并行维护的开发者工具配置。详见
  [`release/miniprogram-runtime-publish-atomicity-2026-08-20.md`](release/miniprogram-runtime-publish-atomicity-2026-08-20.md)。

- 2026-08-20（报告目录多 Provider trace 边界）：发现 LIS/PACS/ECG 三路请求号直接逗号拼接后可能超过单个
  opaque 标识的 128 字符上限，导致 Provider 已成功返回的目录在 service 二次校验时被误判为响应非法。新端保留
  兼容的首个 `requestId`，并增加最多 8 项、逐项校验且必须包含主 ID 的 `requestIds`；低敏日志同时保留主 ID
  和完整有界列表，不记录 Provider 原文或患者字段。domain `52/52`、adapters `102/102`、API `183/183` 通过；
  本轮未打开报告 gate、未调用真实 Provider、未部署、未修改旧 Python。详见
  [`release/report-provider-trace-aggregation-boundary-2026-08-20.md`](release/report-provider-trace-aggregation-boundary-2026-08-20.md)。

- 2026-08-20（普通资料更新链定向回归）：服务端普通资料 service `13/13` 通过，小程序患者选择、会话
  代际、资料保存和公共 API 响应门禁定向回归 `163/163` 通过；API 集成测试同时确认 owner 隔离、版本冲突、
  `null` 清空和旧端 `avatar/openid` 字段拒绝。该结果只证明代码、契约和本地测试边界，不代表真实微信资料
  首次写入、双设备 `409`、公网日志同链或真机页面已经验收；下一步仍需使用当前 `6ce1272` 候选按
  [`release/user-profile-readonly-device-acceptance-2026-08-18.md`](release/user-profile-readonly-device-acceptance-2026-08-18.md)
  采集页面、HTTP 和低敏日志三层证据。

- 2026-08-20（“我的”页面跨请求会话组合审计）：发现小程序 API 客户端虽然能保护单个请求，
  但 `/me`、个人资料和患者目录之间仍缺少页面级 owner 代际围栏；账号在资料请求期间切换时，
  资料降级可能继续启动新账号患者目录，形成混合页面快照。新项目已在小程序页面层补充代际检查、
  旧派生状态清理和中文回归门禁；定向测试 `163/163`、类型检查通过。本次尚未上传小程序、未部署线上、
  未调用 Provider、未修改旧 Python 服务、数据库或 Redis。详见
  [`release/miniprogram-my-page-session-composition-boundary-2026-08-20.md`](release/miniprogram-my-page-session-composition-boundary-2026-08-20.md)。

- 2026-08-20（患者同步过期快照审计）：发现旧同步请求在租约过期并由新幂等键接管后，若晚于新快照返回，
  仅依赖单患者 `directory_last_seen_at` 仍可能重新激活新快照已经停用的患者。新端已在带 operation 的 MySQL
  快照事务中重新锁定 owner 行，并在任何患者写入前拒绝早于已提交成功快照的 `observedAt`；内存仓储同步维护
  最新快照水位，API 返回 `409 patient-sync-stale`，日志记录 `patient.directory.snapshot.stale`。新增跨快照回归测试，
  未修改众阳 adapter、旧 Python 服务、线上数据库、Redis 或小程序并行文件。

- 2026-08-20（公共错误码跨层复核）：上一项新增的 `patient-sync-stale` 已补入原生小程序统一中文文案表，
  并重新执行文档驱动的客户端验收，避免过期同步结果在页面上退化为无业务含义的通用“请求失败”。本轮只修改新项目，
  未部署、未重启旧 Python、未调用 Provider、未写入数据库/Redis，也未触碰并行会话文件。

- 2026-08-20（预约、门诊费用与患者档案只读闭环审计）：结合旧端真实 `patInfosFind` 响应，确认
  `data.patId` 是预约、报告和门诊费用共用的 HIS 临床患者引用，不是首页二维码 ID；新端继续以 owner-scoped
  `his-patient` 映射驱动 Provider 查询。复核了患者卡片独立归属、预约渠道 3、费用 `tradeStatus=1/3`、金额元转分、
  中国标准时间 30 日窗口、重复/越界整批拒绝和低敏日志边界，未发现可以不猜 Provider 合同而安全修复的缺口。
  适配器 95/95、API 163/163、小程序 163/163 通过；本次没有调用 Provider、修改旧 Python、写入数据库/Redis 或发布线上。
  详见 [`release/readonly-business-chain-audit-2026-08-20.md`](release/readonly-business-chain-audit-2026-08-20.md)。

- 2026-08-20（门诊病历目录准入复核）：重新校验旧端 `electronic_record.vue` 与 `ZY.ts` 的源码指纹，确认旧端仅能证明
  `POST /msun-middle-aggregate-clinic/v1/out-visit-records` 的调用方式，且把非数组/异常折叠为空列表；当前仍缺正式
  Provider contract、`patId` 用途确认、字段白名单和成功/空/拒绝/暂时失败脱敏样例。新端继续保持
  `GET /api/v2/medical-records` 未注册/404，不把报告目录冒充病历，也不新增兼容转发。本次只更新新项目文档，未修改旧项目、
  线上服务、数据库或 Redis。详见 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md)。

- 2026-08-20（患者新增/绑定流程准入复核）：复核旧端 `patientAdd.vue`、`patientChange.vue` 和 `ZY.ts`，确认旧流程存在
  “查档异常继续建档”、身份证号代替卡号、建档后绑卡无最终确认、用户资料副作用和协议默认同意等风险；当前缺 PB-01 至 PB-16
  的正式 Provider contract、幂等/冲突/撤销语义和脱敏错误样例。新端继续只做已绑定患者目录同步和显式切换，新增绑定入口保持迁移提示，
  不注册写入 API、不修改旧服务。详见 [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md)。

- 2026-08-20（健康知识上线准入复核）：确认新端已有版本化 schema、domain validator、单事务导入器和只读 repository，
  但仓库内没有可审计的脱敏内容 bundle，尚无真实来源/审核/发布/撤回和患者端页面证据。健康知识 API 继续不挂载，
  不使用 fixture 或旧正文冒充生产内容；自测、风险评估、AI 导诊和报告解读保持独立。详见
  [`release/health-knowledge-readiness-audit-2026-08-20.md`](release/health-knowledge-readiness-audit-2026-08-20.md)。

- 2026-08-20（健康知识详情归属门禁）：继续审计只读 service，发现仓储即使返回结构合法的疾病/药品详情，
  也可能与请求路径中的 opaque id 不一致。现已在 service 运行时白名单校验中绑定 `diseaseId`/`drugId` 与返回
  `item.id`，错配整次 fail-closed，并保留低敏 `persistence-invalid` 错误语义。该修正只在新项目本地完成，
  未导入内容、未挂载健康知识 API、未修改旧 Python、数据库、Redis 或线上服务。

- 2026-08-20（健康知识正文边界一致性）：对照旧端 `LONGTEXT` 字段和详情页的分段展示，确认审核正文
  的内部 CR/LF 必须在导入后仍可读取；新端现已让导入器和读模型同时允许正文换行，并在提交前拒绝制表符、
  NUL、DEL 等其它不可见控制字符，避免形成“数据库已发布但患者读取 500”的半成功版本。健康知识 API
  继续保持未挂载，真实内容来源、临床审核、发布/撤回演练和患者页面验收仍是下一道门禁。

- 2026-08-20（健康知识版本内关系完整性）：复核 MySQL 复合外键后确认它只能保证同版本条目存在，不能
  保证关系主体的 `item_kind` 正确；repository 现已对部位/症状/分类/药品关系增加类别约束，并拒绝未知的
  `is_clickable` 布尔值。该修正只收紧错误数据的读取边界，健康知识内容仍未导入、API 仍未挂载，也未写入线上数据库。

- 2026-08-20（下一阶段业务门禁执行板）：将当前已实现但仍待真实证据的微信会话、患者显式切换、普通资料、预约历史、
  爽约和门诊费用，与报告、病历、绑卡、健康知识及支付/医保/HIS 的契约缺口重新分层。后续按“真机微信会话 → 患者切换
  → 预约/费用只读 → 资料 → 其余独立 contract → 支付医保最后专项”执行；三层证据不足时不扩大开放范围。详见
  [`release/next-business-gates-2026-08-20.md`](release/next-business-gates-2026-08-20.md)。本轮只修改新项目文档，未修改旧 Python、
  线上服务、数据库、Redis 或并行众阳自动化文件。

- 2026-08-20 14:42 CST（公网只读复核）：新 API 公网 `health/live`、`health/ready`、`system/ping` 均返回 200，
  ready 的 database、Redis 和 schema 均为 `ok`；普通资料、预约历史和门诊费用入口在无凭证下均按预期返回 401。
  本次没有创建微信 session、调用 Provider 或写入业务数据，因此不增加真机、患者、预约或门诊费用验收结论。详见
  [`release/current-public-readonly-smoke-2026-08-20-1442.md`](release/current-public-readonly-smoke-2026-08-20-1442.md)。

- 2026-08-20 16:10–16:14 CST（真机微信会话与患者同步部分验收）：阿里云公网日志观测到同一 iPhone 微信 WebView
  先收到 `/me 401`，随后 `/auth/wechat 200`、`/me 200`、`/patients 200` 和 `/patients/sync 200`，并有后续会话恢复请求。
  这证明当前新服务的真实微信会话与患者同步入口可达，但开发者工具当前真机画面仍显示匿名，尚未取得患者选择页、患者目录内容、
  多患者切换和页面三层同链证据；不能据此开放预约写入、报告、门诊费用或支付医保。详见
  [`release/miniprogram-real-device-login-acceptance-2026-08-20.md`](release/miniprogram-real-device-login-acceptance-2026-08-20.md)。

- 2026-08-20（Bearer 会话输入边界）：复核认证入口发现任意长度或带控制字符的 Authorization token 仍可能先进入
  session 实现。现已在统一鉴权入口、Redis session 和测试内存 session 前增加 512 字符的安全形状门禁；畸形 token
  直接返回 `401 unauthorized`，不触碰 Redis、不写入日志。该修正不改变正常 token、Redis TTL 或 owner 语义，未修改
  众阳 Provider 自动化、旧 Python、数据库、Redis 配置或线上服务。

- 2026-08-20（微信一次性 code 输入边界与本地门禁）：新提交 `3a7f952` 让登录 contract、AuthService 和微信 adapter
  统一拒绝首尾空白、控制字符、超长 `code`，并拒绝 `openid`、`session_key` 等未知字段；API 170/170、adapter 96/96
  通过。完整 `pnpm check` 的架构、迁移、Provider intake、文档、基线、格式、lint、工具、类型和测试阶段均通过，
  但小程序 build 因并行会话尚未提交的运行输入被 provenance 门禁主动停止；本次没有部署、Provider 调用、旧 Python、
  MySQL/Redis 写入或线上小程序上传。Docker daemon 未运行，`pnpm db:integration` 尚未取得 MySQL/Redis 集成证据。

- 2026-08-20（患者目录 Provider 响应资源边界）：发现 `patientInfoByUnionId` 返回完整数组后会为每位患者调用一次
  `patInfosFind`；此前没有数组基数上限，异常响应可能造成无界并发外部请求。现已在患者 adapter 的字段映射和临床档案查询
  之前增加 128 条资源上限，超过即整批 `provider-response-invalid`，不截断、不写快照、不发起档案查询；适配器全套
  97/97、213 个断言通过。该上限是资源保护而非业务绑定人数规则，Provider 分页契约未确认前不会改为截断成功；本次未调用
  Provider、未修改旧 Python、数据库、Redis 或线上 gate。详见 [`provider-contract-v1.md`](provider-contract-v1.md)。

- 2026-08-20（患者档案查询并发边界）：继续复核发现目录未超出资源上限时，`patInfosFind` 仍会由无界 `Promise.all` 同时发出。
  现改为最多 4 路并发并保持目录顺序；任一档案查询失败后不再领取新任务，已在途请求仍按超时/取消机制收尾。适配器全套
  98/98、216 个断言通过；该调整只改变调用调度，不改变患者字段、临床映射或快照语义，未调用 Provider、未修改旧 Python、
  数据库、Redis 或线上 gate。详见 [`provider-contract-v1.md`](provider-contract-v1.md)。

- 2026-08-20（报告短期引用持久化并发边界）：复核报告目录服务时发现，详情 gate 打开后，所有 LIS 报告引用会由无界
  `Promise.all` 同时写入 MySQL。现改为最多 4 路并发，保持报告顺序；单条引用失败仍隐藏详情入口并保留摘要，不改变
  Provider 查询、报告字段、TTL 或失败语义。API 全套 171/171、733 个断言通过；本次未调用 Provider、未写入真实数据库、
  未修改旧 Python、线上服务或并行会话文件。该并发度是平台资源策略，不是 Provider 分页合同，详见
  [`provider-contract-v1.md`](provider-contract-v1.md)。

- 2026-08-20（预约排班快照持久化并发边界）：复核排班只读服务时发现，已验证的每条排班会由无界 `Promise.all` 同时写入
  短期 MySQL 快照。现改为最多 4 路并发并保持目录顺序；任一写入异常后不再领取新任务，已在途写入收尾后统一记录
  `snapshotPersistenceStatus=unavailable`，只读目录仍保留真实结果。预约测试 20/20、80 个断言通过；本次未调用 Provider、
  未写入真实数据库、未开放锁号/预约写入、未修改旧 Python 或并行会话文件。该并发度是平台资源策略，不是号源或分页合同，
  详见 [`provider-contract-v1.md`](provider-contract-v1.md)。

- 2026-08-20（门诊费用只读响应资源边界）：审计发现 Provider 及可注入网关的费用数组此前没有数量上限，异常响应会在对象映射、
  金额解析、稳定费用 ID 和小程序序列化阶段放大资源。现统一增加 512 条资源上限：adapter 在映射前拒绝，domain/service 再次拒绝，
  超过即整批 `provider-response-invalid`，不截断、不记录 `loaded`，不改变正常金额、状态、30 日窗口或支付/医保关闭边界。
  domain 定向测试 3/3、adapter 定向测试 16/16、API 门诊费用 service 定向测试 13/13，API 全套 174/174，
  全项目 `pnpm test` 和 `pnpm typecheck` 均通过。本轮未调用 Provider、未写入真实数据库、未修改旧 Python 或并行会话文件。
  详见 [`provider-contract-v1.md`](provider-contract-v1.md)。

- 2026-08-20（报告/预约只读数组资源边界闭环）：审计发现报告目录、LIS 明细、预约科室、排班和预约历史此前没有统一数组基数保护，
  异常 Provider 或可注入 gateway 可能放大映射、平台排班 ID、短期报告详情引用和页面响应。现集中增加报告目录 512、LIS 明细 1024、
  预约科室 256、排班 512、预约历史 512 的平台资源上限；adapter 与 domain/service 双层整批拒绝，绝不截断、不生成引用、
  不写入快照、不返回部分临床明细。定向 domain 4/4、adapter 30/30、预约/报告 service 41/41 通过；本轮未调用 Provider、未写真实
  MySQL/Redis、未改旧 Python 或并行众阳文件。详见 [`provider-contract-v1.md`](provider-contract-v1.md) 与
  [`api-v2-public.md`](api-v2-public.md)。

- 2026-08-20（患者读模型资源边界闭环）：继续审计患者链路时发现同步 gateway 已有 128 条上限，但普通 `GET /patients` 及同步
  提交后的 owner-scoped 读模型没有复用该边界，异常仓储、回放器或人工修复可能把超大目录序列化给小程序。现由 domain 的
  `normalizePatientReadModel` 统一拒绝超过 128 条的读模型，service 记录固定 `patients-too-many` 并返回 `500 persistence-invalid`，
  不截断、不伪装成空目录、不记录 `loaded`；同步、读取和客户端错误文案/公开文档已保持一致。定向 domain 7/7、患者 service 18/18 通过，
  本轮未调用 Provider、未写真实 MySQL/Redis、未改旧 Python 或并行众阳文件。

- 2026-08-20（只读查询结果与筛选条件绑定）：审计发现预约排班 service 只验证日期格式，未验证返回排班是否位于请求窗口、
  科室和医生筛选内；报告 service 指定 `kind` 时也未验证返回摘要来源。现改为服务层整批 fail-closed：窗口外/科室错配/医生错配
  和报告来源错配统一记录有限 `resultViolation`，不静默过滤、不写入成功日志；预约 service 21/21、报告 service 18/18、API 全套
  176/176 通过，完整 `pnpm test` 和 `pnpm typecheck` 均为 9/9。该修正不调用 Provider、
  不写入数据库/Redis、不修改旧 Python 或并行众阳自动化文件，预约写入、支付、医保和 HIS 继续关闭。

- 2026-08-20（患者目录资源边界闭环）：审计发现患者 adapter 已有 128 条完整目录上限，但可注入 gateway 进入 domain/service
  后仍可绕过该边界，继续生成平台 ID 并进入快照写入。现将上限集中到 domain，并由 adapter 与 service 共用：超量在字段映射、
  档案查询、平台 ID 生成和快照事务前整批拒绝，不截断、不回收失效患者、不写入数据库。适配器定向测试 24/24、患者同步 service
  定向测试 17/17，完整类型检查和全项目测试均通过；本轮未调用 Provider、未写入真实数据库或 Redis、未修改旧 Python，也未触碰并行
  众阳自动化文件。

- 2026-08-20（档案卡片列表独立证据门禁，本地待发布）：复核 `patInfosFind` 身份关联时发现，若把顶层卡号和
  `patCardVOList` 合并判断，可能让“顶层卡号匹配但卡片列表为空、无卡号或指向另一张卡”的错误档案进入
  `his-patient` 映射。现已让显式卡片列表独立证明查询卡号归属，并补充 2 个回归场景；患者 adapter 定向
  22/22、适配器全套 95/95、全项目 `pnpm check` 通过。该修正尚未部署到线上 `398be8e`，未修改旧 Python、
  数据库、Redis、公网路由或小程序候选。

- 2026-08-19（患者卡号类型边界加固，本地待发布）：发现通用外部 ID 校验若允许安全整数卡号，
  JSON 数字仍可能丢失医院卡号前导零。新 adapter 现要求目录输入和 `patInfosFind` 档案响应中的卡号保持字符串，
  否则在 Provider 查询或 `his-patient` 映射前 fail-closed；新增 2 项回归测试，完整适配器测试为 93/93，
  全项目门禁通过。该修正已提交为 `bb223c1`，但尚未部署到线上 `398be8e`，也没有修改旧 Python、数据库、Redis 或公网路由。

- 2026-08-19 17:58 CST（局域网真机调试重试）：当前 `miniprogram` 窗口重新生成 iOS 二维码，代码包约 `643 KB`，
  “局域网模式”已勾选，工具显示有效至 18:23；截至观察结束仍没有手机连接、微信 session 或业务 HTTP 流量。
  该状态只能证明二维码入口和传输模式配置已生成，不能计入微信登录、患者同步、预约、报告或门诊费用验收；本次没有修改
  旧 Python、线上新 API、MySQL、Redis 或 Provider 配置。详见
  [`release/miniprogram-device-session-lan-2026-08-19.md`](release/miniprogram-device-session-lan-2026-08-19.md)。

- 2026-08-19 18:15 CST（真机调试工具追加观察）：二维码仍可见，iOS 与局域网模式仍已选中，但没有手机连接、微信 `code`、
  平台 session 或业务 HTTP 流量；工具同时提示“模拟器长时间没有响应”，调试面板持续出现代码包文件列表请求日志。
  该提示发生在业务请求前，暂归类为开发者工具/真机传输层状态，不升级微信登录、患者同步、预约、报告或门诊费用验收等级，
  也没有修改旧 Python、线上新 API、MySQL、Redis 或 Provider 配置。详见
  [`release/miniprogram-device-session-lan-2026-08-19.md`](release/miniprogram-device-session-lan-2026-08-19.md)。

- 2026-08-19 16:57 CST 重启后 SSH 只读复核：`398be8e` 仍为 `current`，新 API
  `10.0.0.3:18081` 与旧 Python `8001` 同时监听，systemd 为 `active/enabled`；使用正确内网绑定地址检查时
  live=200，ready 的 `database/redis/schema` 均为 `ok`。第一次对 `127.0.0.1:18081` 的连接拒绝是探针地址错误，
  不是服务故障。最近 15 分钟没有观察到新的患者、预约、门诊费用或资料业务事件，不升级真机或 Provider 验收等级。
  详见 [`release/current-398be8e-runtime-recheck-2026-08-19-1657.md`](release/current-398be8e-runtime-recheck-2026-08-19-1657.md)。

- 2026-08-19（小程序患者入口四态会话门禁）：发现预约记录、爽约记录、报告目录和门诊费用页面的“更换就诊人”
  入口仍保留“本地 token 存在即放行”的兼容默认值。现已删除 boolean/默认 token 分支，四个页面在患者目录读取前
  先完成 `/me` 验证，并显式保存 `checking/valid/invalid/unavailable` 状态；入口与页面请求不再把本地凭证存在误解为
  服务端登录成功。小程序定向测试 `163/163`、`1302` 个断言，TypeScript 和 Biome 通过；本地候选尚未上传，
  未修改新旧服务、数据库、Redis 或线上小程序，详见
  [`release/miniprogram-patient-navigation-session-state-2026-08-19.md`](release/miniprogram-patient-navigation-session-state-2026-08-19.md)。

- 2026-08-19（候选基线更新）：上述会话门禁修正已提交为 `474b044`，重新构建 14 个页面运行包，
  `sourceRevision=474b0444736599c848a4cef9f47fd930884e401d`。线上服务仍为 `398be8e`，该小程序候选尚未上传，
  真机二维码和业务日志证据仍需重新取得。

- 2026-08-19（当时候选文档指针对齐）：复核发现部分验收手册和迁移总表仍把历史 `48ba22f` 当作当时当前小程序候选，
  容易让下一次真机验收导入错误运行包。历史 release 记录保留原始来源，当前入口文档已统一指向
  `474b044` / `474b0444736599c848a4cef9f47fd930884e401d`；关键当前语义短语已纳入发布基线逐处审计，
  本轮只修改新项目文档和审计工具，没有上传小程序、调用 Provider、修改旧 Python、数据库或 Redis。

- 2026-08-19 16:30–16:37 CST 生产切换：患者临床可用性读模型和 Provider 归属校验修正已从 `968af78` 原子切换到
  `398be8e`，只重启新 API；旧 Python `8001` 保持监听。生产 preflight、候选 `18082` smoke、公网 live/ready 连续
  `6/6`、system ping、未登录 `401` 和日志聚合均通过，`parseErrors=0`、`systemdWarningCount=0`。
  本窗口没有真实患者、预约或费用 Provider 业务事件，真机验收等级不变。详见
  [`release/398be8e-production-acceptance-2026-08-19.md`](release/398be8e-production-acceptance-2026-08-19.md)。

- 2026-08-19 16:49–16:51 CST 真机入口复核：当前 `miniprogram` 窗口已使用 `48ba22f` 完整来源重新生成 iOS 二维码，
  约 643 KB，有效至 17:14；已有“真机调试”子窗口显示未连接且服务已结束，没有形成手机连接、微信 session 或业务日志。
  本次只记录候选入口状态，不升级微信、患者、预约、门诊费用或真机验收等级。详见
  [`release/miniprogram-device-session-2026-08-19-1651.md`](release/miniprogram-device-session-2026-08-19-1651.md)。

- 2026-08-19 15:00 CST 生产切换：新 Elysia API 已从 `08c36a8` 原子切换到 `968af78`。候选在 `18082` 完成生产依赖
  preflight 和连续 readiness smoke 后，只重启 `hospital-platform-api-v2.service`；新 API `10.0.0.3:18081`
  与旧 Python `8001` 持续共存，公网 live/ready/ping 和未登录 401 边界通过。该 release 同时固化了旧端
  `patInfosFind.data.patId` 是临床 `his-patient` 引用、不是二维码载荷的证据。详细记录见
  [`release/968af78-production-acceptance-2026-08-19.md`](release/968af78-production-acceptance-2026-08-19.md)。
  Provider 业务、真实微信真机和支付/医保仍未验收。

- 2026-08-19 15:43 CST SSH 只读复核：`current` 仍指向 `968af78`，`hospital-platform-api-v2.service` 为 `active`，
  新 API `10.0.0.3:18081` 和旧 Python `0.0.0.0:8001` 同时监听；公网 live/ready 均返回 `200`，ready 的
  `database/redis/schema` 均为 `ok`。本次没有写入、重启或调用 Provider，只更新运行层共存证据，不增加微信、患者、预约、
  报告、门诊费用或真机业务验收等级。详见
  [`release/current-968af78-runtime-coexistence-2026-08-19-1543.md`](release/current-968af78-runtime-coexistence-2026-08-19-1543.md)。

- 2026-08-19 15:50 CST 重启后 SSH 只读复核：`current` 仍指向 `968af78`，新 API 与旧 Python `8001` 同时监听，
  公网 live/ready 均返回 `200`，ready 的 `database/redis/schema` 均为 `ok`；最近 20 分钟没有新的登录、患者、预约、
  门诊费用或报告业务事件。本次没有写入、调用 Provider 或使用微信会话，不升级任何业务验收等级。下一步回到当前
  `48ba22f` 小程序候选，按“微信登录 → 患者同步/显式切换 → 预约历史 → 门诊费用”的只读三层证据顺序取证，支付、医保、
  预约写入、二维码和 HIS 回写继续关闭。详见
  [`release/current-968af78-runtime-coexistence-2026-08-19-1550.md`](release/current-968af78-runtime-coexistence-2026-08-19-1550.md)。

- 2026-08-19 16:13 CST SSH 只读复核：`current` 仍指向 `968af78`，`hospital-platform-api-v2.service=active`，
  新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听；内网和公网 live/ready 均返回 `200`，
  `database/redis/schema` 均为 `ok`。本次只执行健康检查，没有调用 Provider、使用微信会话或写入业务数据，
  不增加微信、患者、预约、报告、门诊费用或真机业务验收等级。详细证据见
  [`release/current-968af78-runtime-coexistence-2026-08-19-1613.md`](release/current-968af78-runtime-coexistence-2026-08-19-1613.md)。

- 2026-08-19（患者临床可用性读模型对齐）：发现内存测试仓储在缺少独立 `his-patient` 映射时可能沿用历史
  `clinicalAccess=ready`，与 MySQL 通过 `EXISTS` 实时计算的生产读模型不一致。现已统一为“映射存在才 `ready`，否则
  `unavailable`”，补充历史脏状态回归测试和中文核心注释。该修正只在新项目完成，未修改旧 Python、线上服务、数据库或 Redis，
  已随 `398be8e` 部署；详见
  [`release/398be8e-production-acceptance-2026-08-19.md`](release/398be8e-production-acceptance-2026-08-19.md)。

- 2026-08-19（患者临床映射 Provider 归属校验）：发现 MySQL 临床引用查询此前只筛选独立映射表的 Provider，
  未同时确认患者主表的 `provider_name`。现已增加主表与映射表 Provider 的联合条件，避免历史迁移或异常修复产生
  “其它 Provider 患者主表 + 众阳 HIS patId”交叉记录；补充 SQL 参数回归断言和中文注释。该修正只在新项目完成，
  未修改旧 Python、线上服务、数据库或 Redis，已随 `398be8e` 部署；详见
  [`release/398be8e-production-acceptance-2026-08-19.md`](release/398be8e-production-acceptance-2026-08-19.md)。

- 2026-08-19（档案查询身份二次关联）：在不要求 Provider 尚未冻结的可选字段全部存在的前提下，
  新 adapter 现在会校验：响应若包含 `patName`，必须匹配本次查询姓名；若包含顶层卡号或
  `patCardVOList`，必须包含本次查询卡号；若卡片项包含 `patId`，还必须与档案顶层 `patId` 一致。
  姓名/卡号/卡片归属不一致、卡片列表异常或字段格式异常时整次同步 fail-closed，不写入错误
  `his-patient` 映射；错误信息不携带查询姓名、卡号或原始档案。新增定向测试覆盖空卡片列表拒绝绑定；
  该规则已随 `968af78` 部署到新 API，未修改旧 Python、数据库或 Redis，也未调用真实 Provider。
  Provider 正式字段、档案状态枚举、真实业务和真机证据仍待补齐。

- 2026-08-19 12:39 CST（切换前 release 只读复核）：SSH 确认 `current=65219e2`、新 API `active`、Worker `inactive`，
  `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 共存；使用当前 release 的 preflight 和受控生产 env 复核
  `environment=production`、MySQL/Redis/schema `ok`、schema marker `0016`，患者/预约/门诊费用 gate 为 configured，
  支付和报告 gate 仍 disabled。该窗口没有注入真实会话或患者，不增加 Provider/真机业务证据，详见
  [`release/current-65219e2-preflight-and-coexistence-2026-08-19.md`](release/current-65219e2-preflight-and-coexistence-2026-08-19.md)。

- 2026-08-19（门诊费用与临床 `patId` 契约审计）：复核旧端 2.6.33
  `outpatient-child-payment-records` 请求和真实 `patInfosFind` 响应，确认 `data.patId` 是预约历史、报告和门诊费用
  共用的 HIS 临床引用，不能与目录 `thirdPatientId` 或首页二维码的 `medicalCardNo` 混用。新版只读链路已经固定
  owner-scoped `his-patient` 映射、`amount` 元转分、`tradeStatus=1/3`、30 个 `Asia/Shanghai` 日历日和公共字段白名单；
  旧端 `waitPayAmount` 及 `internetHospital`/`thirdSelfMachine` 渠道差异不做猜测。定向 adapter 15/15、API service 12/12
  通过，真实 Provider 字段对照、当前 release 公网/真机三层证据仍待完成，支付/医保继续关闭。详见
  [`migration/outpatient-payment-provider-contract-audit-2026-08-19.md`](migration/outpatient-payment-provider-contract-audit-2026-08-19.md)。

- 2026-08-19（“我的挂号”状态展示边界复核）：旧端在线挂号使用 `requestChannel=3`、全部挂号使用 `requestChannel=4`；
  新端继续只开放已确认的渠道 3，未凭页面筛选拼出全部记录。本轮补强小程序展示边界：已确认枚举 `unknown` 仍显示为“状态未知”，
  但绕过响应校验的未知状态不会因为“不等于 cancelled”而进入在线列表；未开放的渠道 4、详情、取消、预问诊、预约写入和挂号费支付继续关闭。
  详见 [`release/appointment-record-tab-contract-audit-2026-08-19.md`](release/appointment-record-tab-contract-audit-2026-08-19.md)。

- 2026-08-19 11:49 CST（会话与 readiness 只读复核）：数据库瞬态断连恢复后，新 API `b7c9451` 仍为 `active/running`，
  正确监听地址 `10.0.0.3:18081` 的 readiness 为 `database/redis/schema=ok`，旧 Python `8001` 继续共存。Redis 会话 TTL
  审计仍安全返回 `redis-session-scan-unavailable`、退出码 `2`；这只说明当前身份没有完成会话扫描权限，不能当作“没有会话”。
  没有修改 ACL、重启服务、写数据库/Redis 或操作旧项目。详见
  [`release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md`](release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md)。

- 2026-08-19 11:55 CST（生产配置 gate 只读复核）：`NODE_ENV=production`，schema、微信身份、患者目录、预约目录/记录和
  门诊费用 gate 为 `true`；微信支付、报告目录和报告详情 gate 仍为 `false`。这只证明配置准入，不增加 Provider、页面、真机或
  支付验收结论；新旧服务继续共存，根分区 95% 使用率仍需运维跟踪。详见
  [`release/current-b7c9451-config-gates-observation-2026-08-19-1155.md`](release/current-b7c9451-config-gates-observation-2026-08-19-1155.md)。

- 2026-08-19 11:43–11:44 CST（重启后数据库瞬态只读复核）：SSH 确认新 API `b7c9451` 与旧 Python `8001` 共存，期间新 API
  的远端 MySQL 探针出现一次 `PROTOCOL_CONNECTION_LOST`，`/health/ready` 短暂为 `not_ready`；约一分钟后 database、Redis、schema
  全部恢复 `ok`，没有重启服务或修改旧项目。已确认新 API 连接的是远端 MySQL，不应以服务器本机 3306 判断生产数据库；服务器根分区约
  95% 使用率另记为运维风险。完整只读证据见 [`release/current-b7c9451-database-transient-observation-2026-08-19.md`](release/current-b7c9451-database-transient-observation-2026-08-19.md)。

- 2026-08-19（档案 `patId` 数值精度边界）：根据旧端 `patInfosFind` 的真实响应形状，确认 `data.patId` 可能是 19 位临床引用；
  新 adapter 现在只兼容安全整数形式的短数字，拒绝超出 JavaScript 安全整数范围的 JSON number，并保留合法的 19 位字符串引用。
  补充了含身份证、手机号和 `patCardVOList` 额外字段的完整包络测试，验证只有 `his-patient` 引用进入内部结果，敏感字段不外泄。
  adapter `86/86` 测试和类型检查通过；没有调用真实 Provider、修改旧项目、数据库、Redis 或线上服务。边界说明见
  [`migration/patient-provider-reference-mapping.md`](migration/patient-provider-reference-mapping.md)。

- 2026-08-19（报告 Provider 契约差异复核）：只读核对旧端 LIS、PACS、ECG、体检 PEIS 四类报告请求，确认新端目前仅有前三类
  目录和 LIS 详情骨架；体检接口需要完整身份证号，旧端还会把非 LIS 报告对象和外部文件地址写入本地缓存，均不能直接复制。
  本轮没有打开报告 gate、没有调用 Provider、没有新增报告 API/小程序能力，差异和后续停止条件记录在
  [`migration/report-provider-contract-audit-2026-08-19.md`](migration/report-provider-contract-audit-2026-08-19.md)。

- 2026-08-19（档案查询安全边界与失败日志复核）：复核旧端 `patInfosFind` 的真实响应形状，确认新 adapter 只读取
  `success=true` 下的 `data.patId`，不把身份证、手机号、`patCardVOList` 或原始档案对象带入公共模型。补充档案 HTTP 失败时
  不泄露查询卡号/姓名和原始响应的回归测试，并让 `patient.directory.failed` 增加安全的 Provider 请求号、状态码和可重试字段，
  便于排障但不扩大敏感日志面。该轮只修改新项目、未调用真实 Provider、未重启服务、未修改旧 Python；二维码仍按既有契约保持关闭。

- 2026-08-19 11:01 CST（线上业务事件只读复核）：SSH 再次确认线上仍为 `b7c9451`，新 API `18081` 与旧 Python `8001`
  共存，live/ready 和 `database/redis/schema=ok` 均正常。最近约 30 分钟只有微信登录、患者读取和同步事件，没有预约记录、
  爽约或门诊费用事件；聚合中有 1 次 HTTP 失败，经只读投影确认为旧会话访问 `/api/v1/me` 的预期 `401 unauthorized`，
  不是新业务故障。由于仍没有新小程序窗口的手机连接，
  不把这组日志算作真机业务验收，详见 [`current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md`](release/current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md)。

- 2026-08-19 11:12 CST（真机窗口边界复核）：新 `miniprogram` 窗口仍只有已过期二维码，没有手机连接；另一个独立
  “真机调试”窗口出现旧端 Provider 直连上下文，无法证明属于当前 `b55df37` 运行包，因此设备、页面、Network 和日志均排除。
  本次没有点击业务、关闭窗口、修改服务器或旧 Python；下一步必须在新 `miniprogram` 窗口重新生成二维码后再扫码，详见
  [`miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-19 11:20 CST（真机入口复核未形成新二维码）：重新读取新 `miniprogram` 窗口后，资源树仍为 `dist/`，但没有新的二维码、
  手机连接或可绑定的独立真机调试窗口；一次入口操作也未形成“当前候选来源 + 有效二维码 + 设备连接”的证据链。因此不把本次模拟器/Network
  画面或页面变化计入微信登录、患者切换、预约、费用或其它业务验收。下一步仍需在新窗口人工重新生成二维码并扫码，详见
  [`miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-19（重启恢复后的预约历史/门诊费用只读契约审计）：服务端复核了 owner-scoped 患者映射、中国标准时间查询窗口、
  Provider 状态与金额白名单、重复记录/窗口越界整批拒绝和低敏关联日志；小程序复核了平台成功包络、当前就诊人门禁以及刷新后的陈旧异步事件丢弃。
  未发现可以在不猜 Provider 合同的前提下安全修复的业务缺口，因此没有新增兼容代码、Provider 调用、数据库/Redis 操作或线上发布。
  门诊费用服务定向测试 `12/12`、小程序相关测试 `160/160`、API 与小程序 TypeScript 类型检查均通过；下一步仍是取得新项目二维码并完成真机三层证据，
  不把本地测试升级为真实业务验收。

- 2026-08-19（报告目录旧患者事件边界）：报告目录详情导航现在在当前渲染批次回查后，
  还会确认 `patientId` 仍是设备当前显式选择；患者切换后遗留事件会在客户端停止，
  不把旧患者引用带入详情页，同时保留服务端 owner/患者/TTL 最终校验。新增中文注释和
  验收断言，小程序测试 `159/159`、API 测试 `162/162`、全仓门禁和 14 页面构建通过；
  提交 `b55df37`，尚未上传或切换线上，详见
  [`miniprogram-report-directory-stale-event-2026-08-19.md`](release/miniprogram-report-directory-stale-event-2026-08-19.md)。

- 2026-08-19（选择页会话代际边界）：修正选择页在同步完成后发生 token 轮换时仍保留旧患者目录并允许回跳的竞态；
  现在会话代际变化会先清理旧目录并重新读取当前会话，异步同步回写前也会拒绝旧代际结果。新增中文核心注释和验收断言，
  本地小程序测试 `159/159`、API 测试 `162/162`、全仓 `pnpm check` 和 14 页面构建均通过；提交 `1edf5b8`。
  该提交尚未上传微信开发者工具或切换线上，真机证据仍待采集，详见
  [`miniprogram-patient-selection-session-generation-2026-08-19.md`](release/miniprogram-patient-selection-session-generation-2026-08-19.md)。

- 2026-08-19 10:44 CST（意外重启后的线上只读复核）：SSH 再次确认新服务仍为 `active`，Bun API 继续监听
  `10.0.0.3:18081`，旧 Python/Gunicorn 继续监听 `0.0.0.0:8001`；live/ready 均成功，ready 的
  `database/redis/schema` 全部为 `ok`。本次没有执行服务重启、配置写入、数据库写入或 Redis 清理；真机连接和业务验收状态不因此升级。
  详见 [`current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md`](release/current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md)。

- 2026-08-19 10:36 CST（线上双服务与 P0 日志只读复核）：SSH 确认 `current=b7c9451`、新 API `18081`、旧 Python
  `8001` 同时监听，`hospital-platform-api-v2.service` 为 `active/running`，live/ready 均成功且
  `database/redis/schema=ok`。生产日志出现会话恢复、微信登录、患者读取和同步成功链；开发者工具新 `miniprogram`
  窗口仍没有手机连接，因此只记录生产运行层与模拟器触发的 P0 观察，不增加真机、多患者切换、预约、费用或资料验收结论。
  详见 [`current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md`](release/current-b7c9451-runtime-and-p0-observation-2026-08-19-1036.md)。

- 2026-08-19 10:31 CST（重启后真机入口复核）：重新激活标题为 `miniprogram` 的新项目窗口，资源树仍指向
  `dist/`，模拟器首页正常，二维码仍为 iOS 真机调试包，约 `639 KB`，有效至 `10:49`。窗口没有出现手机连接，
  因此本次只证明候选入口和资源上下文一致，不增加微信登录、患者目录、患者切换、预约、门诊费用或普通资料的真机证据。
  旧 `mp-weixin` 窗口继续排除；下一步必须由用户扫描新 `miniprogram` 窗口中的二维码。

- 2026-08-19（小程序普通资料响应二次 canonical 校验）：客户端此前只检查资料字段的粗略类型，未拒绝首尾空白、控制字符和非法邮箱，且把代理返回的未知字段原样交给页面。现已与服务端 domain 对齐展示文本、邮箱、年龄和版本边界，并重新投影 `displayName/gender/age/email/version` 白名单；异常整包返回既有 `provider-response-invalid`，不会进入资料编辑态。新增小程序回归与中文注释，未执行真实 PUT、未修改旧 Python、线上服务、数据库或 Redis。

- 2026-08-19（当前小程序验收候选更新）：报告目录旧患者事件阻断和就诊人选择会话代际边界已进入当前运行输入提交
  `b55df37`，`dist/build-info.json.sourceRevision` 为 `b55df37b48bbe250e4ebefee3db7739d2fd554e2`；本地全量门禁已通过。
  候选尚未上传微信开发者工具或部署线上，真机和服务端日志证据仍待重新采集；旧 `69e6cdb`、`b2ce91e` 运行包只保留作历史追溯。

- 2026-08-19 10:24 CST（真机入口恢复）：新 `miniprogram` 开发者工具窗口已确认资源树为 `dist/`，重新生成 iOS 真机调试二维码，
  代码包约 `639 KB`，标注有效至 `10:49`；当前尚未看到手机连接，因此只记录二维码准备完成，不把它写成微信登录或只读业务验收。

- 2026-08-19（支付预支付服务层输入边界）：`WechatPrepayService.create/read` 新增运行时 owner、订单、幂等键和链路上下文校验，
  即使内部调用绕过 Elysia schema 传入 `null` 或数组，也会在订单仓储、微信 Provider 和支付状态机之前复用既有
  `400 payment-order-invalid`。本次没有打开支付、医保或结算 gate，也未修改旧 Python、线上服务、数据库和 Redis。

- 2026-08-19（报告目录服务层查询边界）：`ReportService.list` 新增运行时 query 形状收敛，即使组合根或回放任务绕过 Elysia
  schema 传入 `null`、数组、缺少日期或非字符串 `kind`，也会在 owner 映射和 Provider 调用前返回既有 `report-query-invalid`，并
  保留 `report.directory.failed` 低敏日志。新增服务层回归，未打开报告 Provider、详情、附件或修改旧 Python、线上服务、数据库和 Redis。

- 2026-08-19（微信登录服务层输入边界）：`AuthService.login` 新增运行时 payload 校验，即使组合根或回放任务绕过 Elysia schema
  传入 `null`、数组或非字符串/越界 `code`，也会在 Provider 调用前返回既有 `400 validation`，并保留统一失败日志；新增认证服务和
  错误处理回归。没有改变微信 code2session、会话、Redis、域名或 Provider contract，也未修改旧 Python、线上服务、数据库或 Redis。

- 2026-08-19（患者空快照当前读模型边界）：Provider 返回空患者目录时，服务端现在先用既有 owner-scoped 读模型校验重新投影
  仓储结果，再决定是否允许空快照继续；非数组、错 owner、重复 ID 或其它畸形结果会在快照事务前以固定
  `readModelViolation` 失败，不会被当成“没有就诊人”而批量停用目录。新增回归和发布文档，未扩展 Provider、患者绑定、预约、
  报告、门诊费用、支付或医保能力，也未修改旧 Python、线上服务、数据库或 Redis。

- 2026-08-19（患者目录平台 ID 事务边界）：患者同步为每条 Provider 患者生成平台内部 `patientId` 时，新增 bounded opaque
  形状和同批唯一性校验，并在 `replaceDirectorySnapshot` 事务前拒绝非法/重复 ID。错误单独区别于 Provider 响应异常，日志只记录
  `generatedIdViolation`，公共响应固定为 `500 persistence-invalid`；新增服务与错误契约回归和发布文档。该改动没有扩展患者绑定、
  预约、报告、门诊费用、支付或医保能力，也没有修改旧 Python、线上服务、数据库或 Redis。

- 2026-08-19 09:21 CST（迁移菜单只读比对）：只读核对旧端 `hospital-app/src/jsonData/userNavData.json` 与
  新原生小程序 `my.ts` 的菜单分组、入口顺序、中文标题和图标资源。旧端三个分组的标题本身均为“我的订单”，
  因此新端保持相同标题并不是迁移遗漏；本轮没有凭直觉改成新的分类，也没有修改旧项目。已迁移入口继续走新 API
  或静态页面，缺少独立 contract 的问诊、医生、电子导诊单、智能客服和医保入口继续只提示迁移状态。

- 2026-08-19 09:20 CST（重启后全仓门禁）：重新执行 `pnpm check`，架构审计 66 条、迁移台账、Provider 文档接收、
  Markdown 链接、发布基线、Biome、工具测试、9/9 类型检查、9/9 测试和 9/9 构建全部通过；API 为 `153/153`，
  原生小程序构建生成 14 个页面脚本，运行包来源随后更新为 `69e6cdb`。全局 `git diff --check` 的唯一既有告警来自用户正在修改的
  `apps/miniprogram/project.config.json`，本轮未触碰、未暂存、未提交该文件。

- 2026-08-19 09:24 CST（门诊费用查询前置状态门禁）：小程序 `loadOutpatientPaymentRecords` 新增运行时状态校验，
  即使旧页面或异常事件绕过 TypeScript 联合类型传入未知值，也会在网络请求前返回稳定的
  `outpatient-payment-query-invalid`，不会把未知状态交给 API/Provider 或让“非 unpaid 即 paid”的历史分支解释它。
  新增小程序回归后，支付调起、医保授权、结算回写和费用详情仍保持关闭；旧 Python、线上服务、数据库和 Redis 未修改。

- 2026-08-19（预约记录窗口前置语义门禁）：小程序 `createAppointmentRecordQuery` 新增运行时窗口校验，
  未知值不再静默降级为 `history`，而是在生成日期窗口和发起网络请求前返回稳定的
  `appointment-record-query-invalid`。这样“我的挂号”和“爽约记录”不会因异常页面参数查询出错误业务数据；
  新增中文注释和回归测试，未扩大预约 Provider 查询、未开放预约写入、支付或医保，也未修改旧 Python、线上服务、
  数据库和 Redis。

- 2026-08-19（预约服务运行时查询形状门禁）：服务端 `AppointmentService` 不再只依赖 Elysia HTTP schema 和
  TypeScript 查询类型；组合根、回放任务或未来 Worker 直接传入 `null`、数组或非字符串日期时，会在 Provider/患者映射
  之前收敛为稳定的预约查询错误，并继续写入低敏 `appointment.*.failed` 事件。新增回归验证 Provider 调用次数为 0，
  未扩大预约只读范围、未开放锁号/写入/支付/医保，也未修改旧 Python、线上服务、数据库和 Redis。

- 2026-08-19（普通资料服务运行时输入门禁）：`UserProfileService.update` 现在拒绝绕过 HTTP schema 的 `null`、数组、
  非字符串昵称或非字符串邮箱，避免在字段归一化/解构处产生未映射 `TypeError/500`。异常统一保持
  `user-profile-invalid` 和低敏 `user.profile.update_failed` 日志，仓储写入次数为 0；未扩大普通资料字段，未触碰实名、头像、
  手机号或微信身份，也未修改旧 Python、线上服务、数据库和 Redis。

- 2026-08-19（普通资料清空语义回归）：API 组合测试补充 `age=null`、`email=null` 的明确清空路径，验证服务端不会把
  `null` 当成省略字段，且仍按 owner/version 条件递增并返回 canonical 资料快照；原有 409、跨用户隔离和未知字段拒绝保持不变。
  API 全量回归仍为 `153/153`。这是本地 HTTP/内存仓储证据，不替代真实微信资料 PUT、409 和真机验收。

- 2026-08-19 09:13 CST：公网只读复核 `health/live`、`health/ready`、`system/ping` 均为 `200`，ready 的
  `database/redis/schema` 均为 `ok`，未登录 `/me` 为预期 `401/unauthorized`；本轮无 Bearer、患者参数、Provider
  请求或业务写入。当前环境尝试无密钥批处理 SSH 被 `publickey,password` 拒绝，因此没有新增服务器 release、systemd、
  `18081/8001` 共存或 journald 结论，继续以顶部最近一次成功 SSH 复核为准；本轮只推进公网运行层证据，不增加真机或业务域验收。

- 2026-08-19（本地多就诊人组合回归）：新增 API 端到端测试，验证同一账号明确选择第二位就诊人后，
  `/appointments/records` 与 `/payments/outpatient/records` 都通过 owner-scoped `patientId` 解析到第二位的
  `his-patient` 引用；患者目录仍只返回安全读模型，未把 provider 的 directory 患者号或临床引用下发到小程序。
  API 全量回归为 `153/153`，类型检查和 `git diff --check` 通过。该证据是本地 API/Provider 夹具回归，不替代真实微信
  真机扫码、第二位患者切换或众阳/HIS 线上验收。

- 2026-08-19 09:05 CST：通过 SSH 只读复核当前 `b7c9451`，`hospital-platform-api-v2.service=active`，内网
  `/health/ready` 返回 `database/redis/schema=ok`。最近 20 分钟 journald 经当前 release 的聚合工具得到
  `parsedRecords=38`、`parseErrors=0`、`systemdWarningCount=0`、HTTP `200=14`；业务事件仍只有患者目录读取/同步，
  没有新的微信登录、预约历史、爽约、门诊费用、普通资料、报告、支付、医保或真机设备事件。本次只读检查没有重启、
  切换、迁移、业务写入或旧服务操作，后续真机验收应从该窗口之后重新建立关联链。

- 2026-08-19 08:58 CST：重启后通过 SSH 只读聚合当前 `b7c9451` 最近 10 分钟 journald，得到 `parsedRecords=13`、
  `parseErrors=0`、`systemdWarningCount=0`、HTTP `200=5`；业务事件只有患者目录读取/同步，未出现新的微信登录、
  预约历史、爽约、门诊费用、普通资料、报告、支付或医保事件。该窗口没有真机设备连接或第二位就诊人数据，
  不能把患者同步日志升级为真机、多患者或其它业务验收；本次仍只读取日志，没有重启、切换、迁移、业务写入或旧服务操作。

- 2026-08-19（重启后本地门禁复核）：API `152/152`、原生小程序 `157/157`、domain `40/40`、persistence
  `76/76` 全部通过；架构 `66` 条、迁移台账、Provider 接收、文档链接、发布基线和工具测试全部通过，Biome
  format/lint、9 个 workspace typecheck 与 9 个 workspace build 也全部通过。小程序运行包验证确认 revision 为
  上一候选 `b2ce91e`、来源指纹为 `b2ce91e1892a5cddec6953e3812d6f0ec08af8a6`、14 个页面齐全。本次没有新增生产代码，
  没有部署或重启服务，也没有修改旧 Python、数据库、Redis；用户已有的 `apps/miniprogram/project.config.json`
  仍保持未触碰、未暂存、未提交。

- 2026-08-19 08:47 CST：通过 SSH 对当前线上环境做只读准入复核：`current=/home/ps/code/hospital-platform/releases/b7c9451`，
  `hospital-platform-api-v2.service=active`；服务进程环境中的 `ZHONGYANG_REPORT_DIRECTORY_READY=false` 和
  `ZHONGYANG_REPORT_DETAIL_READY=false` 均为显式关闭。因此报告目录/详情返回 `503 dependency-not-configured` 是预期
  fail-closed，不应重试到 Provider 或只为得到页面数据而打开 gate；门诊病历 `/api/v2/medical-records` 仍保持未注册/404，
  因为 `out-visit-records` 尚无正式请求/响应、字段脱敏和权限 contract。本次没有修改代码、旧服务、数据库或 Redis；下一步等待
  Provider/HIS 文档和脱敏样例，再按 contract → adapter → API → 小程序顺序推进。

- 2026-08-19 08:41 CST：在当前 `b7c9451` 服务和 `b2ce91e` 运行包上完成一轮模拟器只读业务链路，页面、HTTP 和低敏
  journald 日志已按同一时间窗口核对：预约历史 `GET /api/v1/appointments/records` 返回 `200`，Provider 返回 `60` 条且
  `cancelled=60`，页面按契约排除后显示空状态；爽约页使用过去 90 天窗口并同样只得到取消记录，没有把取消状态推断为爽约；
  门诊缴费的 `unpaid` 和 `paid` 两个状态请求均返回 `200`、`itemCount=0`。普通资料读取、患者目录读取/同步也均为成功，
  `parseErrors=0`、`systemdWarningCount=0`，没有支付、医保、退费或业务写入。该轮是“开发者工具模拟器 + 公网请求 + 新服务日志”
  证据，不替代真实微信设备；详细记录见 [`miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19 08:36 CST：继续在新 `miniprogram` 开发者工具窗口核对当前候选。资源树仍明确包含 `dist/`，
  模拟器首页正常，`dist/build-info.json` 的运行包来源仍为 `b2ce91e1892a5cddec6953e3812d6f0ec08af8a6`；
  普通编译完成后，问题面板为 0 个问题，代码包约 `638 KB`，iOS 二维码有效期更新至 `09:00`，窗口仍没有
  新手机连接。本次点击“真机调试”会把候选代码包上传到微信开发者工具的调试服务以生成二维码，这是开发者工具
  的调试前置动作，不是线上版本发布或生产上传；没有修改服务器、旧 Python 服务、数据库或 Redis，也没有产生业务请求。
  因此本条只推进新候选的可扫码入口，不增加微信登录、患者切换、预约历史、门诊费用或其它真机验收结论。

- 2026-08-19 08:28 CST：用户重启后再次通过 SSH 做只读复核，当前 release 仍为 `b7c9451`，新 Bun API
  `10.0.0.3:18081` 与旧 Gunicorn `0.0.0.0:8001` 同时监听；内网健康路径必须使用 `/health/live`、`/health/ready`，
  公网反向代理路径才使用 `/api/v2/health/live`、`/api/v2/health/ready`，ready 的 `database/redis/schema` 均为 `ok`。
  `08:00–08:30` 低敏日志聚合为微信登录 `1/1`、患者目录读取 `8/8`、患者同步 `4/4`，`parseErrors=0`、
  `systemdWarningCount=0`；预约历史和门诊缴费均无请求，不能把本窗口写成预约/费用或真机验收完成。该复核没有切换、
  migration、业务写入或旧服务操作。

- 2026-08-19：对预约历史、门诊费用只读、报告目录/详情和“我的”页面做了第二轮静态业务审计。日期/金额/状态窗口、
  owner-scoped 患者映射、短期报告引用、客户端患者代际和异步回写边界均已有代码与回归测试；没有发现可以安全补写的
  明确逻辑缺口，因此没有为了“继续迁移”猜测 Provider 字段、开放详情/支付或修改旧服务。当前本地回归为 API `152/152`、
  原生小程序 `157/157`，domain/adapters `123/123`，下一步仍是使用 `b2ce91e` 小程序候选取得预约、爽约、门诊费用和
  普通资料的页面 + HTTP + 低敏日志三层证据。

- 2026-08-19 07:20 CST：公网只读复核 `health/live`、`health/ready`、`system/ping` 均为 `200`，ready 的
  `database/redis/schema` 均为 `ok`，未登录 `/me` 为预期 `401/unauthorized`；live/ready 的 `Cache-Control: no-store`
  和低敏 `x-request-id` 均存在。本轮没有 Bearer、openid、患者参数、Provider 请求或业务写入，只更新公网运行层证据，
  不增加真机、患者切换、费用、支付或医保结论，详见 [`current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md)。

- 2026-08-19（上一候选记录）：本轮客户端候选已重新构建为 `b2ce91e`，运行包 `sourceRevision` 为
  `b2ce91e1892a5cddec6953e3812d6f0ec08af8a6`；尚未上传线上。该候选包含登录后患者初始化门禁和
  会话失效后显式就诊人选择保留，真机验收必须使用该来源，不得继续使用上一候选运行包。

- 2026-08-19 08:15 CST：通过 SSH 对当前 `b7c9451` 做只读 P0 日志复核。新 API `18081` 与旧 Python `8001` 仍同时监听，
  `p0-log-aggregate` 解析 `84` 条有效记录、`parseErrors=0`、`systemdWarningCount=0`；患者目录读取 `14/14`、同步 `7/7`
  在同一关联链并完成 HTTP `200`。窗口没有新的微信登录、预约历史、门诊费用、报告或普通资料事件，且当前同步观察只有
  `1` 位 active 患者；该证据不增加真机、第二患者显式切换或其它业务域验收，详见
  [`current-b7c9451-p0-business-observation-2026-08-19-0815.md`](release/current-b7c9451-p0-business-observation-2026-08-19-0815.md)。

- 2026-08-19 08:21 CST：最新 10 分钟窗口出现新的微信登录 `1/1`、患者目录读取 `2/2`、患者同步 `1/1`，三域均通过当前
  `b7c9451` 的同链 HTTP `2xx` 门禁；另有一条预期 `401/unauthorized` 被单独保留。预约历史、门诊费用、报告和普通资料仍为 `0/0`，
  因此该窗口只推进服务端登录/患者上下文证据，不等同真机页面或多患者切换验收。下一步继续点击“我的挂号”并采集页面、HTTP、日志三层证据，
  详见 [`current-b7c9451-p0-business-observation-2026-08-19-0821.md`](release/current-b7c9451-p0-business-observation-2026-08-19-0821.md)。

- 2026-08-19 07:45 CST：只读核对新 `miniprogram` 开发者工具窗口，资源树包含 `dist/`，模拟器仍可渲染首页，
  真机调试弹窗显示代码包约 608 KB，但二维码失效时间为 03:27，当前已过期，窗口也没有出现新手机连接。
  本轮没有点击旧 `mp-weixin`、没有扫码、没有上传或发起业务请求；该结果只说明新候选窗口可识别，不能增加微信登录、
  患者切换、预约、费用或其它真机业务证据，详见 [`miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-19 07:49 CST：在同一新 `miniprogram` 窗口执行普通编译并重新打开“真机调试”。构建日志显示 `app.json`、`ext.json`
  和 14 个页面文件编译完成，问题面板为 0 个问题，调试器为 0 个错误和 3 条微信基础库提示；新二维码代码包约 637 KB，
  有效期更新至 08:14，窗口仍没有新手机连接。本轮没有扫码、上传或发起业务请求，只恢复了可扫码候选入口，不增加微信真机登录、
  患者切换、预约、费用或其它真机业务证据，详见 [`miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-19 07:55 CST：收紧预约两列级联的排班请求前边界。小程序服务层现在与回包校验共用 `departmentId` 的安全形状规则，
  空白、控制字符和超长值在网络请求前返回 `appointment-query-invalid`，不再先制造无意义的 Provider 请求；新增回归后小程序
  定向测试为 `157/157`、`1251` 个断言，类型检查和 Biome 检查通过。该修正只保护输入和日志边界，不开放锁号、预约写入、取消、
  支付、医保或 HIS，也未修改 Provider、线上服务或旧 Python。

- 2026-08-19：修正首页登录后的患者初始化状态机。此前患者同步失败会在页面内部吞掉异常，
  登录链仍可能继续调用患者范围页面的 `afterSuccess`；同步请求发出前旧患者卡片也可能短暂保留。
  现已使用 `skipped/succeeded/failed/superseded` 显式结果：报告目录、我的挂号和门诊费用
  必须等本轮同步成功且存在已确认患者，失败或被淘汰的同步不会重放后续动作；同步开始时只清理
  页面展示态，不删除本地显式选择。已通过小程序类型检查和 `156/156` 定向测试、`1248` 个断言。
  该修正不改变 API、数据库、Redis、Provider、线上服务或旧 Python，详见
  [`miniprogram-login-patient-bootstrap-boundary-2026-08-19.md`](release/miniprogram-login-patient-bootstrap-boundary-2026-08-19.md)。

- 2026-08-19：修正会话失效后的就诊人选择生命周期。首页此前在无 token 的 `onShow()`
  中删除本地显式患者 ID，重新登录后可能把同一账号的当前患者静默换成目录第一位；现已只清理
  页面展示态，保留 opaque ID，由 owner-scoped 目录解析为原患者或 `stale`，跨账号不会获得访问授权。
  小程序回归为 `156/156`、`1248` 个断言通过；未修改 API、数据库、Redis、Provider、线上服务或旧 Python，
  详见 [`miniprogram-session-explicit-patient-retention-2026-08-19.md`](release/miniprogram-session-explicit-patient-retention-2026-08-19.md)。

- 2026-08-19：完成“我的挂号”双标签契约审计。当前服务端只使用已冻结的在线渠道
  `requestChannel=3`；“在线挂号”仅排除明确的 `cancelled`，而“全部挂号”需要独立的
  `requestChannel=4` Provider 合同，不能把在线结果本地复制或通过空列表伪装完成。页面继续
  保留原版双标签视觉位置，未开放标签只提示迁移中且不发起请求。该结论已固化到
  [`appointment-record-tab-contract-audit-2026-08-19.md`](release/appointment-record-tab-contract-audit-2026-08-19.md)，
  不改变 API、数据库、Redis、线上 release 或旧 Python 服务。

- 2026-08-19 06:42 CST：再次从公网只读复核 `health/live`、`health/ready`、`system/ping` 均为 `200`，ready 的
  `database/redis/schema` 均为 `ok`，未登录 `/me` 返回预期 `401/unauthorized`。本次没有携带 Bearer、openid、患者参数，
  没有写入或 Provider 请求；这只确认公网运行层和未登录认证边界，不增加真机、Provider、患者切换、费用、支付或医保结论，
  详见 [`current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md)。

- 2026-08-19 06:54 CST：重启后通过 SSH 仅读确认 `current=b7c9451`、`hospital-platform-api-v2.service=active`、
  新 API `10.0.0.3:18081` 和旧 Gunicorn `0.0.0.0:8001` 仍同时监听；公网 `live/ready/system-ping` 继续为 `200`，
  ready 依赖均为 `ok`。日志采样仅命中未登录 `/me` 的预期 `401/unauthorized`，未见 dependency unavailable、解析错误或
  systemd warning。本次没有切换、重启服务、迁移或业务写入；运行层稳定不等于微信真机、患者切换、Provider、支付或医保验收。
  详见 [`current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md)。

- 2026-08-19 07:01 CST：重启后重新执行本地 `pnpm check` 和小程序 `runtime:verify`，架构 66 条、迁移台账、Provider
  文档、195 份 Markdown 链接、发布基线、Biome、19 项工具测试、9/9 类型检查、9/9 测试和 9/9 构建全部通过；运行包
  来源仍为当时服务端配套候选 `5348715`（完整指纹
  `534871549517080807c7e5c1375247477f422750`），14 个页面脚本和根文件齐全。本轮只修正了重启复核文档中的旧证据，
  没有修改 `apps/miniprogram/project.config.json`、旧 Python、线上服务、数据库或 Redis；这些门禁不增加真机、Provider、
  患者切换、费用、支付或医保验收结论。

- 2026-08-19 07:07 CST：再次从公网只读请求 `health/live`、`health/ready`、`system/ping` 和未登录 `/me`，结果为
  `200/200/200/401 unauthorized`，ready 的 `database/redis/schema` 均为 `ok`；本轮没有 Bearer、openid、患者参数、Provider
  请求或业务写入。该结果只补充公网运行层和认证门禁，不增加 SSH 双服务共存、微信真机、患者切换、Provider、费用、支付或医保结论，
  详见 [`current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md)。

- 2026-08-19：修正“我的”页普通资料与患者目录并行读取的会话代际风险。资料 GET 先完成或安全降级，患者目录再从最新会话代际读取，避免旧患者目录与新资料混合；资料失败且没有可用会话时会停止后续患者读取，并在新加载周期清空旧患者卡片和数量，防止失效会话继续展示旧数据。提交 `3a66d12`，小程序定向测试 154/154、1235 个断言和类型检查通过；未改变 API、数据库、Redis、Provider、线上服务或旧 Python，详见 [`miniprogram-my-page-session-generation-order-2026-08-19.md`](release/miniprogram-my-page-session-generation-order-2026-08-19.md)。

- 2026-08-19：患者、预约和门诊费用列表读取统一先验证 `success/data` 平台成功包络，再进入业务 canonical validator；预约记录与门诊费用只重投影页面白名单字段，门诊费用额外拒绝重复 `recordId`、无效账单日历值、负数/非安全整数金额。坏包络或坏记录整批 fail-closed，不伪装为空列表。提交 `31ce94a`，小程序定向测试 154/154、1231 个断言和类型检查通过；未改变 Provider、数据库、Redis、线上服务或旧 Python，详见 [`miniprogram-list-response-envelope-contract-2026-08-19.md`](release/miniprogram-list-response-envelope-contract-2026-08-19.md)。

- 2026-08-19：收紧小程序微信登录与 `/me` 会话恢复的客户端响应边界。登录成功 JSON 不再只依赖 truthy token，
  必须完整校验 success、Bearer、过期时间、token 和内部 user id；`/me` 也必须返回安全的 owner 引用，未知字段会被
  白名单重投影。协议异常统一 fail-closed 为 `provider-response-invalid`，401 的重新登录/命令禁止重放边界保持不变。
  代码提交 `c727e1c`，小程序定向测试 152/152、1215 个断言和类型检查通过。该修正不代表真实微信真机、Provider、
  MySQL/Redis 或线上小程序验收，详见 [`miniprogram-auth-session-response-contract-2026-08-19.md`](release/miniprogram-auth-session-response-contract-2026-08-19.md)。

- 2026-08-19：报告目录与 LIS 详情补齐小程序 API client 的 canonical 运行时响应校验。目录拒绝未知来源/状态、异常展示字段、
  非 LIS 详情引用、重复 `reportId` 和错误总数；详情必须匹配请求的 opaque `reportId`，并逐项校验检测结果与标记枚举。
  损坏响应统一收敛为 `provider-response-invalid`，不把临床坏数据降级成空列表或空检测项。报告 Provider gate、影像/心电详情和附件
  仍关闭，详见 [`miniprogram-report-readonly-response-contract-2026-08-19.md`](release/miniprogram-report-readonly-response-contract-2026-08-19.md)。

- 2026-08-19：预约目录客户端补齐科室/排班 JSON 的 canonical 运行时校验。科室必须保持唯一安全的
  `departmentId` 和公开展示字段；排班必须保持唯一 opaque `scheduleId`、真实工作日、有限时间分组、合法号源数量，
  且 `departmentId` 必须匹配本次左栏选择。异常响应整批收敛为 `provider-response-invalid`，不把其他科室号源、
  Provider 扩展字段或损坏记录交给两列级联页面。该修正不开放锁号、预约写入、取消、支付或医保，详见
  [`miniprogram-appointment-directory-readonly-contract-2026-08-19.md`](release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md)。

- 2026-08-19：患者目录读取和同步现在共用原生小程序的 canonical 响应运行时校验。除 `total === items.length` 外，客户端会拒绝重复/非法 opaque `patientId`、未知关系或来源、未知临床访问状态、首尾空白展示文本和未脱敏卡号，并重新投影白名单字段；异常整批收敛为 `provider-response-invalid`，不伪装成空目录或触发默认换人。该修正不改变服务端 owner/HIS 映射、不开放新增绑定，详见 [`miniprogram-patient-read-model-contract-2026-08-19.md`](release/miniprogram-patient-read-model-contract-2026-08-19.md)。

- 2026-08-19：继续收紧“我的挂号”只读边界。小程序不再只依赖 `total`，会在渲染前拒绝未知预约状态、异常
  日期形状、越界展示字段和损坏列表，坏记录整批 fail-closed；这不开放全部挂号、详情、取消、预约写入或支付。
  详见 [`miniprogram-appointment-record-readonly-contract-2026-08-19.md`](release/miniprogram-appointment-record-readonly-contract-2026-08-19.md)。

- 2026-08-19：门诊缴费只读客户端补齐查询状态边界。小程序读取费用时不再只检查 `total`，还会拒绝响应包络
  状态与当前标签不一致、单条记录状态串台、非法金额、空记录标识或异常展示字段；异常响应不会降级为空列表。
  该修正未打开微信支付、医保授权、退费或结算回写，详见
  [`miniprogram-outpatient-payment-readonly-contract-2026-08-19.md`](release/miniprogram-outpatient-payment-readonly-contract-2026-08-19.md)。

- 2026-08-19：普通资料读写边界继续收紧。小程序 API 客户端原先只凭 TypeScript 泛型接收 `/me/profile` 成功
  JSON，现已增加完整 canonical 快照的运行时校验，拒绝缺失 `data`、非法性别、越界年龄、异常版本或邮箱类型，
  不把协议错配降级成默认资料，也不自动重放 PUT。该修正只影响新小程序及中文说明，详见
  [`miniprogram-profile-response-contract-2026-08-19.md`](release/miniprogram-profile-response-contract-2026-08-19.md)；
  未执行真实资料 PUT/409，旧 Python、线上 API、数据库、Redis 和线上小程序均未修改。

- 2026-08-19：继续审计门诊/住院病历目录时，旧端仍只能提供历史调用线索，当前没有新增 `out-visit-records` 正式
  Provider contract、患者映射确认、四类脱敏响应样例或字段授权清单。已将本轮结论记录到
  [`medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md)：停止在契约
  准入，不新增 schema、adapter、service、页面或兼容转发；门诊目录、住院病历、诊断和附件继续保持独立未开放，
  `GET /api/v2/medical-records` 保持未注册/404。只有 Provider 补齐 MR-01 至 MR-06、MR-13 至 MR-15 和最小交付包，
  并通过脱敏样例、字段白名单、错误语义、分页及时区测试后，才进入实现评估；旧 Python、线上新 API、数据库、
  Redis 和线上小程序均未修改。

- 2026-08-19：继续审计患者目录同步的并发语义时发现，内存测试仓储在无 I/O 的快照路径中存在不必要的异步让出点，旧租约可能在资料已修改后被新代次接管。提交 `3c1b497` 已将该路径收紧为单事件循环 turn 的快照提交，并补充旧租约不得留下部分患者资料的回归测试；生产 MySQL 的事务和条件更新未修改，旧 Python、线上 API、数据库、Redis 和线上小程序均未修改或重启。

- 2026-08-19：继续观察当前候选的真机入口，开发者工具已成功编译约 `608 KB` 代码包并生成 iOS 二维码，但窗口仍处于等待扫码状态，没有手机连接、真机日志或真机 HTTP trace。该证据只证明“真机调试入口可生成”，不推进微信登录、患者切换、预约、费用、支付或医保验收；二维码未保存或外传，详细记录见 [`release/miniprogram-current-candidate-simulator-observation-2026-08-19.md`](release/miniprogram-current-candidate-simulator-observation-2026-08-19.md)。

- 2026-08-19：小程序患者端列表读取与同步统一增加 `total === items.length` 运行时契约门禁，覆盖患者目录读取/同步、预约科室/排班/历史、报告目录和门诊费用；协议错配返回 `provider-response-invalid`，不伪装成空列表、成功同步快照或错误的本地“加载更多”。提交 `59d76cf`，小程序定向测试 136/136、1114 个断言；旧 Python、线上新 API、数据库和 Redis 均未修改，详见 [`release/miniprogram-list-total-contract-2026-08-19.md`](release/miniprogram-list-total-contract-2026-08-19.md)。
- 2026-08-19：继续收紧首页二维码入口的患者上下文门禁。二维码协议尚未冻结时，只有本轮已确认的 `selectedPatient` 才能展示“二维码暂未开放”；本地缓存 opaque ID 不再被当作当前患者事实，失效/未确认状态统一显示“请先登录并选择就诊人”。提交 `7a5b937`，小程序定向测试 137/137、1118 个断言；未生成或发送任何二维码内容，旧 Python、线上新 API、数据库和 Redis 均未修改。

- 2026-08-19：资料保存成功后统一采用服务端 canonical 快照，完整回写昵称、性别、年龄、邮箱和版本，避免页面把本地请求值误当作最终事实。提交 `6f08eb9`，资料相关验收通过；未执行真实资料 PUT，旧 Python、线上新 API、数据库和 Redis 均未修改。

- 2026-08-19：患者范围查询在小程序服务层与服务端 opaque contract 对齐，拒绝空白、控制字符和超长 `patientId`，避免损坏的本地选择先制造无意义网络请求。提交 `6a2ed92`，患者标识边界测试通过；未修改 Provider、数据库、Redis、旧 Python 或线上服务。

- 2026-08-19 02:04 CST：重启后从公网只读复核确认 `/api/v2/health/live`、`/api/v2/health/ready` 和 `/api/v2/system/ping` 均为 `200`，ready 的 `database/redis/schema` 均为 `ok`，未登录 `/api/v2/me` 为预期 `401`。本轮没有微信会话、Provider 参数或业务写入；SSH 入口当前只接受 `publickey`，本地没有对应私钥，因此没有新增 systemd、`18081/8001` 共存或 Worker 结论。完整边界见 [`release/current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md)。

- 2026-08-19：继续做请求层会话安全审计时发现，所有受保护请求统一自动重放 `401` 可能把资料 PUT、患者同步 POST 或支付预支付意图带到新账号。提交 `5fdc740` 已收紧为“仅幂等 GET 自动恢复并重试一次；命令请求不自动重放”，并让患者选择页、普通资料页在 owner 失效后清理派生数据并回首页重新登录。小程序定向测试 134/134，全量 `pnpm check` 的 66 条架构、迁移/Provider/文档、19 项工具测试、9/9 类型检查、9/9 测试和 9/9 构建均通过；本地运行包来源为 `5fdc740e3450c8773a81d1d13c8c55d5288d9259`。该修正没有修改 API、数据库、Redis、线上 release 或旧 Python 服务，未把本地候选写成线上小程序版本，详见 [`release/miniprogram-command-session-replay-boundary-2026-08-19.md`](release/miniprogram-command-session-replay-boundary-2026-08-19.md)。

- 2026-08-19：为发布基线审计增加“当前执行项/历史补充”边界校验。路线图的当前执行段现在必须同时写明服务端 release、小程序提交和完整 `sourceRevision`；历史 release 只能位于明确的追溯段，不能被新会话误当成真机验收版本。新增 2 项工具回归测试，未改变 API、数据库、Redis、线上 release 或旧 Python 服务。

- 2026-08-19：继续做跨页面会话派生展示审计时发现，选择就诊人页在同步失败时虽然清除了“当前”角标，但会保留旧患者姓名、关系和脱敏电子就诊卡。现已区分暂时依赖故障与 `unauthorized`/`session-changed`/无 token：后者清理整个 owner-scoped 患者目录，重新建立会话后必须重新读取目录并完成临床映射；本地 opaque 选择仍保留用于 stale 判断。该修正只影响新小程序、中文注释和 acceptance 门禁，不新增绑定接口、不执行业务写入、不修改 API、数据库、Redis、旧 Python 服务或线上小程序，详见 [`release/miniprogram-patient-select-session-display-boundary-2026-08-19.md`](release/miniprogram-patient-select-session-display-boundary-2026-08-19.md)。

- 2026-08-19：继续审计普通资料页时发现，资料读取/保存请求在会话失效、并发账号切换或自动重新登录失败后，页面原先可能只显示错误而保留上一账号的昵称、性别、年龄、邮箱和版本。现已新增会话归属判断：`unauthorized`、`session-changed` 或已无 token 时清理资料派生字段并回到 `loaded=false`；普通网络/持久化暂时故障和 `user-profile-conflict` 仍保持各自语义。该修正只影响新小程序、中文注释和 acceptance 门禁，不执行真实 PUT、不修改 API、数据库、Redis、旧 Python 服务或线上小程序，详见 [`release/miniprogram-profile-session-display-boundary-2026-08-19.md`](release/miniprogram-profile-session-display-boundary-2026-08-19.md)。

- 2026-08-19：继续复核开发者工具中的首页会话恢复时发现，服务端返回 `401/unauthorized` 时，客户端
  `requestWithSession` 会按设计清理旧 token 并最多重新执行一次微信 code 兑换；但首页原来的 `onShow` 在已有本地 token
  时会直接开始患者目录读取，认证完成前仍可能短暂保留上一位患者卡片。现已在 `onLoad` 和后续 `onShow` 发起认证/目录读取前
  统一清空患者派生展示，只保留本地 opaque 选择用于恢复后的 stale 判断；成功后才恢复“已恢复会话”，失败则按
  `invalid/unavailable` 收敛。新增原生 acceptance 门禁，避免出现“旧患者 + 新会话验证中”的不一致快照。该修正不改变服务端
  路由、数据库、Redis 或旧 Python 服务，也不把模拟器观察写成真机验收，详见
  [`release/miniprogram-session-display-boundary-2026-08-19.md`](release/miniprogram-session-display-boundary-2026-08-19.md)。当前本地小程序候选已更新为
  `d2086d819b3e393da2e8c5c39d7704012854214b`，尚未上传或替换线上小程序包。

- 2026-08-19 01:06–01:09 CST：使用当前候选 `d2086d8` 在新 `miniprogram` 开发者工具项目完成首页、独立就诊人选择/刷新、
  “我的”、普通资料只读和“我的挂号”只读观察；预约历史最终显示当前就诊人的空记录态，未执行 PUT、预约、绑定、支付或医保操作。
  工具 Console 出现的 `clickCheckTask`、`undefined is not iterable` 和 `webviewScriptError` 栈均落在微信开发者工具内部
  `appservice`，没有项目源码调用栈，暂不加入猜测性兼容代码，必须在新项目手机真机上复核。完整记录见
  [`release/miniprogram-current-candidate-simulator-observation-2026-08-19.md`](release/miniprogram-current-candidate-simulator-observation-2026-08-19.md)。

- 2026-08-19 01:40–01:41 CST：在同一 `d2086d8` 模拟器运行包中继续复核选择页刷新、我的挂号和门诊缴费状态切换；患者目录刷新后保持当前选择，挂号页显示院区/双标签/合法空态，费用页的待缴费和已缴费均保持各自空态及支付/医保关闭提示。当前会话只有一位可用就诊人，因此仍没有多患者显式切换证据；本轮没有绑定、资料 PUT、预约写入、支付或医保操作。详细观察见上述模拟器记录。

- 2026-08-19 01:45 CST：对当前公网入口执行只读运行与未登录边界复核：`/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 均为 200，ready 的 `database/redis/schema` 均为 `ok`；`/me`、`/patients`、`/me/profile`、预约历史和门诊费用均按预期返回 `401/unauthorized`。本轮未携带 Bearer、未访问患者正文、未调用 Provider、未产生任何写入；这只确认公网运行层和认证边界，不增加微信真机、多患者、Provider 或业务写入验收结论。详细记录见 [`release/miniprogram-current-candidate-simulator-observation-2026-08-19.md`](release/miniprogram-current-candidate-simulator-observation-2026-08-19.md)。

- 2026-08-19（上一轮 `d2086d8` 候选）：针对上一轮候选工作树执行完整 `pnpm check`，架构 66 条、迁移台账、Provider 文档、184 份文档链接、发布基线、Biome、工具测试 19 项、9 个 workspace 类型检查、9 个 workspace 测试和 9 个 workspace 构建全部通过；小程序重新生成 14 个注册页面脚本。这只是上一轮代码/文档/构建门禁证据，未新增真机、多患者、Provider、支付、医保或 HIS 业务结论；用户已有 `apps/miniprogram/project.config.json` 未触碰。

- 2026-08-19 01:51 CST：在同一 `d2086d8` 模拟器候选中继续验证报告目录和普通资料连续入口。报告页对 `503 dependency-not-configured` 保持 fail-closed，未伪造报告空列表；“我的”页和头像入口进入普通资料页后，昵称、性别、年龄、邮箱、资料边界提示和保存按钮均正常显示，本轮未执行 PUT。开发者工具 Console 中的 `clickCheckTask`、`undefined is not iterable` 和 `webviewScriptError` 仍只有微信基础库内部调用栈，不能作为项目业务错误或成功证据；真机、多患者、Provider 详情和资料写入仍待完成，详见 [`release/miniprogram-current-candidate-simulator-observation-2026-08-19.md`](release/miniprogram-current-candidate-simulator-observation-2026-08-19.md)。

- 2026-08-19 00:48–00:50 CST：候选 `b7c9451` 已从 `c26e696` 原子切换为线上 current，目标是部署带有
  `traceId/requestId` 同链摘要的 P0 日志工具。只重启了新 `hospital-platform-api-v2.service`；旧 Python `8001`
  未停止、未重启、未修改，Worker 仍 inactive，数据库/Redis/schema 没有写入。切换后新 API 生产启动字段、内外网
  live/ready/system-ping、未登录 `401`、`no-store` 和双端口共存均通过；P0 聚合 `parseErrors=0`、
  `systemdWarningCount=0`、`correlation.chainCount=10`、`truncated=false`。这只修正日志证据版本，不增加真实微信、
  多患者、Provider 或真机业务完成度，完整记录见 [`release/b7c9451-production-acceptance-2026-08-19.md`](release/b7c9451-production-acceptance-2026-08-19.md)。

## b7c9451 切换前的历史运行窗口（仅供追溯）

以下记录发生在 2026-08-19 00:48 CST 的 `b7c9451` 切换之前；其中的 `c26e696`、`687690e` 和旧小程序 sourceRevision
保留原始时间与证据含义，但不能覆盖本文顶部的当前服务端和小程序候选基线。

- 2026-08-19：针对小程序刷新可能携带旧 `apiPrefix` 导致 404 的边界，客户端已将公共前缀收紧为已注册的
  `/api/v1`、`/api/v2`，并按本地 HTTP/公网 HTTPS 使用不同安全回退；未知版本不会被正则表达式继续拼接。
  `d948d11` 实现、`93a3c72` 补充真实请求层回归，128 项小程序测试、1075 个断言、TypeScript、构建和 14 页面运行包校验通过。
  该修复只影响本地小程序，未修改服务端、旧 Python 服务、数据库、Redis 或线上配置；真实微信设备验收仍待完成，详见
  [`release/miniprogram-api-prefix-hardening-2026-08-19.md`](release/miniprogram-api-prefix-hardening-2026-08-19.md)。

- 2026-08-19：在最新运行包 `93a3c720dc137162ff469ec745359775b08f84ab` 的微信开发者工具模拟器中进入“我的挂号”，页面显示当前院区、在线/全部标签、空记录态和更换就诊人入口；当前线上 `c26e696` 最近 10 分钟的
  `appointmentRecords` 低敏门禁为请求 `1`、成功 `1`、失败 `0`，`parseErrors=0`、`systemdWarningCount=0`。
  该结果只证明模拟器触发了服务端预约历史读链，不能替代手机真机、Provider 数据和页面三层证据；本轮没有预约写入、支付、医保或旧服务操作，详见
  [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19：同一运行包的微信开发者工具模拟器从“我的”页进入爽约记录，页面显示当前就诊人、过去 90 天范围和空状态；当前线上 `c26e696` 针对该查询窗口的
  `appointmentRecords` 低敏门禁为请求 `1`、成功 `1`、失败 `0`，`parseErrors=0`、`systemdWarningCount=0`。
  爽约只由服务端归一化的 `missed` 状态派生，没有新增 Provider 接口或业务写入；真实 Provider 字段、患者切换和真机证据仍待完成，详见
  [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19：同一运行包的微信开发者工具模拟器随后进入门诊缴费页，展示待缴费/已缴费切换、合法空状态和支付/医保关闭提示；当前线上 `c26e696` 同一最近 10 分钟低敏门禁中，
  `outpatientPaymentRecords` 请求 `1`、成功 `1`、失败 `0`，`parseErrors=0`、`systemdWarningCount=0`。
  这只增加门诊费用查询的模拟器与服务端读链证据，不开放支付、医保授权、退费或结算回写，也不能替代真机、Provider 数据和页面三层验收；详见
  [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19：同一运行包的微信开发者工具模拟器进入报告目录后，页面展示 Provider 未配置提示和合法空状态；当前线上 `c26e696` 同一最近 10 分钟低敏门禁中，
  `reportDirectory` 请求 `1`、成功 `0`、失败 `1`，`parseErrors=0`、`systemdWarningCount=0`，公网响应为 `503 dependency-not-configured`。
  该结果确认报告路由的 fail-closed 边界，没有把未接入 Provider 伪装成成功空列表；报告真实 Provider、详情资源授权、真机和页面三层验收仍未完成，详见
  [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19 00:41 CST：继续在同一模拟器运行包复核首页患者卡片与独立就诊人选择页。首页先显示加载态，患者目录收敛后恢复当前就诊人和首 5 位+末 4 位脱敏卡号；点击“更换就诊人”进入 `patient-select`，同步完成后显示当前标记、关系“其他”和脱敏电子就诊卡。线上 `c26e696` 低敏关联审计为 `patientRead=9/9`、`patientSync=3/3`、失败均为 `0`，解析和 systemd 警告均为 `0`。该证据只覆盖模拟器与服务端读/同步链，不替代真机、多患者切换和新增绑定验收；本轮没有预约、报告、费用、支付或医保写入。

- 2026-08-19 00:42 CST：继续验收预约目录只读链路。模拟器从医院静态前置页进入两列科室/排班页面，真实 Provider 结果可展示；快速连续切换科室后最终右栏只对应最后一次选择，13 条排班按 12 条本地渲染批次保留加载边界。线上 `c26e696` 事件计数为科室 `1/1`、排班 `3/3`、短期快照持久化 `3`，`parseErrors=0`、`systemdWarningCount=0`。这只证明预约目录读取和短期观察快照，不开放锁号、预约写入、取消、支付或医保，也不替代真机验收；详见 [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19：同一运行包的微信开发者工具模拟器从“我的”页进入普通资料页，资料只读加载完成；当前线上 `c26e696` 同一最近 10 分钟低敏门禁中，
  `profileRead` 请求 `2`、成功 `2`、失败 `0`，`parseErrors=0`、`systemdWarningCount=0`。本轮没有点击保存或写入生产资料，普通资料首次更新、版本冲突 `409`、真机视觉和真实微信证据仍未完成，详见
  [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md)。

- 2026-08-19：对普通资料写入契约完成本地分层审计，API 49/268、持久化 42/152、小程序 128/1075 的定向与全套断言通过；全仓 `pnpm check` 通过，确认 owner、version、显式清空、非法字段、版本上限、409 和页面保存门禁保持一致。
  本地运行包 revision 为 `93a3c72`，没有部署服务端、写入生产资料或把本地测试当作真实首次 PUT/409/真机证据。

- 2026-08-19：继续工作前通过 SSH 只读复核确认 `hospital-platform-api-v2.service=active`、当前 release 为 `c26e696`，新 API `18081` 与旧 Python `8001` 同时监听，`18082` 无残留；公网 live/ready 均为 `200`，ready 的
  `database/redis/schema` 均为 `ok`。本轮没有重启、migration、Redis 清理、业务写入或旧服务操作。

- 2026-08-19：报告域再次做 Provider 接收审计：当前仅登记 3 份接收记录、26 个 `documentId`，`docs/provider-intake/` 没有报告目录专用的正式接收记录、脱敏响应样例或错误样例；
  `provider-contract-v1.md` 只能作为平台候选边界，不能代替真实报告联调合同。因此报告目录/详情继续保持 `dependency-not-configured` fail-closed，不修改报告代码或打开 gate，等待按
  [`release/report-readonly-contract-audit-2026-08-18.md`](release/report-readonly-contract-audit-2026-08-18.md) 的材料门禁推进。

- 2026-08-19：会话重启后通过 SSH 只读复核确认 `hospital-platform-api-v2.service=active`、当前 release 仍为 `c26e696`，
  新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听，临时端口 `18082` 无残留，公网 live/ready 均返回 `200` 且
  `database/redis/schema=ok`。本地 `pnpm check` 全部通过，小程序构建产出 14 个页面脚本；本次没有切换 release、migration、
  Redis 清理或业务写入，也没有增加 Provider、真机、支付或医保验收证据。详见
  [`release/restart-coexistence-readonly-audit-2026-08-19.md`](release/restart-coexistence-readonly-audit-2026-08-19.md)。

- 2026-08-18 23:37 CST：`b7c9451` 候选已上传服务器并通过远端 checksum、真实生产 preflight 和隔离 runtime smoke；当前 `current` 仍为 `c26e696`，没有重启正式 API、没有启动 Worker，旧 Python `8001` 未触碰。该候选只新增 P0 日志同 trace/request 关联链门禁，不推进支付、医保、预约写入或 HIS 回写，详见 [`release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md`](release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md)。

- 2026-08-18 23:40 CST：对当前 `c26e696` 自 `22:56:00` 起的 journald 做离线同链聚合，患者目录读取 `12/12`、患者同步 `6/6` 均在同一关联链内通过；微信登录、预约历史、门诊费用、报告和普通资料没有完整业务链，整体 P0 审计仍失败。该结果只增加服务端日志证据，不替代页面/HTTP/真机三层验收，详见 [`release/current-c26-p0-business-observation-2026-08-18-2340.md`](release/current-c26-p0-business-observation-2026-08-18-2340.md)。

- 继续审计 P0 证据门禁时发现：仅要求业务 `requested/success` 同链仍可能遗漏响应层失败。现已收紧为同一关联链必须同时包含业务请求、业务成功、HTTP `2xx` 完成，且不能出现同链 `http.request.failed`；新增状态摘要和失败回归测试。该修正尚未部署，不改变当前业务开放边界，支付、医保、预约写入和 HIS 回写继续关闭。

- `387b4a3` 已作为未切换候选上传并通过 8 项产物 checksum、真实生产 preflight 和隔离 runtime smoke；当前 `current` 仍为 `c26e696`，旧 Python `8001` 未触碰。候选验收记录见 [`release/candidate-387b4a3-http-success-gate-2026-08-18.md`](release/candidate-387b4a3-http-success-gate-2026-08-18.md)。

- 2026-08-18 23:49 CST：使用 `387b4a3` 新门禁离线复核当前 `c26e696` 日志，微信登录 `1/1`、患者目录读取 `14/14`、同步 `7/7` 均同链且 HTTP `2xx` 通过；预约历史、门诊费用、报告和普通资料仍为 `0/0`，不能替代真机页面验收。最新窗口见 [`release/current-c26-p0-business-observation-2026-08-18-2349.md`](release/current-c26-p0-business-observation-2026-08-18-2349.md)。

- 2026-08-18 23:54 CST：用户重启后通过 SSH 只读复核确认操作系统 uptime 未变化，新 API `hospital-platform-api-v2.service=active/running`、`current=c26e696`、`10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 均保持；`18082` 无残留，内外网 live/ready 为 200，ready 依赖为 `database/redis/schema=ok`。同窗口 P0 聚合仍为微信登录 `1/1`、患者读取 `14/14`、同步 `7/7` 的同链 HTTP `2xx`，预约历史、门诊费用、报告和普通资料为 `0/0`；完整记录见 [`release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md`](release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md)。本次没有旧服务操作、migration、Redis 清理或业务写入。

- 当前线上服务端 release 为 `c26e696`，新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 共存；配套小程序本地验收候选构建来源为 `a45d35edd91aab1a3a83c77301c9984402686145`。发布运行层已验收，真实微信、Provider、真机和 Redis TTL 业务证据仍按下方域级清单单独记录；当前 TTL 只读审计因常驻 Redis 账号无 `SCAN` 权限保持未验证，详见 [`release/687690e-redis-session-ttl-observation-2026-08-18.md`](release/687690e-redis-session-ttl-observation-2026-08-18.md)。本次生产切换证据见 [`release/c26e696-production-acceptance-2026-08-18.md`](release/c26e696-production-acceptance-2026-08-18.md)。

- 2026-08-18 23:18 CST：本地小程序运行包在提交 `a45d35e` 后重新构建，`dist/build-info.json.sourceRevision` 为
  `a45d35edd91aab1a3a83c77301c9984402686145`，14 个页面脚本通过 `runtime:verify`。本轮收紧运行输入清洁度门禁并补充来源解析测试，未上传小程序线上包、未重启服务、未修改旧 Python 服务；真机三层业务证据仍待重新采集。

- 2026-08-18 23:22 CST：重启后通过 SSH 只读复核确认 `current=c26e696`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active` 均正常，Worker 保持 inactive；内网与公网 live/ready 均为 200，ready 的 `database/redis/schema` 均为 `ok`。本次没有业务请求、migration、MySQL/Redis 写入或旧服务操作，不能增加真实微信、多患者、预约、报告或门诊费用证据，详见 [`release/current-runtime-coexistence-readonly-audit-2026-08-18-2322.md`](release/current-runtime-coexistence-readonly-audit-2026-08-18-2322.md)。

- 2026-08-18 23:27 CST：发现 P0 业务证据工具只比较各事件总数，存在把不同请求的 `requested` 与 `success` 拼成一次通过的可能；现已改为在同一 `traceId/requestId` 关联链内核对，并以 SHA-256 指纹输出安全摘要，补充跨链失败测试。该修正尚未部署，只增强后续验收门禁，不增加当前 release 的真实业务证据，也未修改旧 Python 服务。

- 2026-08-18 22:50 CST：重启后再次只读复核确认 `current=687690e`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active/running` 均正常。22:30–22:50 CST 低敏日志聚合为 `parseErrors=0`、`systemdWarningCount=0`，微信登录 `1/1`、患者目录读取 `8/8`、患者同步 `4/4` 的请求/成功门禁通过；没有预约、报告或门诊费用事件。该结果没有页面截图和设备连接证据，仍不计入真机三层验收；完整记录见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。本轮没有切换 release、执行 migration、写入 MySQL/Redis、修改旧 Python 服务或触碰用户已有的 `apps/miniprogram/project.config.json`。
- 2026-08-18 22:50 CST：重启后再次只读复核确认当时 `current=687690e`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active/running` 均正常。22:30–22:50 CST 低敏日志聚合为 `parseErrors=0`、`systemdWarningCount=0`，微信登录 `1/1`、患者目录读取 `8/8`、患者同步 `4/4` 的请求/成功门禁通过；没有预约、报告或门诊费用事件。该结果没有页面截图和设备连接证据，仍不计入真机三层验收；完整记录见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。随后 `c26e696` 已按无损手册完成候选切换，切换证据见 [`release/c26e696-production-acceptance-2026-08-18.md`](release/c26e696-production-acceptance-2026-08-18.md)。

- 2026-08-18（继续审计）：支付真实链路仍按计划最后处理，未打开微信支付、医保、退款或 HIS 写回；本轮仅收紧内部支付订单和服务端报价的持久化读模型。订单/报价在状态机、outbox 和 API 前重新投影并校验 owner、患者、金额、状态、版本、时间和来源，异常统一为 `persistence-invalid`，请求日志只保留固定 `readModelViolation`。本轮未部署、未重启、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18（继续患者同步审计）：发现快照事务返回值此前直接进入 `activePatientCount/deactivatedPatientCount` 成功日志。新增 `PatientDirectorySnapshotResult` 二次投影，并增加 `patient.directory.snapshot.committed` 事件区分“事务已提交”和“返回读模型已验证”；提交后读模型损坏只记录 `patient.directory.read.failed`，不伪造 `patient.directory.synced`，也不误报 `patient.directory.failed`。补充中文注释、domain/API 测试和日志/幂等契约文档；本轮未部署、未重启、未修改旧 Python 服务。

- 2026-08-18 22:19 CST：继续审计身份仓储读模型，发现登录、患者同步和微信预支付此前直接信任 `UserIdentityRepository` 的 TypeScript 返回类型，替换仓储或脏数据可能让错误 `userId`/`providerSubject` 进入 Redis、众阳或微信支付。新增身份读模型二次投影：登录校验本次 provider subject，患者同步/预支付校验当前 owner，异常统一返回 `persistence-invalid` 并在下游调用前停止；补充中文注释、domain/API/业务回归测试和 contract 文档。本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18 22:13 CST：继续审计微信登录运行时边界，发现 AuthService 之前直接信任 `WechatIdentityGateway` 的 TypeScript 返回类型，异常 gateway/回放结果仍可能在类型层之外污染 `hp_identity_users`。新增 adapter 之后的身份结果二次投影：只允许有界 `providerSubject`、可选 `unionId` 和固定低敏 trace；异常结果在身份写入和 Redis 会话签发前统一 fail-closed 为 `provider-response-invalid`，日志只保留固定 `resultViolation`，新增 domain/API 回归测试与中文 contract 文档。本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18（继续鉴权边界审计）：发现 Redis/可替换 `SessionTokenService` 返回的 `userId` 此前会直接成为 principal，异常会话值可能进入所有 owner-scoped 查询。新增统一会话 principal 二次投影：`userId` 必须是无控制字符、无首尾空白且不超过 64 个字符的 opaque 标识；异常读模型返回 `persistence-invalid`，不会伪装成 401，也不会调用患者、预约、报告、费用或支付 service。补充中文注释、API 错误契约、请求日志固定 `readModelViolation` 和回归测试；本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18（继续只读 Provider 边界审计）：发现预约、报告和门诊费用 service 在业务列表二次投影后仍直接信任 gateway `trace`，异常 Provider、控制字符或超长 request id 可能污染日志或内部引用关联。新增共享 `normalizeExternalTrace`，service 只允许有界低敏 trace 进入成功日志、排班快照和报告详情引用；异常统一为 `provider-response-invalid`，请求日志保留固定 `readModelViolation`。补充 domain/API 回归测试和中文 contract 文档；本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18 21:33 CST：重启后重新核对新 `miniprogram` 窗口，资源树仍为 `dist/`，模拟器首页和问题面板正常；但二维码仍显示 `8/18 18:59` 失效，重新打开入口未刷新有效期。因此本轮没有扫码、没有新增微信会话/患者/只读业务真机证据；需先重新编译生成有效二维码，记录见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-18 21:35 CST：在新 `miniprogram` 项目窗口触发普通编译后，二维码已更新为约 606 KB、有效期至 `8/18 21:59`；资源树仍为 `dist/`，问题面板为 0 个问题，模拟器首页正常。截至记录仍无新手机连接，因此只恢复了可扫码入口，不增加微信会话、患者目录或只读业务真机证据。

- 2026-08-18 21:36 CST：重启后 SSH 只读复核确认 `current=687690e`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active` 均正常；公网 ready 返回 `database/redis/schema=ok`。本次未执行任何业务写入，完整边界见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。

- 2026-08-18 21:40 CST：重启后重新核对新 `miniprogram` 窗口，资源树仍为 `dist/`，模拟器首页正常，问题面板为 0 个问题，调试器为 0 个错误/3 条微信基础库提示；当前没有新的手机连接，因此没有新增微信会话、患者切换或只读业务真机证据。详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-18 21:41 CST：新 `miniprogram` 模拟器出现旧会话 `/me 401` 后，服务端低敏日志核对到 `/auth/wechat 200`、`/me 200`、患者目录读取 200 和同步 200（1 条患者、1 条临床映射）；这证明模拟器的自动重新登录边界可工作，但没有新手机连接，不能计入真机验收。详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-18 21:43 CST：继续工作期间 SSH 只读复核确认 `current=687690e`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active` 未漂移；公网 ready 仍返回 `database/redis/schema=ok`。本次未执行重启、切换、migration 或业务写入，详见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。

- 2026-08-18 21:49 CST：重启后重新打开新 `miniprogram` 的“真机调试”入口，编译完成并生成约 606 KB 二维码；资源树仍为 `dist/`，但尚未出现新手机连接。本次只恢复可扫码入口，不增加真实微信、患者或只读业务真机证据，详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-18 21:52 CST：模拟器进入普通资料页后页面和性别选择器可完成只读交互，未执行保存；控制台仍有 `undefined is not iterable`、`clickCheckTask` 和会话恢复 401，未出现项目源码调用栈。该异常暂列为待真机复核，不加入猜测性兼容代码；二维码重新打开后约 606 KB、有效期至 `22:13`，仍无新手机连接，详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。

- 2026-08-18 21:57 CST：重启后继续工作的公网/SSH 只读复核确认 `current=687690e`、新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 和 `hospital-platform-api-v2.service=active` 均正常；公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 均为 200，ready 的 `database/redis/schema` 均为 `ok`，未登录 `/api/v2/me` 与 `/api/v2/patients` 均为预期 401。正确的 system ping 路径是 `/api/v2/system/ping`，`/api/v2/health/system-ping` 的 404 不属于当前健康路由故障。本次没有 release 切换、migration、旧 Python 修改或 MySQL/Redis 写入，不能增加微信会话、真机、多患者、预约、报告、费用或支付/医保/HIS 验收证据；完整记录见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。

- 2026-08-18 21:58 CST：对当前 `687690e` 的 21:52–22:00 journald 做低敏聚合，9 条记录全部是 HTTP 生命周期事件（200=5、401=2、404=2），`parseErrors=0`、`traceIdCount=9`、`providerRequestIdCount=0`，没有微信、患者、预约、报告或门诊费用业务事件。因此当前仍未形成新小程序业务验收链，下一步必须先在新 `miniprogram` 项目扫码建立有效微信设备连接；详细结果见 [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。

- 2026-08-18 22:01 CST：患者目录安全审计发现读模型第二道校验只检查 `cardNumberMasked` 的字符串形状和长度，无法阻止持久化层异常返回完整卡号。domain 现在要求卡号公共字段符合“前最多 5 位 + 连续掩码 + 后最多 4 位”或 `未绑定` 哨兵；不符合时整批 fail-closed，固定记录 `patient-card-number-invalid`，不会交给小程序自行脱敏。新增 domain/API 定向回归和中文业务规则；本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18 22:09 CST：继续审计发现患者同步在快照事务前只依赖 `PatientDirectoryGateway` 的 TypeScript 类型，未防御网关/回放任务返回的完整卡号、重复 provider 患者号、未知引用字段或不完整结果。新增 domain 的 gateway 结果二次投影、service 写入前 fail-closed、`provider-response-invalid` 映射、固定 `resultViolation` 日志和回归测试；异常结果不会写入 MySQL，也不会把同步 operation 标记为成功。本轮未部署、未重启新旧服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- `37016c4` 已作为未切换候选上传并通过产物 checksum、真实生产 env preflight 和 production 公网 runtime smoke；它只修正 smoke 日志不记录原始 `Error.message`，当前线上仍为 `687690e`，候选证据见 [`release/candidate-37016c4-smoke-log-hardening-2026-08-18.md`](release/candidate-37016c4-smoke-log-hardening-2026-08-18.md)。

- 2026-08-18：`b213dcc` 将统一患者 provider 引用校验接入报告目录 service。仓储返回的非法结构、控制字符或跨患者/Provider 的 HIS `patId` 会在报告 Provider 调用前 fail-closed，日志只保留有限引用原因；报告详情已有的短期引用范围校验和安全摘要语义不变。新增报告目录回归测试，当前 API 为 131 项、599 个断言。本轮未部署、未重启新旧服务、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`98e091b` 加固门诊费用 service 的患者引用二次门禁。即使 owner-scoped
  repository 返回了结构非法、控制字符或跨患者/Provider 的 HIS `patId`，service 也会在
  Provider 调用前 fail-closed，客户端继续使用安全的“门诊患者不可用”语义，日志只记录有限的
  `reference-invalid/reference-scope-mismatch` 原因。新增非法/越界引用回归测试；当前 API 为
  129 项、587 个断言，domain 为 27 项、62 个断言。本轮未部署、未重启新旧服务、未修改旧 Python
  服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`400a800` 将患者 provider 引用的运行时结构/范围校验下沉到 domain，并接入预约历史与门诊费用 service。两条业务在 owner-scoped repository 返回后都会复核内部 `patientId`、Provider 和外部患者号；非法或跨患者引用在 Provider 调用前停止，日志只保留有限 `reference-invalid/reference-scope-mismatch` 原因。新增预约历史回归测试，当前 API 为 130 项、593 个断言，domain 为 27 项、62 个断言。本轮未部署、未重启新旧服务、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`092928b` 收紧预约目录服务端生成的公共 `scheduleId`。每条排班引用现在必须通过 opaque 形状校验，同一批次不能生成重复 ID；异常时在 API/快照边界前整批 fail-closed，并记录有限 `schedule-id-invalid/schedule-id-duplicate` 原因。新增预约 service 回归测试，当前 API 为 128 项、581 个断言。本轮未部署、未重启新旧服务、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`56c73af` 收紧报告详情引用读取的第二道授权边界。即使 owner-scoped 仓储返回跨 owner、跨患者、跨报告号或结构非法的短期引用，service 也会在详情 Provider 调用前拒绝，并只记录有限 `reference-invalid/reference-scope-mismatch` 原因；新增“不调用 Provider”的回归测试，当前 API 为 127 项、577 个断言。本轮未部署、未重启新旧服务、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`aa9807a` 收紧患者目录同步的 MySQL 租约接管边界。精确幂等键过期时，仓储会先排除当前 operation 查询同一 owner/provider 的其它有效租约；若另一页面已用新 key 获得同步租约，则返回 `owner-provider` 范围的处理中冲突，不会并发访问 Provider 或竞争患者快照。新增 MySQL 回归测试和中文契约说明，持久化包为 75 项测试、549 个断言，全仓 `pnpm check` 通过；本轮未部署、未重启新旧服务、未修改旧 Python 服务，也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`62e1dac` 收紧报告详情短期引用的 service 范围校验。即使注入的引用仓储返回了错误 owner、患者、Provider 或报告号，service 也会拒绝把跨患者引用交给小程序，只保留安全报告摘要并记录有限失败事件；新增 API 回归测试，当前 API 为 126 项、575 个断言。本轮未部署、未重启新旧服务、未修改小程序或旧 Python 服务，报告 Provider 和真机验收边界保持关闭。

- 2026-08-18：`074a436` 收紧患者目录读取的第二道读模型边界。患者 service 现在会重新确认仓储结果的 owner、
  opaque `patientId` 唯一性、脱敏展示字段和临床枚举，并重新投影公共对象；错 owner、重复 ID、控制字符或非法枚举
  不会降级成成功空目录，日志只记录固定 `readModelViolation`，公共错误为 `persistence-invalid`。新增 domain/API
  回归测试和中文注释，全仓 `pnpm check` 通过；当时尚未部署到线上 `1b94c46`，未重启新旧服务，未修改旧 Python 服务，
  也未触碰用户已有的 `apps/miniprogram/project.config.json`。

- 2026-08-18：`ca46091` 收紧普通资料读取和更新的第二道读模型边界。资料 service 不再直接信任仓储的
  TypeScript 返回类型，而是重新校验当前 owner、昵称/邮箱、性别、年龄和持久化版本，并按公共白名单投影；
  损坏资料返回 `persistence-invalid`，不会降级成“微信用户”、空资料或记录 `user.profile.loaded/updated`
  成功。新增领域/API 回归测试、中文注释和普通资料契约说明，全仓 `pnpm check` 通过（domain 27/62，API
  125/573）；当时尚未部署到线上 `1b94c46`，未重启新旧服务，未修改旧 Python 服务，也未触碰用户已有的
  `apps/miniprogram/project.config.json`。

- 2026-08-18：`b9ce8ae` 收敛首页患者入口。首页不再保留可被误绑定的直接写入患者死方法，新增/更换患者继续统一
  进入独立 `patient-select` 页面；该历史窗口小程序回归为 122 项、1054 个断言，运行包重新构建并通过 `runtime:verify`，
  当时来源为 `b9ce8ae1ccb17a2be80cabdd0211d613e1a975bf`。本轮未部署服务端、未重启新旧服务、未修改旧 Python 服务，
  也未触碰用户已有的 `apps/miniprogram/project.config.json`；候选文档和所有当前 baseline 文档已同步来源指纹。

- 2026-08-18：`fb0efba` 完成门诊费用 service 的最终白名单投影。门诊费用 gateway 结果在状态、标识、
  日期、金额和展示文本校验后，必须重新构造公共对象，Provider 交易号、患者字段、医保金额和其它扩展字段
  不会进入小程序；本轮仍未打开支付、医保或 HIS。新增投影回归测试，定向 API/domain 检查通过；尚未部署、
  未重启新旧服务、未修改小程序或旧 Python 服务，详情见
  [`release/readonly-business-contract-audit-2026-08-18.md`](release/readonly-business-contract-audit-2026-08-18.md)。

- 2026-08-18：`d7ac308` 收紧预约科室与排班的 service 读模型边界。即使 gateway 绕过 adapter 类型约束，
  service 仍会重新校验文本、日期、号源数量、时间分组和 Provider 排班号唯一性，并只把公共白名单字段
  返回给小程序；Provider 扩展字段不会进入短期排班快照。新增预约目录投影/非法结果及错误映射测试，定向
  API/domain 类型检查通过；本轮尚未部署、未重启新旧服务、未修改小程序或旧 Python 服务，详情见
  [`release/readonly-business-contract-audit-2026-08-18.md`](release/readonly-business-contract-audit-2026-08-18.md)。

- 2026-08-18：`133e94e` 补齐报告只读链路的第二道 service 读模型门禁。目录和 LIS 详情 gateway 结果现在会在
  service 层再次逐字段校验并重新投影，非法状态、重复 LIS 报告号、缺失检测项字段和 Provider 扩展字段不会进入
  API；异常日志只记录有限 `resultViolation`，错误统一为 `provider-response-invalid`。新增报告 service 定向测试
  后为 17 项、102 个断言，API 类型检查通过；本轮尚未部署、未重启新旧服务、未修改小程序或旧 Python 服务，详情见
  [`release/report-readonly-contract-audit-2026-08-18.md`](release/report-readonly-contract-audit-2026-08-18.md)。

- 2026-08-18：完成 Provider 成功包络一致性审计。患者目录、`patInfosFind` 档案映射、报告目录和
  LIS 详情的包络形态现在必须明确 `success=true`；缺失或非布尔成功标志不会再伪装成空目录、无档案
  或空临床详情，明确 `success=false` 仍保留业务拒绝语义。预约历史原有 `success/code` 门禁保持不变。
  新增 23 项 adapter 定向测试全部通过，本次未部署、未重启新旧服务、未修改小程序或旧 Python 服务；
  详情见 [`release/provider-envelope-consistency-2026-08-18.md`](release/provider-envelope-consistency-2026-08-18.md)。

- 2026-08-18：门诊费用只读 adapter 收紧 Provider 响应包络：2.6.33 的包络形态现在必须明确
  `success=true`，`{data: []}` 或非布尔 success 不再伪装成合法空列表；Provider 明确
  `success=false` 仍保留业务拒绝分支。新增 2 个回归场景，定向 adapter/API 测试通过；本次未部署、
  未重启新旧服务、未修改小程序或旧 Python 服务。详情见
  [`release/outpatient-payment-envelope-validation-2026-08-18.md`](release/outpatient-payment-envelope-validation-2026-08-18.md)。

- 2026-08-18：`691ba28` 收紧“我的”页关键加载路径。会话确认后患者目录与普通资料并行读取，患者目录先提交并结束关键加载态，
  普通资料只作为可降级昵称增强；新一轮读取先清理旧昵称，资料失败不覆盖患者上下文错误，所有回写仍受页面实例请求守卫保护。
  小程序回归为 122 项、1052 个断言，TypeScript 构建和 `runtime:verify` 通过；本轮未部署服务端、未重启新旧服务、未触碰用户已有的
  `apps/miniprogram/project.config.json`，详见 [`release/miniprogram-my-page-critical-path-2026-08-18.md`](release/miniprogram-my-page-critical-path-2026-08-18.md)。

- 2026-08-18 19:12 CST：`bc1752f` 收紧首页患者目录请求的生命周期边界。失去当前请求或页面资格的旧错误以安全空完成收敛，
  不再冒泡到 `onShow/onRefresh` 或卸载后的页面回写；仍属于当前请求的失败继续按原错误语义清理展示态并提示。
  小程序回归为 122 项、1048 个断言，未部署服务端、未重启新旧服务，详见
  [`release/miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md`](release/miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md)。

- 微信开发者工具的 `miniprogram` 项目已确认使用 `miniprogramRoot=dist/`，当前运行包来源为
  `dist/build-info.json.sourceRevision=01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`，14 个页面脚本和根文件均已通过运行包校验。
- “二维码真机调试”弹窗已经生成 iOS 调试二维码，但截至本检查点尚未观察到手机扫码后的连接状态；二维码存在不等于微信会话、患者切换或业务已经验收。
- 本地 `pnpm check` 已通过；随后仅做了路线图文案修正和文档门禁复核，没有重新发布服务端、没有重启新旧服务，也没有触碰用户已有的 `apps/miniprogram/project.config.json` 修改。
- 当前门禁新增 `pnpm release:baseline:audit`：以只读业务验收候选为基准，自动核对路线图、迁移清单和当前业务审计是否仍绑定同一服务端 release 与小程序完整 `sourceRevision`，历史 release 仍可保留但不会被当作当前状态。
- 重启后发现已有“真机调试”连接属于旧 `mp-weixin` 项目，而不是新 `apps/miniprogram`；旧窗口保持原样不操作，新项目二维码尚未产生连接。边界记录见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。
- 2026-08-18 17:09 CST 已在新 `miniprogram` 项目窗口重新生成 iOS 真机调试二维码；截至记录时仍无新设备连接。二维码已生成不等于扫码成功，继续按上述边界区分旧项目连接和新项目验收。
- 2026-08-18 18:36 CST：`07d3988` 候选重新编译后，新项目模拟器首页正常显示，`appService.js: define is not defined` 的 2 个错误已消失；最终二维码已重新生成，但窗口枚举仍未发现新设备连接，活动真机窗口仍属于旧 `mp-weixin` 项目。本次不增加真机业务证据。
- 2026-08-18 18:38 CST：公网只读探针再次确认 `/api/v2/health/live=200`、`/api/v2/health/ready=200`（`database/redis/schema=ok`）、`/api/v2/system/ping=200`，未登录 `/api/v2/me/profile=401 unauthorized`。该结果只覆盖公网运行层和认证边界，完整低敏记录见 [`release/current-public-readonly-smoke-2026-08-18-1838.md`](release/current-public-readonly-smoke-2026-08-18-1838.md)。
- 2026-08-18 19:36 CST：重启后公网只读探针再次确认 live/ready/system-ping 为 200，ready 的 `database/redis/schema` 均为 `ok`，未登录 profile/patients 均为 401。当前环境 SSH 仍无法建立，因此没有新增新旧监听端口或 systemd 共存证据；完整边界见 [`release/current-public-readonly-smoke-2026-08-18-1936.md`](release/current-public-readonly-smoke-2026-08-18-1936.md)。
- 2026-08-18 18:40 CST：重启后重新核对新 `miniprogram` 窗口，资源树确认是 `dist/`，二维码代码包约 607 KB，模拟器首页正常，调试器为 0 errors / 3 条微信基础库提示；仍未观察到新手机连接。本次只恢复二维码上下文，不增加微信会话或只读业务真机证据，详见 [`release/miniprogram-device-session-boundary-2026-08-18.md`](release/miniprogram-device-session-boundary-2026-08-18.md)。
- 2026-08-18 18:47 CST：`d4261e5` 提交后的运行包重新构建完成，`dist/build-info.json` 已核对为完整来源指纹
  `d4261e5a59e0a9bfe69534169504d8a118ebca7f`，并通过 `runtime:verify`。此前 `07d3988` 二维码不包含本轮门诊费用失败态修正，不得继续用于验收；本次未部署服务端、未重启新旧服务、未触碰旧 Python 服务。
- 2026-08-18 18:53 CST：`e5aef63` 提交后的运行包重新构建完成，`dist/build-info.json` 已核对为完整来源指纹
  `e5aef63d086e59bf66d43de4156b875314f39912`，并通过 `runtime:verify`。本轮仅收紧报告详情错误态的临床读模型清理，未部署服务端、未重启新旧服务、未触碰旧 Python 服务；此前 `d4261e5` 运行包不包含本轮修正，不能用于最终真机验收。
- 2026-08-18 18:58 CST：`9b88cf1` 提交后的运行包重新构建完成，`dist/build-info.json` 已核对为完整来源指纹
  `9b88cf105314965837260b2d77671939ac22c828`，并通过 `runtime:verify`。本轮收紧普通资料收到 `user-profile-conflict` 后的页面状态：退出 `loaded` 可编辑态并隐藏保存入口，必须下拉刷新取得最新 `version` 后才能再次提交；未部署服务端、未重启新旧服务、未触碰旧 Python 服务。
- 2026-08-18 19:02 CST：为通过全仓 Biome 格式门禁，`2bb18d1` 仅规范普通资料冲突判断的代码排版，不改变运行逻辑；运行包来源随真实小程序源码提交推进为
  `2bb18d1d0f265e24237cd4e9a782ae20ff4bd127`，后续真机候选必须重新构建并通过 `runtime:verify`。
- 2026-08-18 19:06 CST：`e4d9de6` 修正门诊缴费首次加载期间的标签竞态。患者目录确认后先提交当前患者上下文，
  用户切换“待缴费/已缴费”时立即以新状态快照发起只读查询并淘汰旧 requestToken，避免旧状态费用列表落到新标签；
  小程序回归为 122 项、1044 个断言。本轮未部署服务端、未重启新旧服务、未触碰旧 Python 服务，详见
  [`release/miniprogram-outpatient-tab-race-2026-08-18.md`](release/miniprogram-outpatient-tab-race-2026-08-18.md)。
- 本轮修正门诊费用失败态：费用查询失败时页面现在清空 `selectedPatient`、费用列表和可见批次，但保留本地 opaque 选择并通过空态重新进入选择页；这样不会把上一轮患者卡片与失败/空读模型混在一起。该修正只影响小程序页面、中文注释和静态回归，详情见 [`release/miniprogram-outpatient-error-context-2026-08-18.md`](release/miniprogram-outpatient-error-context-2026-08-18.md)。
- 本轮继续收紧报告详情失败态：请求失败、引用过期或患者范围变化时，页面清空检测项、报告时间和附件标记，不仅依赖 WXML 隐藏错误态。该修正只影响小程序页面、中文注释和静态回归，不打开报告 Provider 详情 gate；待重新构建候选并核对来源后再进入真机验收。
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
- 当前小程序候选来源为 `01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`，14 个页面运行包已重新构建并通过 `runtime:verify`；小程序为 124 项测试、1059 个断言；本轮修正报告详情页与其它患者范围页面的错误语义统一，并让报告目录请求失败时同步清空总数、已展示数量和分页标记，保留首页目录旧请求在新请求或页面卸载后错误回写的生命周期竞态修正，并补充“我的”页普通资料慢响应不阻塞患者目录关键路径，保留门诊缴费首次加载期间标签状态快照竞态、普通资料 409 冲突后的强制刷新、报告详情/门诊费用失败态患者上下文、“我的”页未迁移菜单的 WXML key 和根入口全局脚本兼容，未改变服务端或旧服务。
- 详细规则见 [`release/miniprogram-authenticated-response-session-gate-2026-08-18.md`](release/miniprogram-authenticated-response-session-gate-2026-08-18.md)。

### 本轮预约目录日期事件边界（2026-08-18）

- 预约目录在刷新或切换科室期间会先清空当前日期分组；页面现在拒绝已经不属于当前分组的旧日期事件，避免过期 WXML 事件把 `selectedDate` 写成脱离当前科室读模型的状态。
- 该修正只涉及小程序级联页面、静态验收测试和中文业务注释，不扩大 Provider 查询、不开放预约写入、不修改 API、数据库、线上 release 或旧 Python 服务；真机和 Provider 证据仍需按候选验收手册取得。

### 本轮普通资料版本上限门禁（2026-08-18）

- `1b94c46` 修正普通资料 service 的版本边界：当请求版本已经达到 MySQL `INT UNSIGNED` 最大值时，在仓储写入前返回 `user-profile-invalid`，不尝试生成越界的下一版本。
- 新增“最大版本不触碰仓储”的回归测试；全仓 `pnpm check` 通过，API 为 115 项测试、525 个断言。代码注释明确区分输入校验、409 并发冲突和版本耗尽三种业务事实。
- 上一轮 `1b94c46` 曾按无损 runbook 完成生产切换；当前 release 已推进到 `/home/ps/code/hospital-platform/releases/687690e`。普通资料首次 PUT、真实 409 和真机证据仍需 P0 验收，上一轮部署证据见 [`release/1b94c46-production-acceptance-2026-08-18.md`](release/1b94c46-production-acceptance-2026-08-18.md)，当前共存证据见 [`release/687690e-production-acceptance-2026-08-18.md`](release/687690e-production-acceptance-2026-08-18.md)。

### 本轮普通资料 409 页面状态收敛（2026-08-18）

- 小程序收到 `user-profile-conflict` 后现在会退出 `loaded` 可编辑态并隐藏保存按钮，要求下拉刷新重新取得最新 `version` 后再提交；不会让用户继续用旧版本重复 PUT。
- 本轮只修改原生小程序页面、中文业务注释、静态回归和契约文档，不改变 API、数据库、Provider、线上 release 或旧 Python 服务；真实微信 PUT/409 和真机证据仍待 P0 验收。

### 本地候选与当前线上增量（2026-08-18）

- 本地 `main` 与 `origin/main` 已同步，具体文档提交以仓库当前 `HEAD` 为准；小程序当前运行输入来源为 `01b184d`，线上服务端运行 bundle 来源为 `687690e`。服务端上一轮在报告目录和门诊费用 adapter 中统一收紧 Provider 患者引用边界，并修正小程序同步回写不能覆盖患者 `stale/unavailable` 状态：即使患者号来自 owner-scoped 映射，
  adapter 也会在 HTTP 请求前拒绝空引用，并新增“不调用 Provider”的测试；报告、门诊费用 gate 和旧服务边界均未打开或修改。
- `687690e` 已通过全量 `pnpm check`、真实生产 env preflight、`18082` 隔离 smoke 和 SHA-256 对照后切换；当前真机配套小程序候选由 `01b184d` 重建，`sourceRevision=01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`，14 个页面脚本已核对。
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

- 当前线上为 `687690e`，运行于 `/home/ps/code/hospital-platform/releases/687690e`，生产模式、MySQL/Redis/schema readiness 均正常；
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
> 业务事件和“下一步”只对对应时间窗口成立，不能覆盖上面的 `687690e` 当前基线，也不能把历史
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

1. 在真机重新验收首页患者卡片和切换就诊人，确认页面只显示脱敏卡号与平台摘要；报告目录当前只验证未配置 Provider 门禁时的 fail-closed 文案、HTTP 边界和日志边界，不进行真实报告数据验收，直到报告 Provider contract 和门禁明确开放；
2. 在真机验收预约科室和排班，保存公网请求的 `requestId` 与页面证据；
3. 使用当前服务端 release `5a31427` 和最新小程序候选 `9340846`（完整构建来源：`93408462f3eeadffed172f1ea3b10c043d461b1b`）重新同步真实账号的患者目录，先运行显式 `patient-sync` smoke，再补做 `his-patient` owner-scoped 记录查询验收；
4. 验收门诊缴费只读页面：切换就诊人、待缴/已缴状态、空列表、异常重试和大数据滚动；
5. 取得二维码医院扫码协议，完成短期 token 设计前保持入口未开放；
6. 先取得患者绑定 PB-01 至 PB-16 的 provider 文档、脱敏样例和超时/重复请求证据；在此之前只维护患者目录读取和迁移提示，不开发建档/绑卡兼容代理；
7. 再处理报告真实 provider 只读验收、医院列表动态能力/病历和便民服务逐域迁移；静态医院卡片与静态院内地图只作为已完成子集，不能代替机构或路线 contract；个人中心扩展和外部入口先完成 contract/allowlist/旧数据隔离，非页面逻辑按新审计文档逐项清除直连和敏感缓存，院内导航动态能力必须先取得地图数据与路线 contract；
8. provider 只读稳定后，才进入预约写入合同和锁号设计；
9. 最后按现金支付 → 医保结算 → HIS 回写顺序做专项验收。
10. 旧生产 env 文件权限已收紧到 `0700/0600` 且旧进程存活；新 API Redis 会话已切换至 DB3/`hospital_v2` 最小 ACL 并完成公网 readiness 验收；0014 普通资料已完成生产 schema/API 运行验收，但真实微信资料读写和真机证据仍待完成。下一步完成历史读取风险/秘密轮换判断，再继续报告、病历和文件资源 contract；旧 DB1 全权限账号、旧任务和其他基础设施仍不得视为已迁移。
11. 收到新的 provider 文档后，先按 [`provider-document-intake.md`](provider-document-intake.md) 登记来源、版本、环境、脱敏样例和错误样例，再补齐 [`provider-contract-template.md`](provider-contract-template.md)；没有文档和样例的字段不得进入业务 schema、数据库或小程序页面。
12. 首个文档驱动的业务优先处理门诊就诊记录目录：先确认病历查询使用的 `his-patient` 映射、日期窗口、空结果、超时、资源授权和诊断字段白名单，再决定是否从草案注册 API；当前 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md) 仍是 draft，不开放正文、诊断和文件下载。
13. 当前服务端 release `5a31427` 已按 [`infra/systemd/api-v2-release-runbook.md`](../infra/systemd/api-v2-release-runbook.md) 完成原子 `current` 切换和新 API 单元重启；`18081`、公网 `/api/v2`、旧 `8001` 已复测通过。下一步进行真实微信登录、患者切换、预约只读和门诊费用的分层验收，任何业务层失败只回滚新 API，不触碰旧 Python 服务。
14. 当前公网 runtime 与 P0 日志 bundle 已能证明请求进入 `5a31427` Bun 进程；基础路由不再重复作为业务完成证据，下一步只补真实 session、owner 映射、Provider 状态和真机页面证据，并始终使用最新本地 `9340846` 小程序候选（完整构建来源：`93408462f3eeadffed172f1ea3b10c043d461b1b`）。

### 历史补充（仅供追溯，不作为当前执行项）

15. 2026-08-16 21:20 CST 使用候选 `3dc6f5f` 的 runtime smoke bundle 复测当前公网 `/api/v2`，live、ready、system-ping 和未登录认证边界全部通过；本次无会话、无患者/Provider 业务请求，不能替代真实微信 session 验收。证据见 [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md)。

## 业务正确性加固记录

- 2026-08-19：发现“本次立即执行项”曾把报告目录写成真机真实数据验收，但当前 `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false`，且报告 Provider contract 尚未完成；已将该项收紧为 fail-closed 边界 smoke，并把该不变量加入 `release-baseline-audit` 与回归测试。报告目录在门禁开放前不得以页面成功、HTTP 200 或测试桩数据宣称迁移完成。

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
