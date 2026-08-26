# 当前报告与普通资料不变量审计（2026-08-24）
> 当前配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示本地 live 候选，未证明微信线上版本或真机业务已验收。
> 当前线上服务端 release（2026-08-26）：`e5d941aef3a8b0d1df24a518bea03f36f2ee505d`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。

> 当前服务端 release：`8eb51b5ffe85b0b8f8a032783f893117d3df549d`；当前小程序运行包来源：
> `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本记录审计代码、持久化边界和运行配置，
> 不把本地回归或 readiness 当作 Provider/真机业务完成。

> 本轮补充（2026-08-24，本地审计）：普通资料日志边界代码修正提交为 `d450c56c`，服务端已于 19:54 CST 切换到 `8eb51b5f`，
> 小程序本地 `dist/build-info.json.sourceRevision` 为 `39b50d5c4287f54ecc24e8564e2dc811a55c1d1b`；
> 该运行包仍未替换线上 `13f597e`。报告配置、众阳报告 adapter、报告 service 和 Provider smoke
> 专项回归共 `74 pass / 0 fail / 265 expect()`；小程序全量回归为 `238 pass / 0 fail / 1906 expect()`。
> 这只证明当前代码与关闭态 contract 一致，
> 不产生真实 Provider、微信真机或线上日志三层证据。

## 2026-08-25 当前候选复核

本轮在患者中心审计后重新核对报告与门诊病历入口，当前小程序运行候选为 `ad7b079`，小程序全量测试为
`240 pass / 0 fail / 1929 expect()`，`runtime:verify` 确认 `dist/` 的 16 个页面脚本完整。

- 报告目录和 LIS 详情仍由独立 gate 控制；未取得当前环境的脱敏成功、明确空、权限拒绝、超时和字段异常证据前，
  `ZHONGYANG_REPORT_DIRECTORY_READY` 与 `ZHONGYANG_REPORT_DETAIL_READY` 不打开。关闭态应返回依赖未配置/不可用，
  不能用空列表冒充没有报告。
- 报告目录与门诊病历继续是两个不同业务域：报告只读摘要/详情引用不能复用为病历；病历页面仍只显示迁移状态，
  `/api/v2/medical-records` 未注册。旧端 `out-visit-records` 的 `patId`、`regId`、诊断和原始病历字段没有进入新端。
- 本轮没有调用 Provider、没有读取患者或报告原始数据、没有修改旧项目和旧服务，也没有触碰另一会话负责的众阳自动化。

本轮只完成准入审计和文档更新，不产生报告真实业务完成度；下一步仍按“Provider contract → 脱敏样例 → adapter/字段白名单 →
关闭态/真实 gate 验收 → 小程序页面”的顺序推进。

## 结论

本轮没有发现需要直接修改运行时代码的真实逻辑缺口，因此没有在缺少正式 Provider 合同和用户写入授权时
扩大功能。当前正确状态是：

- 报告目录和 LIS 详情的运行 gate 均关闭：`ZHONGYANG_REPORT_DIRECTORY_READY=false`、
  `ZHONGYANG_REPORT_DETAIL_READY=false`。报告路由保留稳定的关闭/错误契约，不调用真实 Provider。
- 报告目录只返回 LIS、PACS、ECG 的安全摘要；PEIS、报告解读、PACS/ECG 详情、附件下载和影像资源授权
  不被“目录页面已经存在”带开。
- 普通资料代码已经具备读、受控写和版本冲突语义，但真实 `PUT /me/profile` 仍必须等待明确的可恢复测试值
  授权和同一微信会话三层证据；本轮没有写线上资料。

## 报告链业务不变量

### 1. 归属和短期详情引用

小程序只提交平台内部 `patientId` 和日期/来源筛选。服务端先使用当前 Bearer owner 解析 owner-scoped 的
`his-patient` 引用，Provider 患者号只在仓储到 adapter 的调用帧内存在，不进入公共响应或日志。

LIS 目录项的详情引用由 `ownerUserId + patientId + providerReportId` 生成短期 opaque `reportId`，并在
仓储写入后再次校验 owner、patient、Provider、kind、Provider 报告号、创建时间和过期时间。详情读取必须同时
按 owner、patient、reportId 查询并检查 TTL；跨患者、跨 owner、过期或结构损坏的引用在 Provider 请求前统一
转为“详情不存在/不可用”，不能把 `reportId` 当成独立 bearer token。

目录中单条详情引用写入失败时保留安全摘要但隐藏详情入口；Provider 目录本身失败则整批失败，不能把部分报告
伪装成完整成功。固定并发度为 4，避免报告数量异常时把 MySQL 连接池打满。

### 2. 来源和时间事实

| 来源 | 当前公开能力 | 时间事实 |
| --- | --- | --- |
| LIS | 目录摘要；详情 gate 关闭 | 只接受旧端展示的 `reportTime` |
| PACS | 目录摘要 | 只接受旧端展示的影像报告时间；不保留详情号 |
| ECG | 目录摘要 | 优先使用旧端展示的 `diagnoseTime`，不能用 `auditDocTime` 猜测 |
| PEIS | 未迁移 | 需要独立身份证/院区/患者归属合同 |

目录和详情时间必须是可解析的真实日历值。目录结果必须落在请求首尾自然日窗口内，窗口外、无法解析或来源错配
的结果整批拒绝；不能通过过滤坏行制造“成功但缺报告”的假象。

### 3. 临床详情和敏感字段

当前 LIS 详情只允许白名单检测项：名称、结果、单位、参考范围和有限异常枚举。姓名、身份证、手机号、Provider
报告号、原始 JSON、文件 URL 和报告解读正文不进入小程序公共 contract。`hasAttachment=true` 只代表 Provider
明确返回附件存在标记，不代表已经具备下载或预览授权。

## 普通资料业务不变量

- owner 只来自当前会话；接口不接受 `userId`、openid、unionId、手机号、身份证、患者关系、头像或实名字段。
- GET 没有资料行时返回 `version=0` 的默认快照，不创建数据库记录，也不把默认值当成已持久化。
- PUT 只接受 `version`、`displayName`、`gender`、`age`、`email`；未知字段在 service 层再次拒绝，不能静默丢弃旧端意图。
- 首次 `version=0` 使用唯一键竞争保护；已有资料使用行锁和版本条件更新，成功后必须得到 `N+1` 的 canonical 快照。
- `null` 是年龄/邮箱的明确清空语义；非法年龄、邮箱、控制字符、超长 Unicode 昵称和版本溢出在数据库写入前拒绝。
- 版本冲突返回 `409 user-profile-conflict`，不自动覆盖、不无限重试，也不记录资料正文。
- `user.profile.requested` / `user.profile.update.requested` 只在调用上下文和 owner
  形状通过基础校验后记录；畸形 direct-call 只记录对应失败事件，不能被日志误判为已经进入资料业务。
- 成功日志只记录 trace、字段数量和版本结果；失败日志只记录固定错误类型/读模型原因，不记录 userId、邮箱、昵称、
  token 或原始请求体。
- 小程序在 PUT 前和成功回写前都检查会话代际；成功页面只使用服务端 canonical 快照，401/会话切换清除旧资料，
  503 数据暂时不可用不误判为退出登录。

以上 owner、患者范围、版本、引用和错误边界已经在核心代码中使用中文注释固定，避免后续维护时把“页面能显示”
误当成“业务事实已确认”。

## 当前运行层观察

2026-08-24 只读 SSH 观察结果：

| 检查 | 结果 |
| --- | --- |
| 新 API | `active` |
| Worker | `inactive`，当前报告/资料只读验收不依赖 Worker |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，保持共存 |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |
| 报告目录 gate | `false` |
| 报告详情 gate | `false` |

本次只读检查没有重启、上传、切换 release、写 MySQL/Redis、修改反向代理或修改旧 Python 服务。

## 当前线上普通资料只读关联观察

2026-08-24 18:45–19:31 CST 通过 SSH 中转机对新 API 做了只读日志核对，未执行资料写入、数据库操作、服务重启或 release 切换：

| requestId/traceId | HTTP 结果 | 业务链 | 持久化事实 |
| --- | --- | --- | --- |
| `mp-mt740y8k-te4m85n9` | `GET /api/v1/me/profile`，`200` | `requested → loaded` | `persisted=false` |
| `mp-mt75ftwv-nfph6efg` | `GET /api/v1/me/profile`，`200` | `requested → loaded` | `persisted=false` |
| `mp-mt75ooqi-0y9ozak9` | `GET /api/v1/me/profile`，`200` | `requested → loaded` | `persisted=false` |

同一日志链同时确认 `hospital-platform-api-v2.service` 为 `active`，旧 Python 服务仍为 `active`，新 API
监听 `10.0.0.3:18081`，旧服务监听 `0.0.0.0:8001`，当前 release 为
`8eb51b5ffe85b0b8f8a032783f893117d3df549d`。本次窗口没有 `user.profile.updated`、`user.profile.conflict`
或真实 `PUT` 事件，因此只能把普通资料 GET 标记为“线上只读链路已观察”，首次写入、版本冲突和真机页面
仍保持 pending；`persisted=false` 表示该 owner 当前没有资料行，不表示写入失败。

## 回归证据

### 当前候选专项回归（2026-08-24）

本轮使用当前工作树直接执行：

```text
bun test packages/config/src/index.test.ts packages/adapters/src/zhongyang-reports.test.ts apps/api/src/modules/reports/service.test.ts apps/worker/src/provider-directory-smoke.test.ts
74 pass / 0 fail / 265 expect()
```

回归覆盖报告 gate 默认关闭、三来源聚合的整体失败语义、Provider 包络和 trace 校验、
时间窗口、来源错配、重复报告号、资源上限、短期详情引用的 owner/patient/TTL 边界，
以及 smoke 层对平台安全响应和错误脱敏的检查。并行会话的众阳文档自动化和 Provider 采集代码
没有被本轮修改或调用。

针对本轮审计运行：

- API 报告 service、普通资料 service、统一错误映射：`59 pass / 0 fail / 252 expect()`。
- 众阳报告 adapter：`19 pass / 0 fail / 41 expect()`。
- 报告/资料领域和调用上下文：`8 pass / 0 fail / 24 expect()`。
- MySQL/内存资料与引用仓储：`55 pass / 0 fail / 196 expect()`。
- 原生小程序当前测试入口：`223 pass / 0 fail / 1648 expect()`。

这些结果证明当前代码边界和注释对应的回归事实一致，但不证明 Provider 字段授权、报告真实数据、真机页面或
资料真实写入已经完成。

## 下一步放行顺序

1. 先用当前 `13f597e` 二维码收集报告目录的真实三层证据；由于 gate 关闭，预期是稳定的关闭/依赖未配置语义，不能
   把空列表或 404 当作报告迁移成功。
2. 在获得脱敏 Provider 成功、明确空、业务拒绝、超时和字段异常样例后，单独冻结报告目录 contract，再评估是否打开目录 gate。
3. 目录通过后，单独验收 LIS 详情短期引用、过期、跨患者拒绝和字段白名单；PACS/ECG 详情、附件、PEIS 和报告解读继续分开处理。
4. 普通资料先只做 GET 真机验收；只有用户指定可恢复测试账号和测试值后，才执行 PUT、恢复值和同一 owner 双会话 409 验收。
5. 支付、医保、退款、预约写入/取消和 HIS 回写最后处理，本轮不打开任何入口。

本轮没有修改旧项目、旧 Python 服务、线上数据库、Redis 或并行会话维护的众阳文档自动化，也保留了用户未提交的
`apps/miniprogram/project.config.json`。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
