# 当前未开放业务门禁审计（2026-08-21）

> 当前候选：服务端 release `c8eef370`；小程序运行包来源 `f488c6f3270514af10b19fdf3c45a47519e1736b`（提交 `f488c6f3`）。

> 当前基线更新：服务端 `c8eef370`；小程序候选 `f488c6f3`；完整运行包来源 `f488c6f3270514af10b19fdf3c45a47519e1736b`。下文更早候选只作历史追溯。

> 本文是当前服务端 `c8eef370` 与小程序候选 `f488c6f3` 的门禁快照，完整来源为 `f488c6f3270514af10b19fdf3c45a47519e1736b`。它用于区分“已有代码骨架”“已注册路由”“具备 Provider 契约”和“真实业务已验收”，不能把其中任一层单独当作迁移完成。旧 Python 服务、旧数据库、旧 Redis 和旧域名本轮均未修改。

## 1. 当前基线与公网只读证据

| 项目 | 当前事实 |
| --- | --- |
| 服务端 release | `c8eef370c82e358205ee032af41ba2b23576af06`（`c8eef370`） |
| 小程序本地候选 | `f488c6f3270514af10b19fdf3c45a47519e1736b`（`f488c6f3`），尚未上传线上 |
| 新服务 | `https://test-hp.meiyi.pro/api/v2`，生产模式、数据库/Redis/schema readiness 为 ready |
| 小程序运行包 | `apps/miniprogram/dist/`，14 个页面；不包含 `*.test.js`/`*.spec.js` |
| `GET /health/live` | `200` |
| `GET /health/ready` | `200` |
| `GET /medical-records` | `404`，病历目录路由未注册 |
| `GET /patient-binding/commands` | `404`，患者绑定命令路由未注册 |
| 未登录 `GET /reports?...` | `401`，先经过会话认证；不代表报告 Provider 已验收 |
| 未登录 `GET /payments/outpatient/records?...` | `401`，只读路由的认证边界正常 |

上述请求未携带 Bearer、微信身份、患者标识或 Provider 凭证，也未写入 MySQL/Redis；关闭路由的 `404` 是预期门禁证据，不是需要用兼容转发填补的故障。

2026-08-21 后续只读业务复核又对照了已登记的众阳 `2.6.33` 门诊待支付材料：adapter 只接受
`tradeStatus=1`（待支付）和 `tradeStatus=3`（已支付），并拒绝 `2`（已生成结算）、`4`（退款中）、
`5`（已退款）和 `9`（作废）。因此没有发现把中间态误报为“已缴费”的代码缺口；支付/医保/结算 gate
继续关闭，本次不修改 adapter 或公共 contract。

同轮报告链复核结果为：报告 service `20 pass`、持久化引用/owner/TTL 测试 `46 pass`、小程序客户端相关
测试 `174 pass`。这些结果只证明本地报告白名单、患者归属、短期引用和错误清理逻辑；没有 Provider 脱敏
响应、公网业务请求或微信真机患者切换证据，因此报告 gate 仍不打开。

## 2. 分域结论

| 业务域 | 当前代码/路由 | 契约与证据判断 | 当前动作 |
| --- | --- | --- | --- |
| 门诊病历目录 | 未注册 `/api/v2/medical-records` | 缺正式 `out-visit-records` 请求/响应、专用患者映射、空/拒绝/超时语义、字段白名单和分页/时间语义 | 保持 404，不编码 |
| 患者新增/绑卡/解绑 | 未注册 `/api/v2/patient-binding/*` | 缺 PB-01 至 PB-16 的 provider 文档、命令幂等、最终事实查询、协议和跨 owner 冲突规则 | 选择页只保留迁移提示 |
| 首页患者二维码 | 入口关闭，不生成二维码载荷 | 缺扫码字段、签名、受众、TTL、防重放、撤销、扫码回执和医院设备验收 | 不生成伪二维码、不外发卡号/patId |
| 报告目录 | 有只读路由和安全读模型骨架 | 缺 provider intake 正式记录、LIS/PACS/ECG 脱敏成功/空/失败样例、真实公网/日志/真机三层证据；gate 仍关闭 | 不打开 gate；只维护 fail-closed 代码 |
| 报告详情/附件 | 仅有 LIS opaque 引用骨架，附件未开放 | 缺详情字段、影像/心电资源授权、短期 URL、下载审计和过期回执 | 不扩展详情、下载或分享 |
| 支付/医保/HIS 写回 | 不纳入本阶段 | 涉及副作用、结算状态、授权回跳和生产凭证 | 最后专项处理 |

## 3. 已核对的代码边界

1. `apps/api/src/app.ts` 只挂载当前已有的患者、预约、报告和门诊费用模块；没有病历或患者绑定模块。
2. `apps/api/src/index.ts` 只有在报告目录/详情配置状态为 `configured` 且 Provider 基础配置存在时才创建报告 gateway；配置缺失时不能被页面入口解释成真实报告成功。
3. `apps/api/src/modules/reports/index.ts` 的公共输入是平台内部 `patientId`、日期和有限 `kind`；Provider 患者号、报告号、文件 URL 不属于小程序 contract。
4. `docs/migration/medical-record-directory-contract-draft.md`、`patient-binding-contract-draft.md` 和 `qr-contract-audit-2026-08-17.md` 仍分别处于草案/关闭态，尚未满足实现门禁。
5. 报告已有的 adapter/domain/service 测试只证明本地读模型和 fail-closed 逻辑，不能替代真实 Provider 字段、公网请求、日志关联或真机患者切换证据。
6. `packages/adapters/src/zhongyang-outpatient-payments.ts` 与对应测试已按 `2.6.33` 的状态枚举保持
   fail-closed；公共 `unpaid/paid` 只映射明确的 `1/3`，不能扩展成支付或结算状态机。

## 4. 下一步顺序与停止条件

当前最合理的下一步不是同时开发四个高风险域，而是等待/接收 Provider 文档 intake，然后只选一个域形成完整闭环：

1. 若众阳自动化会话产出报告材料，先登记来源、版本、环境、请求头/签名、成功/空/失败/超时脱敏样例，不修改现有 adapter 以外的业务边界。
2. 优先评估报告目录只读；只有字段白名单、`his-patient` 映射、日期窗口、错误语义和 trace 关联都确认后，才打开目录 gate。
3. 目录真实证据稳定后，再单独评估 LIS 详情；PACS/ECG 详情、附件下载、体检和报告解读不得顺手复用。
4. 病历、患者绑定和二维码继续分别等待各自契约；不因报告目录或 `patInfosFind` 曾经成功，就共用 `patId`、卡号或二维码载荷。
5. 任一域出现“HTTP 200 但字段不完整”“空数组无法区分故障”“患者映射不唯一”“日志无法按 trace 关联”或“真机页面与响应患者不一致”，立即停止该域并回到契约修正。

## 5. 本轮回归证据

| 检查 | 结果 |
| --- | --- |
| `pnpm provider:audit` | 通过；3 份 Provider 接收记录、26 个 `documentId`，其中没有病历或报告正式脱敏样例 intake |
| `pnpm architecture:audit` | 通过；67 项架构/安全边界规则 |
| `pnpm --filter @hospital/api test src/app.test.ts src/plugins/error-handler.test.ts` | 通过；56 项测试、316 个断言 |
| `pnpm docs:audit` | 通过；395 个 Markdown 文档、无断链 |
| `pnpm release:baseline:audit` | 本轮文档同步后通过；服务端 `c8eef370` 与小程序候选 `f488c6f3` 指针一致 |

这些检查证明代码和文档门禁保持一致，但不替代真实 Provider 响应、线上 journald 业务事件、微信真机页面或多患者切换证据。SSH 运行层只读复核本轮未建立连接，因此不据此新增线上日志结论。

## 6. 日志与旧服务边界

新服务只记录 `event`、内部 request/trace 关联、provider 名、HTTP 状态、耗时、固定错误码和安全计数；不记录 Authorization、openid、unionid、session_key、身份证、手机号、姓名与证件组合、`patId`、卡号或 Provider 原始 JSON。任何后续 Provider 取证都必须沿用这个边界，并明确区分“没有请求发生”和“请求返回空结果”。

本轮没有 SSH 写入、部署、重启或修改旧 Python 服务；也没有触碰并行修改的 `apps/miniprogram/project.config.json` 与 `.codegraph/`。
