# 全量业务迁移、支付与用户体验 TODO

更新时间：2026-09-19

## 审计范围与结论

本文件分为两层：第一层继续维护旧服务中可以核对的非支付迁移：小程序页面、患者中心、预约目录与非支付预约动作、报告、门诊/住院只读、健康内容、临床问卷、便民服务、智能导诊/陪诊、外部入口和后台运营；第二层新增维护支付链路中途退出、退费、支付/医保/HIS 回写、迁移完整性复核和用户体验优化。支付不再从本文件全局排除，但所有真实支付、退费、Provider、微信、HIS 和生产写入仍必须经过独立 gate，不能因为代码或本地测试存在就开放。

本轮使用的旧服务根目录是 /Users/yxswy/Documents/GitHub/hospital，新项目根目录是当前仓库。审计原则是：

- 旧源码中的页面和接口只是迁移输入事实，不自动等于新端应该照搬。
- 新端有页面、API、测试或 HTTP 200，不等于 Provider、数据库、微信、HIS、外部页面或真机业务已经完成。
- 只有旧服务确实有可执行行为，才建立迁移项；旧端自身是静态壳、本地假保存或 TODO 的功能，记录为“不应凭空实现”，不把它伪造成缺失的旧业务。
- 真正开放必须形成 contract → adapter → domain → persistence → API → 小程序 → 日志 → 真实验收闭环。

当前 TODO 复选框总数为 42 项，其中已完成 19 项、未完成 23 项。
另按标题优先级统计未完成项为：P0 0、P1 22、P2 1、P3 0。

## 2026-09-16 用户范围确认与执行记录

- 旧服务历史数据暂不迁移；本轮只迁移和验收功能，不向旧库写入、不导入旧的电子锦旗/表扬信等历史记录。
- 已继续处理患者绑定的功能入口：`我的 → 家庭成员管理 → 添加就诊人` 进入实名表单；姓名、手机号、身份证号和协议勾选由平台 API 接收，真实 Provider 查档/建档/绑卡在配置与实证不足时保持 fail-closed。
- 按用户指定目录重新生成 development 包：`/Users/yxswy/Documents/GitHub/hospital-platform/.local/hospital-miniprogram/development`；13:06、13:47、14:06 和 14:34 的构建记录保留为历史过程，当前候选以本记录后续最新构建指纹为准；各次 `build:dev` 与 `runtime:verify:dev` 均按当时源码通过。
- 当前候选复核（2026-09-16 15:20）已重新生成：运行包为 `sourceRevision=workspace-sha256:058b1c90a85c14e678b43a0174d7cceab4e177d4bf562b6f9d7adf9d51cdd800`、`generatedAt=2026-09-16T15:20:52.257Z`、`pageCount=52`；此前 15:16 及更早指纹均只保留为历史过程。
- 开发者工具当前实证仍加载旧项目 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/dist/dev/mp-weixin`，页面为旧 `pages/index/index`/`pages/user/user`；不是新项目 `.local/hospital-miniprogram/development`，因此当前画面不能作为新迁移功能验收，待手动切换项目后再做 DevTools/真机验证。
- 本轮尝试通过微信开发者工具 CLI 打开新 development 包时，工具返回 Service Port 未开启；需要在开发者工具“设置 → 安全设置”由用户手动开启后才能自动切换/读取新项目。未修改该本机权限，DevTools/真机验收继续 pending。
- 指定项目小程序回归已通过：438 pass、0 fail、4810 assertions；仅验证源码/运行包边界，不等同 Provider 或真机业务成功。
- 患者绑定真实 Provider、机构卡类型、旧服务身份交换、真机和生产链路仍未验收，因此 P1-01 不勾选完成；后续按本清单顺序继续推进，旧数据范围保持排除。
- P1-01 API 防回归补充：新增 `/api/v1/patients/bind` 未登录请求测试，确认实名 payload 在认证层即被拒绝；又增加已认证绑定接口回归，确认幂等键进入服务上下文、返回值只包含脱敏患者目录字段；API app 测试 55 pass、0 fail、386 assertions。
- P1-01 Provider/服务层复核：用户项目当前分支的众阳绑定 adapter 与患者绑定服务共 8 pass、0 fail、31 assertions；API typecheck 通过；配置测试 13 pass、0 fail、73 assertions。已确认已有档案只查档后绑卡、仅在明确无档案时建档再绑卡，绑定后目录确认失败只重试同步，不重复建档/绑卡；新增并发相同幂等键只产生一次 Provider 操作、材料冲突复用幂等键拒绝的回归。
- 迁移门禁复核：`pnpm migration:breadth:audit`、`pnpm migration:boundary:audit`、`pnpm provider:audit`、`pnpm todo:audit`、`pnpm docs:audit` 均通过。边界审计现已记录多原生落点（住院预缴、出院随访详情、便民创建/记录、健康自测题流），不以通用状态页掩盖已迁移的页面结构；这些页面的 Provider、支付回写、临床审核和外部主体能力仍保持关闭。
- 就绪报告复核：`pnpm migration:readiness` 的 `structuralAuditPassed=true`，但整体 `passed=false`；失败来自当前 live 仍是旧运行包、无真机候选证据、健康内容无审核 bundle，以及患者/临床/外部/支付 contract 尚未满足。该结果只说明结构台账可计算，不代表业务可发布。
- 就绪报告最新复核（2026-09-16 13:14:28）：报告读取到的 live 运行包仍为 `baseSourceRevision=feaaff1eec1f32359b9b285c4d8f14b33441b3a9`、49 页；用户指定 development 目录则已是 52 页、`sourceRevision=workspace-sha256:1d641a7a2018a44893108aeed1939bf57a94f45bc5de2649797c3461c7abf976`。两者不是同一运行层，当前不能把 development `runtime:verify:dev` 结果写成 live/真机验收，亦未执行 live 切换。
- 环境模板审计已收口：`.env.example` 中的本地 AI Runtime `AI_RUNTIME_READY/URL/TOKEN/TIMEOUT_MS` 和客服开关已明确登记为开发专属变量，生产模板仍不提供未经确认的本地 sidecar 配置；`pnpm env:template:audit` 及对应审计测试通过。客服/真实模型能力仍保持默认关闭，不因模板审计通过而开放。
- P1-01 外部连通性复核：对 `https://gpsrmyy.meiyi.pro/` 的无业务请求返回 HTTP 200，对 `https://test-hp.meiyi.pro/api/v1` 根路径返回 HTTP 404；这只能证明 TLS/主机可达，不能证明登录、卡类型、查档、建档或绑卡 contract。未发送任何患者绑定业务 POST；旧服务仅完成无效 code 负向探针，当前仍没有测试账号、有效旧服务认证结果或真实 Provider 样例，P1-01 保持关闭。
- P1-01 环境配置复核：当前项目 `.env` 已补齐由旧配置和无认证字典探针得到的患者绑定机构/院区/卡类型及旧服务认证根地址，但 `ZHONGYANG_PATIENT_BINDING_READY=false`、众阳授权 token 为空，且旧服务登录/unionId 一致性未验证；未发现正在运行的新 API 进程。本次未打印敏感值、未发送患者绑定业务请求，P1-01 继续 fail-closed。
- P1-01 配置边界补充：当前 `.env` 的众阳授权 token 配置项为空，`ZHONGYANG_PATIENT_ORG_ID=10389`、`ZHONGYANG_PATIENT_HOSPITAL_ID=10389001`、`ZHONGYANG_PATIENT_CARD_TYPE_ID=3` 已依据无认证卡类型字典只读响应写入准备配置，`LEGACY_PATIENT_AUTH_BASE_URL` 已依据旧小程序 production 配置写入 `https://test-hp.meiyi.pro/api/v1`；但 `ZHONGYANG_PATIENT_BINDING_READY=false`，旧服务用户级登录/unionId 一致性仍未验证。这些配置不是用户级 owner 授权，也不能单独证明患者绑定可自助开放。本次未发送任何患者绑定业务请求。
- P1-01 旧配置来源补充：旧小程序 `hospital-app/env/.env` 明确存在 `VITE_HOSPITAL_ID=10389001`，但未发现患者绑定专用 `orgId` 或卡类型字典结果；该值仅登记为旧端医院 ID 事实，不自动写入新服务配置。
- P1-01 旧认证负向探针补充（2026-09-16）：向旧服务 `POST /api/v1/system/auth/login/wechat` 发送明确无效的探针 code，得到 `success=false`、`code=-1`、`status_code=500`、`data=null`、消息“换取openid异常: code无效”；未返回 token/unionId/患者字段，也未触发患者建档或绑卡。该结果只确认旧认证端点和失败包络，仍缺真实测试账号、有效 code、unionId 一致性及 Provider 绑定证据。
- P1-01 旧配置来源再次核对（2026-09-16）：旧服务 `env/.env.prod` 仅发现通用微信、MBS 和支付侧配置；旧小程序环境仅发现 AppID 与 `VITE_HOSPITAL_ID`，未发现可用于患者绑定的 `YUNHEALTH_AUTH_TOKEN`、患者专用 Provider token、患者绑定映射或测试用户凭证。旧后端 `app/config/setting.py` 中声明的可选认证配置只是代码字段，不构成已配置授权。该核对不输出密钥值、不调用患者写接口，P1-01 的真实验收仍需业务方提供受控测试凭证和 Provider 回包。
- P1-01 当前专属回归重跑（2026-09-16）：Provider adapter、绑定服务、运行配置共 21 pass、0 fail、104 assertions；小程序患者绑定入口 2 pass、0 fail、38 assertions；环境模板审计通过。`.env` 中 `ZHONGYANG_PATIENT_BINDING_READY=false`、`ZHONGYANG_PATIENT_DIRECTORY_READY=false`，未发送患者绑定写入请求，P1-01 仍保持关闭。
- 当前候选 release 构建复核（2026-09-16）：`pnpm --filter @hospital/miniprogram build` 在 typecheck 通过后被运行包来源保护拦截，原因是运行输入仍存在未提交修改；项目脚本明确要求 release 运行包只能来自干净 Git checkout。本次未绕过门禁、未伪造提交来源，当前可追溯候选仍是最新 development 包 `workspace-sha256:ff6b1500ea1efc9b293ae7077a6ae5727946a0cc7a9e7d292db5437535046c09`，P1-01 及 DevTools/真机验收不因该失败被误标完成。
- 开发者工具项目切换更正（2026-09-16 13:58-14:01）：已从旧项目 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/dist/dev/mp-weixin` 切换到当前新项目 `/Users/yxswy/Documents/GitHub/hospital-platform/apps/miniprogram`，执行普通编译并实际打开新首页；此前“开发者工具仍停留旧项目、没有新页面结论”的记录仅保留为切换前事实，不再作为当前状态。该次 DevTools 运行显示 4 个底部 Tab 为“医疗服务 / 就诊 / 互联网医院 / 我的”，未显示“智能陪诊”Tab 标题。
- 开发者工具页面复核（2026-09-16 14:00-14:01）：新首页的“就诊人绑定”入口可达，先进入 `pages/patient-select/patient-select`，再进入 `pages/patient-binding/patient-binding`；实名表单显示姓名、手机号、身份证号、协议勾选和“提交添加”，但本次未填写、未勾选、未提交，不产生患者绑定写入。返回首页后进入 `pages/consultation/consultation`，页面实际显示当前就诊人/院区上下文并加载兼容历史问诊摘要，开发者工具日志记录 `/appointments/records` HTTP 200。该运行事实只证明当前新项目页面可渲染和平台只读请求可返回，不替代真实问诊外部会话、Provider、真机或生产验收。
- 开发者工具电子导诊单复核（2026-09-16 13:58）：进入 `pages/electronic-consultation/electronic-consultation` 后实际看到电子导诊记录、加载更多入口，以及底部“缴费账单 / 病历查询 / 住院预约”三个迁移入口；日志记录 `/appointments/records` HTTP 200。页面仍明确显示旧服务兼容版和实时导诊/执行状态未开放；这不代表独立电子导诊 Provider contract 或临床执行状态已完成。DevTools 同时保留 1 个 `app.json` schema warning（`navigateToMiniProgramAppIdList`），该字段由旧端医保小程序跳转白名单测试和代码使用，暂不擅自删除，纳入后续工具兼容性复核。
- 患者选择页刷新态修正（2026-09-16 14:06）：根据 DevTools 页面复核发现，从新增就诊人页返回时清空目录后曾将 `loading` 提前设为 `false`，会在同步完成前短暂显示“暂无已绑定就诊人”；现改为保持 loading，直接复用带页面令牌的同步流程，并在同步结束后再退出 loading。定向小程序回归 2 pass、0 fail、57 assertions；重新 `build:dev` 和 `runtime:verify:dev` 均通过，development 包更新为 `sourceRevision=workspace-sha256:a103eb598a7e64172bd60ac356694ec0d7f4c218109be43ddef4d2dfa91e2b83`、`generatedAt=2026-09-16T14:06:39.173Z`、52 页。该修正只改善显示时序，不打开患者绑定 gate。
- 患者选择页修正后的全量验证（2026-09-16 14:07）：`pnpm --filter @hospital/miniprogram test` 结果为 439 pass、0 fail、4818 assertions；`runtime:verify:dev` 继续通过。开发者工具重新普通编译后首页可正常加载；本次没有提交实名表单，也没有产生患者绑定写入。
- 当前继续核对（2026-09-16 14:33）：`.env` 中 `ZHONGYANG_PATIENT_BINDING_READY=false`、`ZHONGYANG_PATIENT_DIRECTORY_READY=false`，Provider token 和真实旧服务用户凭证仍未具备；未发送患者绑定写入。P1-01 相关 adapter/服务/小程序定向回归 74 pass、0 fail、1031 assertions；`migration:boundary:audit` 通过 33 个冻结入口，`migration:readiness` 结构审计通过但整体 `passed=false`，原因仍是当前 live 49 页与 development 52 页不一致、无当前候选真机证据、Provider/临床/外部 contract 未确认。该结果只推进事实记录，不打开任何业务 gate。
- 本轮台账复核：默认未设置 `LEGACY_HOSPITAL_ROOT` 时 `migration:audit` 按设计失败；显式设置旧仓库 `/Users/yxswy/Documents/GitHub/hospital` 后通过，确认旧端 64 页面、195 个已挂载路由、87 个客户端 endpoint literal、52 个当前原生页面与迁移矩阵一致；`migration:breadth:audit` 和 development `runtime:verify:dev` 同样通过。该复核不改变 P1-01 绑定开关，也不代表 Provider/真机业务验收。
- 预约历史卡片补漏（2026-09-16 14:40）：静态复核旧端 `my_registration.vue` 确认每张记录卡同时有“预问诊”和“院内导航”；新端此前只渲染前者，现已在 `apps/miniprogram/src/pages/appointment-records/appointment-records.wxml` 补回“院内导航”，复用已有 `onHospitalGuide` 和受控科室位置弹窗。未接动态地图、不导入旧历史、不产生写入；相关 acceptance 已更新并通过。
- development 候选重新生成（2026-09-16 14:40，历史过程）：`pnpm --filter @hospital/miniprogram build:dev` 与 `runtime:verify:dev` 均通过；当时运行包为 `sourceRevision=workspace-sha256:d44d18a28c262e7f622f374c4ab5000b01c33835391315214772bb9cc27e1804`、`generatedAt=2026-09-16T14:40:35.439Z`、`pageCount=52`。该记录对应“院内导航”补漏，不是当前最新候选。

## 当前机器事实

以旧仓库路径显式运行 `pnpm migration:audit`、`pnpm migration:boundary:audit`、
`pnpm migration:breadth:audit`、`pnpm docs:audit` 和 `pnpm migration:readiness` 的
2026-09-19 只读结果为准：

- 旧端实际页面 64 个；当前新端 `app.json` 已注册原生页面 54 个。
- 页面台账状态为 partial=45、replaced=10、surface-only=8、blocked-provider=0、blocked-external=0、excluded=1。
- 旧端 API 挂载路由 195 条，另有 1 个未挂载路由文件；旧客户端抽取到 87 个 endpoint literal。
- 旧客户端行为还包含 websocket=1、mini-program-navigation=6、web-view=3、payment-invocation=3、qr-and-official-account=6、insurance-callback=4。
- 当前不是“64 个页面都完成”，而是 64 个旧入口都在迁移台账中有落点；其中大量落点是安全子集或关闭态。
- 当前台账并未覆盖新 `app.json` 中的 `pages/outpatient-medical-settlement/outpatient-medical-settlement`
  和 `pages/payment-result/payment-result`，因此迁移盘点命令当前以“台账缺 2 个原生页面”失败；这不是把页面删除或把支付能力判定为完成的理由，必须补齐来源、状态、边界和运行包登记。

关键命令的当前结果：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| LEGACY_HOSPITAL_ROOT=/Users/yxswy/Documents/GitHub/hospital pnpm migration:audit | 当前失败 | 64 个旧页面、195 条路由、87 个 endpoint 盘点本身可读，但新端台账漏登记 2 个页面：`outpatient-medical-settlement`、`payment-result` |
| pnpm migration:boundary:audit | 通过 | 33 个冻结入口、陪诊/报告 action 事件绑定和生产源码边界通过；不代表页面后的 Provider/支付业务完成 |
| pnpm migration:fact:audit | 当前工作树未通过 | 该审计要求运行包输入来自干净 Git checkout；本轮用户范围内保留的未提交迁移源码使其按规则停止，不能将 dirty 工作树写成发布事实 |
| pnpm migration:readiness | 结构通过、业务未通过 | 当前 `structuralAuditPassed=true`，但 `businessCompletion.passed=false`；代码就绪域 6、真实证据域 0，当前 live 运行包为 54 页、没有 pending 候选、没有真机证据 |
| `pnpm --filter @hospital/worker test`、住院 domain/adapter/API/小程序定向回归 | 通过 | Worker 86 pass；住院 service 2、adapter 3、domain 2、miniprogram acceptance/dashboard 190 pass；未触碰支付/费用实现 |
| `pnpm test` | 限定阻塞 | 其余测试通过；仅 `apps/api/src/modules/outpatient-payments/service.test.ts` 两个既有测试使用固定 `2026-08-16` 账单日期，在当前 2026-09-16 的服务端 30 天窗口校验中失败。该文件属于费用/账单支付范围，本轮不修改；不能把全 workspace 说成全绿 |
| pnpm migration:breadth:audit | 通过 | 首页/我的入口结构通过；当前报告为 2 个 action 页面、4 个 feature-status 调用、54 个交互页面、4 个主 Tab，不代表服务全部可用 |
| pnpm docs:audit | 通过 | 261 个 Markdown 文档无断链；部分迁移报告仍保留历史 47/52 页口径，必须在 P1-23 中标记或更新 |
| pnpm clinical:contract:audit | 通过但保持关闭 | 门诊记录、住院信息、电子导诊单仍 contract-pending |
| pnpm readonly:audit | 通过 | 6 个低风险业务域的结构闭环通过，不替代 Provider/真机证据 |
| pnpm todo:audit | 通过 | 42 项复选框：已完成 19、未完成 23；P0 已清零；P1 未完成 22 项、P2 未完成 1 项 |

默认 shell 下的 pnpm 命令仍报告 Node engine wanted 24.12.0、当前 v26.8.1；本轮已用显式 Node 24.12.0 完成工具链和小程序运行包复现。外部 Provider、DevTools、真机和生产证据仍不因本地复现而成立。

## 2026-09-19 新增范围的当前状态快照

下表是本次新增五项待办的现状，不把“代码存在”写成“业务已完成”：

| 范围 | 当前代码事实 | 当前证据与结论 |
| --- | --- | --- |
| 支付链路中途退出 | 已有 `/payments/appointments/:appointmentId/payment-exit`；`RegistrationPaymentExitService` 会按预约归属查找自费/医保订单，在未知或已支付状态下保持 fail-closed；小程序对明确取消收银台保留 pending 上下文并尝试服务端退出 | 只覆盖已执行到的明确取消路径。主挂号支付页 `onUnload` 目前只释放页面监听器，不会在页面被销毁时自动完成跨服务退出；应用被杀、网络中断、微信回调已成功但页面消失等场景仍需真实联调和恢复验收。支付/医保 gate 与真实 Provider、微信、HIS 证据仍未打开 |
| 退费 | 已有 `WechatRefund` 状态模型、`0050_wechat_refunds` 台账、Admin 退款查询/发起接口、微信 APIv3 退款/查单 adapter；挂号纯自费取消在订单 `completed` 且退款与 `.15` 回写确认后才取消预约 | 普通微信自费和医保混合现金部分已有管理端代码，但无患者端统一退费闭环；医保 FSI `6203` 目前有 contract/adapter 校验端口，却没有贯穿订单、Worker、HIS/医保最终状态的完整业务编排；2.6.65.7/2.6.65.8 文档仍为 normalized，调用方向、鉴权和未知退款查单未确认 |
| 旧服务迁移完整性 | 旧端 64 页面、195 条挂载路由、87 个客户端 endpoint literal 和 7 类客户端行为已经纳入盘点；新端当前 `app.json` 54 页，33 个冻结入口边界审计通过 | 当前迁移盘点因台账缺少 `outpatient-medical-settlement`、`payment-result` 两个页面而失败；大量页面是 partial、安全子集或关闭态。readiness 结构通过但真实证据域为 0，不能说旧服务已完整迁移 |
| 服务链路与用户体验 | 页面已有 preparing/authorizing/insuring/settling/polling/cash-confirming/self-confirming/success 等阶段文案；订单、幂等键、服务端查单和 pending 恢复已有实现 | 阶段状态尚未形成挂号、门诊缴费、医保混合、退款和 HIS 回写统一的用户状态协议；没有当前候选的 DevTools/真机/服务端同链证据，也没有按“确认中、已扣款待医院确认、退费中、人工复核”统计用户结果。体验优化必须先基于真实失败样本，不能只改文案 |
| 医保结算页费用明细/处方明细 | 当前结算页只展示 6202 返回的费用总额、医保基金支付和现金支付，没有项目级处方明细接口或明细数据模型。现有 `/payments/outpatient/records/:recordId` 虽然是“按 ID 查询”入口，但服务端实际重新读取 2.6.33 待缴/已缴列表，再按平台 opaque `recordId` 匹配；公共 API 也明确不返回项目级明细 | 暂时可用同一患者、同一 `recordId`、同一 `status=unpaid` 的待缴费列表快照展示项目名称、数量、单价等已白名单字段，但这不是 HIS 按订单 ID 查询。需要向 HIS/众阳确认是否有按 `outTradeOrderId/mainId/chargeId/presCode/visitRecordId` 查询处方明细的正式接口、字段契约和与 6201/6202 的关联；未确认前不得把列表摘要标成“正式处方明细”或让明细金额替代 6202 结算金额 |

支付业务的统一完成定义：`wx.requestPayment`/`wx.requestMedicalInsurancePay` 返回成功只代表客户端调起或支付层结果，不能直接显示“挂号成功/缴费完成”。挂号自费必须经过服务端查单、众阳 `.5` 的 `isSettle=1`、HIS 回写和本地终态；医保混合支付必须经过 6201/6202、微信或医保查单、2.27.2.32 和 `.5` 等适用后置证据。任何未知结果都进入 `awaiting_confirmation`/`manual_review`，不得自动重付、盲目关单、重复退款或释放仍可能有效的号源。

## 64 个旧页面逐项落点

机器事实源是 `apps/miniprogram/src/services/legacy-page-catalog.ts:49-548`；旧页面注册源是旧仓库 `hospital-app/src/pages.json:53-96` 及其 subPackages。下面把 64 个非支付旧页面全部列出；支付页面和支付状态由本文后面的 P1-21～P1-25 单独维护，不能用本表的页面落点代替支付完成证据。

| 旧页面 | 当前落点和状态 | 代码证据 / 结论 |
| --- | --- | --- |
| pages/consult/consult.vue | pages/consult/consult，partial | 新端只有预约摘要；实时就诊/WebSocket 仍缺，见 apps/miniprogram/src/pages/consult/consult.ts:169-173,241-281 |
| pages/hospital/hospital.vue | pages/hospital/hospital，partial | 仅固定 HTTPS WebView，见 apps/miniprogram/src/pages/hospital/hospital.ts:1-31 |
| pages/index/index.vue | pages/index/index，replaced | 新首页已存在，未迁移能力仍由状态入口控制 |
| pages/setting/setData.vue | excluded | 旧端测试数据工具，不属于生产业务 |
| pages/user/user.vue | pages/my/my，partial | 我的页面拆为患者、资料、预约历史等安全子集 |
| pagesB/account/follow.vue | pages/official-account/official-account，replaced | 旧端实际主要是静态公众号说明，关注/二维码未形成可靠业务 |
| pagesB/health/admission_preconsultation.vue | pages/admission-preconsultation/admission-preconsultation，partial | 新端是关闭态外壳；旧端有问题配置和提交，旧源码见 hospital-app/src/pagesB/health/admission_preconsultation.vue:117-145,400-420 |
| pagesB/health/blood_pressure_calc.vue、pagesB/health/bmi_calc.vue | pages/health-test/health-test，partial | 新端只做 BMI 公式和血压读数校验，见 apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124 |
| pagesB/health/discharge_followup.vue、pagesB/health/discharge_followup_detail.vue | pages/discharge-followup/discharge-followup、pages/discharge-followup-detail/discharge-followup-detail，partial | 新端已迁移八类表单入口及详情输入/选项交互；出院事件、任务版本、提交和撤回仍关闭，见 apps/miniprogram/src/pages/discharge-followup* |
| pagesB/health/disease_detail.vue、pagesB/health/drug_detail.vue、pagesB/health/health_encyclopedia.vue、pagesB/health/search_result.vue | health-knowledge 原生页面，partial | 新端 API/版本/免责声明骨架存在；旧正文不能直接照搬，旧目录 API 见 hospital-app/src/api/modules/health.ts:79-179 |
| pagesB/health/electronic_bill.vue、pagesB/health/inpatient_payment.vue、pagesB/health/medical_insurance_pay.vue、pagesB/health/outpatient_pay.vue、pagesB/health/outpatient_pay_detail.vue、pagesB/health/payment_cashier.vue | 范围排除 | 全部属于费用/支付/医保/收银台，不在本次 TODO |
| pagesB/health/electronic_consultation.vue | pages/electronic-consultation/electronic-consultation，partial / legacy-compatible | 已按旧端行为读取预约历史并筛选近 30 天，并迁移缴费账单、病历查询、住院预约三个固定入口；复用预约历史不代表独立电子导诊 Provider contract，实时导诊/执行状态仍关闭 |
| pagesB/health/electronic_record.vue | pages/medical-record/medical-record，partial | 新端只有近 30 天门诊摘要；旧端有 out-visit-records 和 out-emrs，见 hospital-app/src/api/modules/medicalRecord.ts:86-127 |
| pagesB/health/gift_electronic_banner.vue、pagesB/health/list_electronic_banner.vue、pagesB/health/record_electronic_banner.vue | pages/gift-banner/gift-banner + pages/convenience-compose/convenience-compose，surface-only | 列表/入口与创建/我的记录动作已收口到共享便民表单；就诊记录选择可读取新服务预约摘要，内容审核、公开列表、提交和历史数据仍关闭 |
| pagesB/health/gift_health_praise.vue、pagesB/health/list_health_praise.vue、pagesB/health/record_health_praise.vue | pages/health-praise/health-praise + pages/convenience-compose/convenience-compose，surface-only | 创建和我的记录动作已收口到共享便民表单；旧表扬信 API 不直接接入，审核、脱敏、提交和历史数据仍关闭 |
| pagesB/health/health_test.vue、pagesB/health/self_test_question.vue、pagesB/health/self_test_result.vue | pages/health-test/health-test + pages/self-test-question/self-test-question，partial/surface-only | 新端保留 BMI/血压安全数值工具、入口和题流交互；题库版本、评分结果、临床建议和旧历史答案不迁移 |
| pagesB/health/inpatient_center.vue | pages/inpatient-center/inpatient-center，partial | 已按旧端查询实现 owner-scoped 住院摘要只读链路；代码依据与剩余 Provider/真机阻塞见 P1-10 及 [`住院episode二次验证-2026-09-16.md`](docs/迁移/住院episode二次验证-2026-09-16.md) |
| pagesB/health/pre_visit.vue | pages/pre-visit/pre-visit，partial | 旧端有六项问题和 saveBeforeVisitRecord 提交，见 hospital-app/src/pagesB/health/pre_visit.vue:89-141,276-291；新端已迁移题目、无/有联动、填写校验和平台预约入口，但提交 contract 关闭 |
| pagesB/health/record_electronic_banner.vue、pagesB/health/record_health_praise.vue | 分别归入上面的礼物/表扬信落点，surface-only | 列出原始页面，不能把记录空态当已完成查询 |
| pagesB/health/report_detail.vue、pagesB/health/report_query.vue | pages/report-detail、pages/report-directory，partial | 新端报告目录、详情和附件代理有代码；真实 LIS/PACS/ECG/PEIS 和资源授权仍待证据，见 apps/api/src/modules/reports/index.ts:43-118、apps/miniprogram/src/services/api-client.ts:3242-3345 |
| pagesB/health/risk_form_fall.vue、pagesB/health/risk_form_pain.vue、pagesB/health/risk_form_pressure.vue、pagesB/health/risk_self_evaluation.vue | pages/risk-evaluation/risk-evaluation，partial | 新端已迁移三类量表题目/选项和本地必填校验；评分阈值、适用人群、结果授权、提交和旧历史不迁移 |
| pagesB/health/webview.vue | pages/smart-customer/smart-customer，partial | 旧通用 WebView 支持 path、完整 url、旧 ticket，见 hospital-app/src/pagesB/health/webview.vue:14-83；新端只承载固定客服地址，见 apps/miniprogram/src/pages/smart-customer/smart-customer.ts:1-31 |
| pagesB/hospital/bloodAppointment.vue | pages/blood-appointment/blood-appointment，partial | 旧页面本身也是固定院区、硬编码患者、空项目和“预约功能开发中”，见 hospital-app/src/pagesB/hospital/bloodAppointment.vue:45-101；没有旧号源接口证据，不应凭空接 Provider |
| pagesB/hospital/confirm_registration.vue、pagesB/hospital/registration.vue、pagesB/hospital/department_select.vue、pagesB/hospital/doctor_card.vue、pagesB/hospital/hospitalList.vue、pagesB/hospital/navigation.vue、pagesB/hospital/registration_detail.vue、pagesB/hospital/timeslot_source.vue | appointment 原生页面，分别 partial/replaced | 预约目录、排班、号源、详情、取消已有新 API；医院/地图仅迁移旧静态行为。旧预约接口见 hospital-app/src/api/modules/appointment.ts:40-72,180-185,283-353,355-393,500-517 |
| pagesB/hospital/registration_medical_pay.vue | 范围排除 | 挂号医保支付属于支付/医保专项 |
| pagesB/hospital/selectPatient.vue | pages/patient-select/patient-select，replaced | 统一患者选择页已替换旧页面 |
| pagesB/patient/agreement.vue、pagesB/patient/doctor.vue、pagesB/patient/patientChange.vue | 协议静态页、我的医生、患者选择，replaced | 协议只读不等于同意；医生关系已有新 API；患者切换统一进入 owner-scoped 目录 |
| pagesB/patient/express.vue | pages/patient-express/patient-express，partial | 旧端列表永远为空且 TODO 查询，见 hospital-app/src/pagesB/patient/express.vue:55-85；新端明确不发物流请求，见 apps/miniprogram/src/pages/patient-express/patient-express.ts:40-47,84-134 |
| pagesB/patient/patient_signature.vue | pages/patient-signature/patient-signature，partial | 旧端使用硬编码患者和未知外部小程序，见 hospital-app/src/pagesB/patient/patient_signature.vue:96-128；新端只读患者并提示尚未开放，见 apps/miniprogram/src/pages/patient-signature/patient-signature.ts:57-61,132-142 |
| pagesB/patient/patientAdd.vue | pages/patient-binding/patient-binding，partial | 新端查档/建档/绑卡链路已有代码；旧端编辑模式仍是 TODO，见 hospital-app/src/pagesB/patient/patientAdd.vue:258-264 |
| pagesB/user/edit_profile.vue | pages/profile/profile，partial | 普通昵称/性别/年龄/邮箱已实现；头像、实名、微信身份不是普通资料 contract |
| pagesB/user/feedback.vue | pages/feedback/feedback，replaced | 旧端只有帮助、客服电话和静态行为，没有真实提交 API；不扩展为虚构工单 |
| pagesB/user/miss_appointment.vue | pages/missed-appointments/missed-appointments，partial | 新端由预约历史状态派生，仍待真实 Provider/公网/真机四方证据 |
| pagesB/user/my_consultation.vue | pages/consultation/consultation，partial / legacy-compatible | 已按旧端页面迁移当前就诊人的过去 120 天历史摘要和患者切换；旧端演示数据不复制，外部问诊会话、正文、附件和实时能力仍待 contract/验收 |
| pagesB/user/my_registration.vue | pages/appointment-records/appointment-records，partial | 历史只读已有代码；支付/退款排除，取消和详情仍需真实验收 |
| pagesB/user/subscription_message.vue | pages/patient-subscription/patient-subscription，partial | 旧端只改内存后 Toast，见 hospital-app/src/pagesB/user/subscription_message.vue:203-214；新端明确固定 enabled=false，见 apps/miniprogram/src/pages/patient-subscription/patient-subscription.ts:68-71,184-187 |

## P0：先修正迁移事实、安全边界和运行包

### P0 迁移审计不能在没有旧仓库时静默通过

- [x] P0-01 修改 tools/migration-inventory-audit.mjs:66-80：LEGACY_HOSPITAL_ROOT 缺失或旧仓库不可读时，CI/发布审计必须明确失败或要求显式的“未提供旧仓库”结果，不能默认 Windows 路径 G:\fuck\hospital 后输出 skipped 并让整体流程看起来通过；在当前旧仓库路径重跑 64 页面、195 路由、87 endpoint 的全量对照。已补 tools/migration-inventory-audit.test.mjs，正向与反向验证均通过。

### P0 入口 gate 必须与实际导航和生产源码一致

- [x] P0-02 修复 pnpm migration:boundary:audit 的 5 条失败规则：陪诊入口改为 companion 状态 gate；报告详情的 report-cloud-image、report-share、report-follow-up 均绑定到真实页面事件，其中分享保持明确关闭态；boundary 审计同时校验 TS 方法和 WXML bindtap；移除生产源码中的冻结字段文字命中。已通过 boundary、breadth、navigation、typecheck 与小程序全量测试（416 pass、0 fail）。

### P0 发布事实文档不能继续引用旧候选

- [x] P0-03 更新 docs/发布/广度优先页面覆盖-2026-08-25.md:1-10 以及引用同一数字的迁移就绪报告/旧页面矩阵：统一写入当前 64 个旧页面、47 个原生页面、partial=35、blocked-provider=0 和当前小程序源码运行输入 revision `fc632b1d6aecb29c101c020fad84897efc673544`；`pnpm migration:fact:audit` 已通过，入口覆盖仍明确不等于业务完成。

### P0 DevTools 实际运行包必须和当前源码一致

- [x] P0-04 在修改任何开放状态前，执行 `pnpm --filter @hospital/miniprogram build:dev` 和 release build，分别通过 `runtime:verify:dev`、`runtime:verify`；历史上一次已验证的 development 与 release 运行包均为 47 页（release sourceRevision=`cba13c71a74022b756144b9c7a61965cd542b1af`、generatedAt=`2026-09-15T19:28:46.660Z`），当前开发包最新复核通过 `runtime:verify:dev`：52 页、sourceRevision=`workspace-sha256:461f40c3ab9859a7a363ceba731fdd5f80190b3ea651546fd47cb464c6765ff9`、generatedAt=`2026-09-16T15:16:37.248Z`；当前 52 页候选尚未重建 release 包，因此不能把历史 47 页 release 包或当前 development 包当作当前候选的 DevTools/真机证据；确认 `project.config.json` 继续指向 `dist/`。

### P0 状态语义要统一为“安全子集/关闭态/待实证”

- [x] P0-05 清理所有把页面壳、测试 fixture、Provider adapter 或静态页面描述成“已完成”的旧文档和状态文案；以 apps/miniprogram/src/services/legacy-page-catalog.ts:1-12、apps/miniprogram/src/services/feature-navigation.ts:154-157 为统一语义。当前统一目录已移除 `已迁移`/`读写已实现`/`全量替换进行中` completion readiness，状态页改为“代码已具备，待实证/安全子集/明确 contract 阻塞”；原生页面台账改为“安全静态子集/只读代码已具备，待实证/读写代码已具备，待实证/页面外壳与关闭态”；`replaced` 机器状态明确只代表原生落点，不代表业务完成。已同步 boundary、coverage、测试 fixture 与迁移文档，并通过 416 项小程序回归、typecheck、boundary、breadth、navigation、catalog 和 diff check。实际请求、成功/空/拒绝/超时、归属、日志、Provider、公网、真机证据仍是后续 P1 放行条件，未因本项放开任何业务；支付保持独立关闭。

## P1：优先迁移旧服务确实存在且新端尚未闭环的业务

### P1 患者身份和患者中心

- [ ] P1-01 完成患者绑定的真实环境验收，不重新设计功能：当前小程序已经从 apps/miniprogram/src/pages/patient-binding/patient-binding.ts:130-163 调用 bindPatientToHospital，API 在 apps/api/src/modules/patients/index.ts:31-96，服务端按查档→建档→绑卡→同步执行，见 apps/api/src/modules/patients/binding-service.ts:220-309 和 packages/adapters/src/zhongyang-patient-binding.ts:205-295。对照旧服务 `hospital-app/src/api/modules/ZY.ts:17-75`、`hospital-app/src/pagesB/patient/patientAdd.vue:81-111,199-256` 已静态确认：身份证派生 birthDate/sex 与旧逻辑一致；新端不再照搬旧端“查档异常即建档”、固定 `cardType=3` 或“身份证号当 cardNo”，而是要求 provider 返回真实 `cardNo`，并保持服务端 owner 隔离、幂等键、查档/建档/绑卡 requestId 和目录同步。新增 fail-closed 规则见 `packages/config/src/index.ts:568-603`：患者绑定还必须配置 HTTPS `LEGACY_PATIENT_AUTH_BASE_URL`，以旧服务用户 JWT/unionId 证明当前 owner，不能用静态众阳 token 代替。2026-09-16 又补齐了绑卡成功后“首次目录确认失败”的安全重试，见 `apps/api/src/modules/patients/binding-service.ts:183-220` 及其测试；重试只读目录，不重复建档/绑卡。本次二次验证记录在 `docs/迁移/患者绑定真实验收复核-2026-09-16.md`，绑定服务/Provider adapter 当前 8 pass、0 fail、31 assertions；API app 当前 55 pass、0 fail、386 assertions；本轮又在 `apps/miniprogram/scripts/acceptance.test.ts:914-954` 锁定页面必须通过 `wx.login` 取得一次性 `legacyLoginCode`，且不得出现旧 JWT 或 Provider 患者号，定向验收 1 pass、23 assertions。无认证卡类型字典只读响应显示当前返回 `hospitalId=10389001`、`orgId=10389`、`cardTypeId=3` 为“身份证”，但仍缺 2.1.52 患者自助授权、查档无记录/重复/超时、建档后绑卡失败补偿/最终查询及真实 owner/Provider/真机响应；因此此项保持未完成和关闭。

- [x] P1-02 完成患者协议旧服务行为核对并收口为只读迁移：旧端只有静态 agreement 页面，新端 `apps/miniprogram/src/pages/patient-agreement/patient-agreement.ts:1-12` 已覆盖原文展示且明确不记录同意。二次对照复核见 `docs/迁移/患者协议同意对照复核-2026-09-16.md`；旧服务没有可迁移的协议版本、同意主体、撤回或审计接口，绑定页布尔 `consent` 只是当前请求准入字段。因此本轮不凭空新增 consent contract、数据库写入或“同意成功”状态；若法律/业务未来确实要求版本化同意，应另立需求并提供责任人、发布版本、授权主体和验收规则。

- [x] P1-03 对照旧服务 `hospital-app/src/pagesB/patient/patientAdd.vue:258-264` 的编辑 TODO、`hospital-app/src/api/modules/ZY.ts:17-75` 的患者接口和 `hospital-app/src/api/modules/user.ts:113-135` 的普通用户资料 PUT，确认旧服务没有患者资料更新/编辑 API：编辑入口只改标题，回填和保存明确是 TODO；因此关闭“迁移旧编辑功能”这一项，不新增患者 update contract，也不把 profile PUT 当患者资料更新。结论已记录在 `docs/迁移/患者绑定契约草案.md` 的“编辑模式”审计补充中；患者新增/绑卡真实验收仍由 P1-01 单独负责。

### P1 预约目录和非支付预约动作

- [ ] P1-04 完成预约目录只读链路的 Provider 对照和真实验收（静态二次审计见 [`预约目录只读对照审计-2026-09-16.md`](docs/迁移/预约目录只读对照审计-2026-09-16.md)，二次验证见 [`预约目录真实验收复核-2026-09-16.md`](docs/迁移/预约目录真实验收复核-2026-09-16.md)）：旧端 `first-depts`、`scheduling-depts`、`scheduling-doctors`、`schedulings`、排班详情和 `sources` 的接口定义见 `hospital-app/src/api/modules/appointment.ts:40-72,75-185,188-353`；实际页面调用见 `hospital-app/src/pagesB/hospital/registration.vue:135-147,186-212`、`department_select.vue:440-458,555-572`、`doctor_card.vue:278-301`、`timeslot_source.vue:98-153`。当前新端路由见 `apps/api/src/modules/appointments/index.ts:84-98,162-232`，adapter 见 `packages/adapters/src/zhongyang-appointments.ts:31-45,1048-1254`，小程序目录/排班/号源页见 `apps/miniprogram/src/pages/appointment-directory/appointment-directory.ts:87-185`、`appointment-schedule.ts:151-348`、`timeslot-source.ts:24-99`。静态代码已核对服务端日期、`Asia/Shanghai`、空结果 fail-closed、60 秒快照 TTL、`usableSourceNum`、时段白名单和 Provider ID 不外泄；本轮又修正 `apps/miniprogram/src/services/dashboard-service.ts` 的排班白名单投影，保留旧 `doctor_card.vue` 真实使用的职称、介绍、专长、科室位置和头像字段，并拒绝非 HTTP(S) 头像 URL；同时将号源页、我的医生详情页接入同一排班/号源 fail-closed 校验，拒绝坏日期/时段、重复号源序号和不受支持的时段组，`dashboard-service.test.ts` 当前 35 pass、0 fail、126 assertions。源码对照已将旧端 `first-depts` 渠道 `3` 与排班科室/医生/排班/号源渠道 `4` 分开落到 adapter；仍需当前 Provider 请求/响应确认渠道含义、名称过滤、日期边界、排班字段和停诊语义，不能把代码对齐当作真实验收。本次隔离执行 adapter 26 项测试、预约 service 29 项测试，均 0 fail；仍缺当前候选版本的 Provider/公网/开发者工具/真机只读证据，故保持未完成。
- P1-04 本轮代码回归补充：预约 adapter、预约 service、dashboard/date/目录视图共 99 pass、0 fail、318 assertions；只证明当前只读代码和白名单边界，不替代 Provider 请求/响应验收。开发者工具二次操作因 macOS 当前锁屏暂停，未新增 UI 业务结论。
- P1-04 渠道对齐补充（2026-09-16）：旧端源码确认 `first-depts` 使用 `requestChannel=3`，`scheduling-depts`、`scheduling-doctors`、`schedulings` 和 `sources/{hisScheduleId}` 使用 `requestChannel=4`；新 adapter 已拆分为目录树 `3` 与排班/号源 `4`，对应回归断言已更新，号源路径编码也已锁定。当前 Provider/院方仍需逐端点确认业务含义、空结果/日期边界和响应等价性；未打开 `ZHONGYANG_APPOINTMENT_DIRECTORY_READY`，P1-04 仍未完成。
- P1-04 运行工具状态补充：锁屏解除后当前前台开发者工具连接的是旧项目 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/dist/dev/mp-weixin`，不是本项目 development 包；本轮不把该旧项目界面作为新服务运行证据，目标包仍以其 `build-info.json` 和既有记录为准。
- P1-04 API 边界回归补充：新增已认证 `/api/v1/appointments/department-tree` 回归，确认预约目录树只返回平台 `groupId/displayName/departmentId` 白名单字段；该测试使用本地替身，不证明 Provider 请求/响应等价，也不改变 `requestChannel`。API app 当前 55 pass、0 fail、386 assertions。
- P1-04 状态迁移补充：对照旧端 `department_select.vue:341-363,386-408`，将 `scheduleStatus===2` 映射为 `availabilityStatus=open`，其它安全整数映射为 `stopped`，缺失为 `unknown`；小程序只有 `open` 且有余号时才进入号源页，Provider 状态类型异常整批拒绝。新增 adapter/目录视图回归后，相关定向测试为 72 pass、0 fail、212 assertions；Provider 渠道冲突、医生接口等价性和真机/真实响应仍待验收。
- P1-04 当前上游只读探针补充（渠道修正前历史证据）：此前通过旧 adapter 对 `first-depts`、`scheduling-depts` 和 `schedulings` 发起无患者字段请求；科室树返回 21 个分组/75 个科室，2026-09-16 单日返回 0 个可预约科室，2026-09-17 至 2026-09-23 返回 61 个，首个科室排班返回 9 条、318 个可用号源且均为 `availabilityStatus=open`。当时排班/号源请求仍使用渠道 `3`，Provider 未返回独立 request ID，adapter 使用探针 trace 回退，不能冒充 Provider 原生 requestId；该结果不证明当前按旧端对齐后的渠道 `4`，本次未打开写入 gate，P1-04 仍缺当前候选 API/DevTools/真机同链证据。
- P1-04 当前渠道 4 只读探针补充（2026-09-17）：对 `ZHONGYANG_BASE_URL` 直接执行无患者字段 HTTPS GET，未注入用户 token，未调用锁号、预约、取消、支付、医保或任何写入接口；`first-depts?requestChannel=3` 返回 HTTP 200、`success=true`、21 个一级目录条目；`scheduling-depts?requestChannel=4&startDate=2026-09-17&endDate=2026-09-23` 返回 HTTP 200、`success=true`、61 个可预约科室；按首个科室请求 `schedulings?requestChannel=4&scheduleType=1` 返回 9 条排班；按首条排班引用请求 `sources/{hisScheduleId}?requestChannel=4` 返回 40 个号源条目。仅记录数量和字段键，不保存原始 Provider 响应。该结果证明当前渠道 4 能返回可解析的目录/排班/号源响应，并与新 adapter 固定渠道一致，但仍不等于正式字段 contract、平台 API 同链、患者归属、DevTools/真机/生产验收；P1-04 继续未完成。
- P1-04 医生接口复核补充（2026-09-17）：同一受控科室对当前上游执行无患者字段 `scheduling-doctors?requestChannel=4&startDate=2026-09-17&endDate=2026-09-23&deptId=<受控科室>` 只读探针，HTTP 200、`success=true`、5 个医生条目；条目及嵌套排班包含旧端医生卡所需的职称、介绍、专长、头像、出诊日、`totalUsableNum` 和 `schedulingList` 字段。当前新端医生模式仍从 `/schedulings` 扁平排班聚合，已覆盖有排班医生展示，但未确认零可约医生及 `totalUsableNum/workDate` 集合是否必须与独立接口完全一致；该差异已记录在 `docs/迁移/预约目录真实验收复核-2026-09-16.md`，不把探针可读或页面可达当作 P1-04 完成。
- P1-04 医生模式功能补齐（2026-09-17）：新增平台只读 `GET /api/v2/appointments/doctor-schedules`（内部 `/api/v1/appointments/doctor-schedules`），真实众阳 adapter 固定调用旧端 `scheduling-doctors` 渠道 4，并在 adapter 内将外层医生字段与 `schedulingList` 展开为现有受控排班模型；小程序“按医生挂号”改用该入口，日期模式继续使用 `schedulings`。医生接口未返回 `scheduleStatus` 时状态保留 `unknown`，医生卡只展示“观测余号”，点击后仍以日期模式重新读取正式排班状态，不能据此直接进入号源或预约。adapter 27 pass、0 fail、69 assertions；预约 service/API 回归与两项小程序定向回归通过（本轮曾发现并修正 service 二次投影会丢失 `availabilityStatus` 的问题，已加入领域白名单保留）；该补齐仍不代表 Provider 正式 contract、平台同链、DevTools/真机/生产验收，P1-04 继续未完成。
- P1-04 新 adapter 真实只读复核（2026-09-17）：使用当前 `ZHONGYANG_BASE_URL`，先读取渠道 4 的排班科室取得受控首个 `deptId`，再由新 `createZhongyangAppointmentGateway().listDoctorSchedules()` 发起 `scheduling-doctors` 请求；未注入患者 token，未调用锁号、预约、取消、支付、医保或其它写入接口。adapter 成功映射 9 条嵌套排班，输出键仅为 `providerScheduleId/departmentId/departmentName/departmentLocation/doctorId/doctorName/titleName/workDate/shiftName/totalSlots/availableSlots/availabilityStatus/timeGroup`，`trace.operation=appointment-doctor-schedules`；未保存原始响应。该结果证明新 adapter 能解析当前上游样本，不替代正式 contract、患者归属、平台 API 同链或真机/生产验收。
- P1-04 当前候选开发者工具只读页面补充（2026-09-16 14:12 CST）：已确认工具打开的是当前源码项目 `/Users/yxswy/Documents/GitHub/hospital-platform/apps/miniprogram`；首页“预约挂号”→院区“去挂号”→`pages/appointment-directory/appointment-directory` 路由可达，页面实际渲染“选择科室”、搜索框和科室列表，日志记录平台 `GET /appointments/department-tree` HTTP 200。该结果仅证明当前候选包的页面/平台读取链路，不证明 Provider、号源或挂号业务完成；本次未触碰锁号、预约、费用、支付，排班/号源的同候选版本证据仍待补齐。
- P1-04 当前候选开发者工具排班补充（2026-09-16 14:14 CST）：从目录选择“内科”→“内科专家门诊”进入 `pages/appointment-schedule/appointment-schedule`；初次加载和一次受控“重新加载”都请求 `GET /api/v2/appointments/schedules?startDate=2026-09-16&endDate=2026-09-23&departmentId=201124`，平台分别返回 HTTP 502，requestId 为 `mp-mu46lzvp-udrqaxdp`、`mp-mu46mbrg-vx4rbc57`。页面两次均展示“预约信息暂时无法获取，请稍后再试”，未把失败转成空排班/号源；未点击号源、确认页、锁号、预约、费用或支付，P1-04 继续保持未完成并待排查服务端/上游。
- P1-04 医生卡展示补漏（2026-09-17）：对照旧端 `department_select.vue:34-91,470-533`，确认旧“按医生挂号”卡片会展示职称以及 `introduce || specialty` 描述；新端排班 contract/domain 已有 `titleName/introduction/expertise`，但原医生卡聚合只展示姓名、头像、余号和日期，导致这些旧字段未落到页面。本轮已在 `AppointmentDoctorCard` 聚合模型和 `appointment-schedule.wxml/.wxss` 中补回受控职称与两行描述，并增加回归断言；`appointment-directory-view` + `dashboard-service` 定向回归 47 pass、0 fail、149 assertions，miniprogram typecheck、`build:dev`、`runtime:verify:dev` 均通过。development 包当前 `sourceRevision=workspace-sha256:828b235b5d6fa8e90dc2cb3eb12d1911dedb00091a749d0c8430543bb22d8750`、52 页。该补漏只修复展示，不打开预约写入；Provider contract、平台同链、DevTools/真机/生产证据仍缺，P1-04 继续保持未完成。
- P1-01 计数修正：P1-01 主条目中保留的 54 pass、384 assertions 是旧记录；新增预约目录回归后，`apps/api/src/app.test.ts` 当前实际结果为 55 pass、0 fail、386 assertions，患者绑定相关结论和未完成门禁不变。

- [ ] P1-05 完成非支付预约写入闭环（静态边界审计见 [`预约写入非支付边界审计-2026-09-16.md`](docs/迁移/预约写入非支付边界审计-2026-09-16.md)，二次验证见 [`预约写入二次验证-2026-09-16.md`](docs/迁移/预约写入二次验证-2026-09-16.md)）：旧端锁号接口声明、费用/执行预约/取消/记录/详情见 `hospital-app/src/api/modules/appointment.ts:355-393,395-517`，实际确认页提交 Provider 患者号、身份、金额、排班号和号源号见 `hospital-app/src/pagesB/hospital/confirm_registration.vue:199-215,237-272`，旧详情取消见 `registration_detail.vue:380-423`；本次检索未发现旧页面实际调用 `lockSourcesApi`。新端已有 POST `/appointments/holds`、`/registrations`、`/registrations/:id/cancel` 和详情 GET，见 `apps/api/src/modules/appointments/index.ts:100-160,234-255`、`apps/miniprogram/src/services/api-client.ts:2786-2831,3014-3066`，服务层/adapter/持久化见 `apps/api/src/modules/appointments/write-service.ts:343-838`、`packages/adapters/src/zhongyang-appointment-writes.ts:448-842`、`packages/persistence/migrations/0024_appointment_writes.sql:1-55`。静态代码已核对 owner/患者/opaque 引用/幂等/过期/条件更新和 Provider ID 不外泄；本轮按旧端源码将号源明细和实际费用读取渠道对齐为 `4`，锁号/预约创建/取消仍分别受当前 contract 或未确认旧端 `requestChannel="my"` 约束；`registerSource` 合同、锁号 TTL/释放、Provider 超时最终状态、重复预约匹配范围仍缺真实证据。adapter 当前 5 pass、0 fail、18 assertions，预约写入 service 当前 5 pass、0 fail、13 assertions，相关小程序回归累计 197 pass、0 fail、2879 assertions；上述测试仍不替代 Provider contract 或真实验收，保持 gate 关闭。支付、医保、退费、HIS 支付回写不在此项。

- P1-05 本轮服务层状态机补测：`apps/api/src/modules/appointments/write-service.test.ts` 新增同键占位幂等/参数冲突、Provider 已有同日同科室预约不重复写入、过期占位转 `expired`、活动自费支付关联禁止取消 4 项；该文件共 5 pass、0 fail、13 assertions。仍只证明平台本地边界，未替代 Provider 合同和真实联调，预约写入 gate 保持关闭。
- P1-05 当前代码回归补充（2026-09-17）：预约写入 adapter 5 pass、0 fail、18 assertions；预约写入 service 5 pass、0 fail、13 assertions；小程序预约相关 acceptance 按 appointment/预约/hold/挂号/cancel/取消筛选为 22 pass、0 fail、259 assertions。未调用 Provider 写入接口，未触发锁号、预约、取消、支付或医保；锁号生命周期、Provider 最终状态、正式渠道合同和真实预约闭环仍未验证，P1-05 继续关闭。
- P1-05 跨系统失败补充（2026-09-17）：状态机复核确认 Provider 锁号或预约创建可能先成功、随后本地 `insertHold/insertRegistration` 持久化失败；当前 `AppointmentWriteGateway` 没有已确认的释放锁号、撤销未落库预约或按幂等键查询补偿 contract，旧端源码也没有可执行的锁号调用/回滚证据。该场景不能用本地幂等键伪装成原子事务，必须先冻结 Provider 补偿/最终状态查询及告警重试规则，再实现跨系统恢复；本轮未调用写入、未改 gate，P1-05 继续保持未完成。
- P1-05 挂号详情导航补漏（2026-09-17）：旧 `registration_detail.vue` 的“就诊地址 → 去导航”动作已补到新端 `apps/miniprogram/src/pages/appointment-detail/appointment-detail.ts/.wxml/.wxss`；新建的 `services/department-location.ts` 与预约记录页共用已审核静态科室位置匹配，精确项优先、无匹配返回空态，不猜测楼层、不接实时路线。小程序预约/导航定向回归 23 pass、0 fail、310 assertions；`build:dev` 与 `runtime:verify:dev` 通过，development 包 52 页，`sourceRevision=workspace-sha256:46cc8052c7905d3aa242dbec8286e07905d2de82555cc1db2b42bd28be07b14c`。本次未调用 Provider 写入、未触发锁号/预约/取消、未导入旧数据；锁号生命周期、跨系统补偿和正式写入合同仍未验证，P1-05 继续未完成。
- [ ] P1-06 完成预约历史和爽约的真实状态对照（静态二次审计见 [`预约历史与爽约记录对照审计-2026-09-16.md`](docs/迁移/预约历史与爽约记录对照审计-2026-09-16.md)，二次验证见 [`预约历史爽约二次验证-2026-09-16.md`](docs/迁移/预约历史爽约二次验证-2026-09-16.md)）：新端 my-registration/missed-appointments 读取 `/appointments/records`，见 `apps/miniprogram/src/services/api-client.ts:2900-2911`、`apps/miniprogram/src/pages/appointment-records/appointment-records.ts:213-318,367-393`、`apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts:106-236`；旧端记录入口与真实标签请求见 `hospital-app/src/api/modules/appointment.ts:395-517`、`hospital-app/src/pagesB/user/my_registration.vue:186-220`、`hospital-app/src/pagesB/user/miss_appointment.vue:208-233`。本轮已修正新端此前两个标签固定 `scope=all` 的偏差，当前按旧语义选择 `online/all`，并确认取消保留、`unknown` 不推断为 `missed`、跨患者/会话守卫的静态实现；本轮进一步按旧端 `my_registration.vue:205-218` 将在线历史窗口改为 `Asia/Shanghai` 前后三个日历月，月底保留 JavaScript 日历月溢出语义，并在 dashboard-service 与 Provider smoke 中补齐回归测试；爽约仍安全限制为过去 90 天，未擅自复制旧端无日期查询。当前仍缺 Provider `endDate` 包含规则、爽约无日期/保留期决策、状态样例、当前候选版本公网/DevTools/真机/生产证据，故保持未勾选。
- P1-06 详情导航补漏（2026-09-17）：旧 `registration_detail.vue` 详情地址区的“去导航”动作已补到新 `appointment-detail`，与预约记录页共用 `services/department-location.ts` 的已审核静态位置匹配；本次只打开位置弹窗，未生成实时路线或猜测未审核地址。小程序预约/导航定向回归 23 pass、0 fail、310 assertions，development 包 52 页并通过运行校验；Provider 状态/日期边界及同候选版本真机、生产证据仍缺，P1-06 继续未完成。

- P1-06 本轮定向回归：预约历史/爽约页面、客户端边界、窗口算法和错误状态共 49 pass、0 fail、330 assertions；Provider smoke 的在线/全部/爽约范围 1 pass、0 fail、16 assertions。仍缺当前 Provider 的 `endDate` 包含规则、爽约无日期/保留期及真实候选版本验收，故不勾选。
- P1-06 当前候选开发者工具只读补充（2026-09-16 14:15 CST）：当前源码项目 `/Users/yxswy/Documents/GitHub/hospital-platform/apps/miniprogram` 的底部“就诊”页已加载 `pages/consult/consult`；日志记录 `GET /appointments/records` HTTP 200，requestId=`mp-mu46nlox-cg4z3b19`。今日页显示“今日暂无预约摘要”，未来页显示“暂无未来就诊记录”，历史页实际展示多条已取消预约摘要及“加载更多就诊记录”。页面明确提示实时就诊状态暂未开放；该结果仅证明当前候选包页面/平台读取链路，不替代 Provider 状态和范围对照，未执行取消、重预约、挂号、费用或支付。
- P1-06 补漏后的源码/运行包复核（2026-09-16 15:08）：已恢复旧端记录卡片中的“院内导航”按钮，并复用当前受控科室位置弹窗；当前小程序回归 439 pass、0 fail、4826 assertions，development 包 sourceRevision=`workspace-sha256:ff6b1500ea1efc9b293ae7077a6ae5727946a0cc7a9e7d292db5437535046c09`、`generatedAt=2026-09-16T15:08:36.533Z`，`runtime:verify:dev` 通过。Provider 状态/范围、DevTools/真机和生产同链证据仍缺，P1-06 继续未勾选。
- P1-06 院区字段补漏（2026-09-17）：对照旧端记录卡实际使用的 `hospitalAreaName`，已将该字段从 Provider adapter、domain/API 白名单校验贯穿到小程序；“我的挂号”显示院区，“爽约记录”把院区与科室位置分开显示。domain/预约 adapter 回归 33 pass、0 fail、89 assertions；预约历史/爽约小程序回归 20 pass、0 fail、245 assertions；相关 domain/contracts/adapters/API 类型检查通过。development 包已重新构建并通过 `runtime:verify:dev`，当前 `sourceRevision=workspace-sha256:b93d161f61ed50ba5fc5ff8b9188fdaf07a64de6da5f91b8b732a71c5c3e0f0b`、52 页。旧历史数据未导入；Provider 状态语义、真实历史记录和真机/生产证据仍缺，P1-06 继续关闭。
- P1-06 详情交互复核（2026-09-17）：重新核对旧端 `my_registration.vue` 卡片点击和 `registration_detail.vue` 展示范围，新端 `appointment-records` 已将当前列表中经 contract 校验的患者、科室、医生、日期、时间、序号、院区位置和状态摘要安全导航到 `appointment-detail`；平台本地预约使用 owner-scoped `appointmentId` 读取真实详情，Provider 历史摘要仅进入只读详情版式，不携带 `patId/appointmentInfoId`，不显示取消或支付动作。预问诊仍只对有平台预约引用的记录开放入口，院内导航复用受控静态科室位置弹层。相关页面回归和类型检查已通过；该项仍缺 Provider 状态/日期边界及同候选版本公网、DevTools、真机、生产证据，旧历史数据未导入。
- [ ] P1-07 完成我的医生关系迁移验收（静态对照见 [`我的医生关系对照审计-2026-09-16.md`](docs/迁移/我的医生关系对照审计-2026-09-16.md)，二次验证见 [`我的医生关系二次验证-2026-09-16.md`](docs/迁移/我的医生关系二次验证-2026-09-16.md)）：旧服务在 `app/api/v1/module_convenience/__init__.py:5-19` 挂载 `MyDoctorRouter`，真实路由/输入/客户端快照行为见旧仓库 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/my_doctor/controller.py:17-63`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/user.ts:38-110` 和 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/hospital/doctor_card.vue:278-306,364-449`；新端 owner-scoped GET/POST/DELETE `/my/doctors` 见 `apps/api/src/modules/my-doctors/index.ts:26-107`、客户端见 `apps/miniprogram/src/services/api-client.ts:2834-2881`。当前静态代码已拒绝旧 `user_id`/医生快照并由未来 7 日排班目录确认字段；本轮在 `apps/miniprogram/src/services/api-client.ts:500-638,2850-3013` 增加列表/详情/取消响应的客户端白名单、重复关系、时间、头像 URL 与 `followed=false` fail-closed 校验，并修正排班投影保留旧 `doctor_card.vue` 实际使用的医生职称/介绍/专长/头像字段；本轮又为 `apps/miniprogram/src/pages/my-doctor/my-doctor.ts` 和 `my-doctor-detail.ts` 接入账号切换清理与新 owner 重读，避免关系卡片、排班和关注态跨账号残留；相关小程序组合回归 233 项通过、3011 assertions。关系服务 5 项测试与小程序相关回归均通过，类型检查 12/12 通过。但旧库存 21 条关系的 owner 映射/不导入决定、关系和医生目录失效规则、旧实际 channel=4 与新 adapter channel=3 的 Provider 对照、空/拒绝/超时、公网/DevTools/真机/生产证据仍缺；不把状态页文案、单元测试或运行包元数据当业务完成。

- P1-07 本轮定向回归：我的医生 API/小程序边界共 6 pass、0 fail、48 assertions，关系服务 5 pass、0 fail、15 assertions。仅证明 owner 归属、快照字段白名单和七日排班边界；旧 21 条关系不导入，Provider/真机/生产证据仍缺，故保持未勾选。
- P1-07 本轮入口收口：`my-doctor-detail` 的排班时段入口现与预约排班页统一要求 `availabilityStatus=open` 且余号大于 0；停诊和待确认状态只展示状态并阻止进入号源页，避免把“有余号”误当作可预约事实。新增小程序源码验收断言；仍不替代 Provider/真机验收。
- P1-07 当前候选开发者工具只读补充（2026-09-16 14:16 CST）：从“我的”页进入 `pages/my-doctor/my-doctor`，页面显示“我的医生 / 关注的医生会持续显示在这里”及无关系空态；日志记录 `GET /my/doctors` HTTP 200，requestId=`mp-mu46pc78-valiew92`。当前没有旧关系被自动导入，也未展示旧医生快照；该结果仅证明当前候选包的平台读取和空态渲染，不替代 Provider 医生目录、关注/取消写入、未来排班或旧 21 条关系迁移，未执行关注、取消或预约。
- P1-07 旧交互补漏（2026-09-16）：旧医生名片存在“查看简介”底部弹层；新端原先直接展示简介但缺少该交互入口，现已增加原生简介弹层、个人介绍/擅长领域分组和关闭动作。内容只来自当前服务端医生读模型，不新增外部请求、不导入旧数据、不改变关注或预约写入门禁；相关 acceptance 已更新。
- P1-07 当前候选重新构建（2026-09-16 15:08）：简介弹层及报告空附件入口补漏已进入用户指定 development 目录；`build:dev`、`runtime:verify:dev` 和类型检查通过，运行包 `sourceRevision=workspace-sha256:ff6b1500ea1efc9b293ae7077a6ae5727946a0cc7a9e7d292db5437535046c09`、`generatedAt=2026-09-16T15:08:36.533Z`、`pageCount=52`。小程序报告详情相关回归 439 pass、0 fail、4826 assertions；仍不代表 Provider、真机或生产业务验收。
- P1-07 院区字段补漏（2026-09-17）：对照旧医生名片排班实际展示，已将 `hospitalAreaName` 从 Provider adapter、预约 domain/contract、客户端白名单贯穿到“我的医生”详情和预约排班列表；缺失时不固定补医院名称。预约 domain/adapter 回归 33 pass、0 fail、89 assertions；预约/我的医生小程序定向验收 21 pass、0 fail、284 assertions；contracts、domain、adapters、API 类型检查通过。随后 `build:dev` 与 `runtime:verify:dev` 通过，development 包为 52 页、`sourceRevision=workspace-sha256:2db0eb0af2d6d8b338e0b2e3ce499dc316e7bf82cf928e7f524dca468969ad6d`、`generatedAt=2026-09-16T16:31:45.333Z`。该补漏不打开关注/预约写入，不导入旧关系或历史数据；关系失效语义、真实关注/取消、Provider/真机/生产证据仍缺，P1-07 继续关闭。
- P1-07 医生详情降级补漏（2026-09-17）：旧端 `doctor_card.vue:248-249,365-380` 中关注状态读取失败不会阻断排班详情；新端此前用 `Promise.all`，关注服务失败会连带隐藏排班。本轮将 `my-doctor-detail.ts` 改为 `Promise.allSettled`：排班读取仍是必要条件，关注列表读取失败只记录转换后的客户端错误并按未关注展示，保持医生简介/排班可用；关注/取消自身仍按独立接口结果反馈。小程序 typecheck 通过，医生/预约目录定向 acceptance 5 pass、0 fail、156 assertions；未调用 Provider、未导入旧关系，关注写入和真实环境证据仍缺，P1-07 继续未完成。
- P1-07 挂号类型名称补漏（2026-09-17）：旧端 `doctor_card.vue:130-132` 在医生排班卡展示 `registerClassName`；新端原先丢失该只读展示字段。本轮仅将该字段按 `registerClassName → registrationClassName` 经众阳预约 adapter、预约 domain/contract、小程序 `dashboard-service` 白名单贯穿，并在预约排班页和“我的医生”详情排班卡展示；未带入旧端 `registrationFee`，不改变关注/预约写入，不导入旧关系或历史数据。相关 adapter、dashboard、页面 acceptance 定向回归 41 pass、0 fail、313 assertions；小程序全量回归 442 pass、0 fail、4862 assertions；`pnpm typecheck` 13/13 包通过；development 包已重建并通过 `runtime:verify:dev`，当前 `sourceRevision=workspace-sha256:ed89df29f00c877e3765ccb198dff0a7a079f6d49aee7f27995239c1ff667cc9`、`generatedAt=2026-09-16T17:59:06.105Z`、52 页。Provider 正式字段合同、DevTools/真机/生产同链证据仍缺，P1-07 保持未完成。

### P1 报告、病历和住院只读

- [ ] P1-08 完成报告目录、四类详情和附件的真实 Provider 验收（静态二次对照见 [`报告目录详情附件对照审计-2026-09-16.md`](docs/迁移/报告目录详情附件对照审计-2026-09-16.md)，二次验证见 [`报告能力二次验证-2026-09-16.md`](docs/迁移/报告能力二次验证-2026-09-16.md)）：旧服务真实调用和未完成分支见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/ZY.ts:80-163`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_query.vue:400-482,539-646`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_detail.vue:365-464`；新端受控 `/reports`、详情和附件代理见 `apps/api/src/modules/reports/index.ts:43-118`、`apps/api/src/modules/reports/service.ts:676-997`、`apps/miniprogram/src/services/api-client.ts:3242-3385`。当前静态代码已具备 owner/patient 隔离、四类候选字段映射、短期 opaque 引用和附件 origin/MIME/20 MiB 边界，本次报告 adapter/service 51 项测试和小程序报告目录/详情 11 项测试均通过；但旧端只有 LIS 详情实际调用，PACS/ECG/PEIS 详情依赖旧快照或明确待完善；四类 Provider 正式合同、PEIS 身份授权、endDate/分页、详情关联、资源 TTL/allowlist、附件 content type/失败、当前公网/DevTools/真机/生产同链证据均缺失，两个 report gate 继续为 false。不得将页面可进入、本地 fixture、空列表、HTTP 200 或运行包元数据写成完成，也不得顺手开放报告解读、分享或自动复诊。
- P1-08 顺序复核补充（2026-09-17）：重新逐项核对旧 `report_query.vue`、`report_detail.vue` 与当前报告目录/详情页，确认当前代码已覆盖旧端实际可核对的四类目录筛选、LIS 检验明细、PACS/ECG/PEIS 的受控通用详情、附件打开和复诊预约入口；旧端分享函数本身只是“待实现”，非 LIS 详情依赖客户端完整快照，不能再按旧快照方式补回。当前未发现可在缺少 Provider/授权/资源合同前安全新增的报告功能；目录/详情/附件 gate 继续关闭，旧报告数据不导入。

- 本轮 P1-08 继续对照旧组件 `hospital-app/src/components/health/patient-hospital-selector.vue:226-229`，确认报告默认范围是当前日往前一个日历月；已由 `apps/miniprogram/src/services/dashboard-service.ts:1337-1364` 和 `apps/miniprogram/src/pages/report-directory/report-directory.ts:44-47` 对齐，并增加 8 月 15 日、8 月 31 日的边界回归。该修正不改变用户自选日期，不打开报告 gate。

- [ ] P1-09 将门诊病历从当前“近 30 天摘要”推进到旧服务确实存在的可授权范围（静态二次对照见 [`门诊病历目录对照审计-2026-09-16.md`](docs/迁移/门诊病历目录对照审计-2026-09-16.md)，二次验证见 [`门诊病历二次验证-2026-09-16.md`](docs/迁移/门诊病历二次验证-2026-09-16.md)）：旧页面实际只调用 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/electronic_record.vue:87-113` 和 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/ZY.ts:124-130`；`out-emrs` 仅在 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/medicalRecord.ts:112-127` 声明，未发现门诊页面实际调用。新端摘要链路见 `apps/api/src/modules/medical-records/index.ts:18-52`、`apps/api/src/modules/medical-records/service.ts:51-189`、`packages/adapters/src/zhongyang-medical-records.ts:16-229`、`apps/miniprogram/src/pages/medical-record/medical-record.ts:91-220`，当前 `ZHONGYANG_MEDICAL_RECORDS_READY=false`。本轮收口 adapter 对异常可选展示字段的 fail-closed 回归，并按旧记录卡补回 `patName/sexName/patAge/maritalStatusName` 对应的患者展示字段到受控 contract 和小程序卡片；domain/adapter/API/小程序相关回归通过。摘要目录的 Provider 正式 contract、患者映射、公网/DevTools/真机/生产同链证据仍缺，正文、结构化内容和附件没有旧页面实际调用/授权依据，不实现、不复用报告数据、不把摘要改名为完整病历。
- P1-09 当前复核（2026-09-17）：重新核对旧 `electronic_record.vue` 的实际字段和新端卡片，未发现新的安全展示缺口；门诊 adapter/API 回归 6 pass、0 fail、17 assertions，小程序门诊病历/临床壳验收 4 pass、0 fail、84 assertions。未调用 Provider、未导入旧病历、未实现正文/附件；`ZHONGYANG_MEDICAL_RECORDS_READY=false` 保持，Provider contract、临床字段责任和公网/DevTools/真机/生产同链证据仍缺。

- [ ] P1-10 完成住院信息独立 episode 只读链路（不含住院支付和日费用；静态对照见 [`住院episode对照审计-2026-09-16.md`](docs/迁移/住院episode对照审计-2026-09-16.md)，二次验证见 [`住院episode二次验证-2026-09-16.md`](docs/迁移/住院episode二次验证-2026-09-16.md)）：旧 API 仅声明 `GET /msun-middle-aggregate-hsz/v1/patients?patId=...`，旧字段和页面数组渲染依据为 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/medicalRecord.ts:129-241`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/inpatient_center.vue:66-238,396-439`，第一条 `patInHosId` 的后续日费用用途仍排除。本轮已据此实现 `packages/domain/src/inpatient.ts:20-337`、`packages/adapters/src/zhongyang-inpatient.ts:16-469`、`apps/api/src/modules/inpatient/service.ts:59-149`、`apps/api/src/modules/inpatient/index.ts:17-44` 以及小程序 `apps/miniprogram/src/services/dashboard-service.ts:759-988`、`apps/miniprogram/src/pages/inpatient-center/inpatient-center.ts:54-211`；只接受 owner-scoped 平台 `patientId`，Provider ID/原始卡号/费用/支付字段不进入公共响应，未知状态和异常字段 fail-closed。相关 domain/adapter/API/config/小程序测试已通过，但 Provider contract/权限、owner 映射实证、episode 规则、字段公开确认、同候选 dist/公网/Provider/真机/生产证据仍缺，`ZHONGYANG_INPATIENT_EPISODES_READY=false`，保持未完成。严禁复用门诊 patientId 推导住院 episode、接受小程序提交 `patId/patInHosId` 或以本项解锁住院支付。
- P1-10 当前复核（2026-09-17）：重新核对旧 `inpatient_center.vue` 的展示范围，确认新端已覆盖旧页安全可核对的住院摘要，不新增旧页已注释的住院预约按钮、日费用或支付动作；住院 domain/adapter/API 回归 7 pass、0 fail、20 assertions，小程序住院/临床壳验收 4 pass、0 fail、84 assertions。未调用 Provider、未导入旧住院数据，`ZHONGYANG_INPATIENT_EPISODES_READY=false` 保持；Provider episode contract/权限、owner 映射、真机/生产同链证据仍缺。

- P1-08～P1-10 本轮定向回归：小程序报告/门诊病历/住院边界 29 pass、0 fail、197 assertions；API 报告/门诊病历/住院服务 31 pass、0 fail、127 assertions；Provider adapter 与住院领域 33 pass、0 fail、83 assertions。结果仅证明当前白名单、owner 映射和 fail-closed 代码，未替代当前 Provider、公网、DevTools、真机和生产同链验收；P1-08、P1-09、P1-10 继续保持未勾选。
- P1-08～P1-10 当前候选关键词定向回归（2026-09-16）：9 个指定测试文件中匹配的报告/门诊病历/住院/患者范围与小程序边界测试共 42 pass、0 fail、326 assertions；未匹配到的测试文件不计入本次统计。该结果仍只证明本地 fixture 和页面边界，不替代 Provider、公网、DevTools、真机或生产证据。
- P1-08 当前候选开发者工具只读补充（2026-09-16 14:17–14:18 CST）：首页“报告查询”已进入 `pages/report-directory/report-directory`，实际渲染日期筛选、报告类型筛选和失败重试入口。一次初次加载及一次受控重试中，部分 `GET /reports` 请求为 200，但 PEIS 子请求 `GET /api/v2/reports?...&kind=peis` 两次均为 HTTP 502，平台 requestId=`mp-mu46qho0-szk92b93`、`mp-mu46qy31-ynlmw1q7`；页面展示“报告暂时未能加载 / 错误码 10800”，没有把部分成功冒充完整目录。未打开详情、附件、分享或复诊，P1-08 继续保持未完成。
- P1-08 当前候选回归复核（2026-09-17）：报告 adapter/API 回归 51 pass、0 fail、173 assertions；小程序报告目录/详情验收 11 pass、0 fail、67 assertions；报告默认日期窗口相关 dashboard 回归 3 pass、0 fail、7 assertions。未调用 Provider、未打开报告 gate、未下载真实附件、未开放分享/复诊，也未导入旧报告数据；当前 development 包已由后续 P1-07 补漏重建并通过 `runtime:verify:dev`，最新指纹见本文件“当前 development 运行包复核”。P1-08 仍等待四类 Provider contract、真实附件授权和公网/DevTools/真机/生产同链证据。
- P1-09 当前候选开发者工具只读补充（2026-09-16 14:19 CST）：首页“门诊病历”已进入 `pages/medical-record/medical-record`，实际渲染当前就诊人、院区、近 30 天说明和重试入口；初次加载及一次受控重试均调用 `GET /api/v2/medical-records`（2026-08-17 至 2026-09-16），平台均返回 HTTP 503，requestId=`mp-mu46sefr-88pldscd`、`mp-mu46sqg1-utpgyavy`。页面两次均展示“门诊病历服务尚未开放 / 错误码 10500”，未伪造摘要或正文；未进入正文、附件或写入动作，P1-09 继续保持未完成。
- P1-09 旧记录卡展示补漏（2026-09-16 15:16）：旧页面实际展示的 `patName/sexName/patAge/maritalStatusName` 已映射为 `patientName/patientSex/patientAge/maritalStatus`，经过 domain、公共 contract、小程序二次白名单后由 `medical-record.wxml` 按字段存在性展示；不接 `regId/patId`，不用于身份匹配或写入。相关 domain 2、adapter 4、API 2、小程序回归 439 项均通过；15:20 重新构建的当前 development 候选已包含该变更。Provider 合同、真实数据、公网/DevTools/真机/生产同链证据仍缺，P1-09 继续保持未完成。
- P1-09 当前顺序复核（2026-09-17）：重新读取旧 `electronic_record.vue`、旧 `ZY.ts` 和 `medicalRecord.ts` 后确认，旧页面实际只有近 30 天 `out-visit-records` 门诊摘要请求；`out-emrs` 仅声明未被门诊页面调用。当前新端已覆盖旧卡片可确认的科室、医生、就诊时间、院区、就诊类型、收费类别、患者展示快照和诊断字段，并按 owner-scoped 患者映射与 30 天窗口 fail-closed；没有发现可在现有 contract 下安全新增的功能。P1-09 定向回归共 13 pass、0 fail、62 assertions：`zhongyang-medical-records` adapter 4/10、medical-records API 2/7、domain 2/6、miniprogram acceptance 2/27、dashboard 3/12。未调用 Provider、未导入旧病历、未实现正文/附件或结构化临床结论；`ZHONGYANG_MEDICAL_RECORDS_READY=false` 继续保持，Provider 正式 contract、真实患者映射、公网/DevTools/真机/生产同链证据仍缺，故不勾选。
- P1-10 当前候选重新构建（2026-09-16 15:20）：已补回旧住院卡的“住院信息”标题、性别、年龄和掩码就诊卡号展示；`build:dev`、`runtime:verify:dev` 通过，当前 development 包为 `sourceRevision=workspace-sha256:058b1c90a85c14e678b43a0174d7cceab4e177d4bf562b6f9d7adf9d51cdd800`、`generatedAt=2026-09-16T15:20:52.257Z`、52 页。Provider contract/权限、owner 映射实证、DevTools/真机/生产同链证据仍缺，住院 episode gate 继续关闭；费用、日费用和支付仍未迁移。
- P1-10 当前候选开发者工具只读补充（2026-09-16 14:20 CST）：首页“住院”→“住院信息查询”已进入 `pages/inpatient-center/inpatient-center`，实际渲染当前就诊人、院区、住院信息/日费用清单标签和关闭态提示；`GET /api/v2/inpatient/episodes` 返回 HTTP 503，requestId=`mp-mu46twhg-wczsjt4r`，页面展示“住院信息服务尚未开放 / 错误码 10500”，没有伪造住院 episode 或日费用数据。未点击日费用、住院预缴、费用或支付，P1-10 继续保持未完成。
- P1-10 当前顺序复核（2026-09-17）：重新核对旧 `inpatient_center.vue` 的展示范围，确认新端已覆盖旧页安全可核对的住院摘要；旧页已注释的住院预约按钮、日费用和支付动作未恢复。定向回归共 14 pass、0 fail、58 assertions：住院 domain 2/6、众阳 adapter 3/10、API service 2/4、小程序住院验收 1/19、临床 contract 与 dashboard 6/19。未调用 Provider、未导入旧住院数据，`ZHONGYANG_INPATIENT_EPISODES_READY=false` 保持；Provider episode contract/权限、owner 映射、真机/生产同链证据仍缺，故不勾选。
- P1-10 旧住院卡展示补漏（2026-09-16）：旧页面实际展示“住院信息”标题、性别、年龄和就诊卡号；新端已补回对应的 `sex`、`age`、`cardNumberMasked` 字段展示，其中就诊卡只显示服务端掩码值，不恢复原始卡号，不新增费用或支付功能。相关小程序静态断言已补齐，住院 gate 仍保持关闭。
- P1-13 当前候选开发者工具只读补充（2026-09-16 14:21 CST）：从“住院”→“入院预约”进入 `pages/admission-preconsultation/admission-preconsultation`，实际渲染当前就诊人、旧端 10 个问题、输入/选项控件、提交按钮和“当前提交接口尚未开放”说明；本次只检查表单，未填写答案、未点击提交、未读写旧答案，只有当前用户上下文 `GET /me` HTTP 200。该结果证明本地表单承载已进入当前候选包，不证明临床问卷写入、住院事件关联或医护读取完成；P1-13 继续保持未完成。
- P1-13 功能复核（2026-09-16 15:24）：重新核对旧端 10 项入院问卷与 6 项预约前问卷，当前新端均保留题目、无/有联动、填写校验和患者/预约上下文；`clinical:contract:audit` 通过但明确 3 个临床域仍为 contract-pending，相关入口边界回归 3 pass、0 fail、101 assertions。没有发现可在缺少问卷版本、患者授权、幂等、撤回和医护读取 contract 时安全打开的提交功能；不读取、不导入旧答案，P1-13 继续保持未完成。
- [ ] P1-11 处理报告详情的云影像、分享、复诊三个实际未完成动作（静态二次对照见 [`报告详情云影像分享复诊对照审计-2026-09-16.md`](docs/迁移/报告详情云影像分享复诊对照审计-2026-09-16.md)，二次验证见 [`报告详情动作二次验证-2026-09-16.md`](docs/迁移/报告详情动作二次验证-2026-09-16.md)）：旧端云影像实际从报告对象取 `reportImgPath/reportPdfPath/pdfUrl` 后直接 `proxyForward`、下载并保存，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_detail.vue:34-51,365-396`，但无资源来源、授权、TTL、Content-Type 或审计 contract；分享函数只是 `showToast("分享功能待实现")`，见同文件 `:398-402`；复诊函数只跳 `/pages/consult/consult`，不携带 report/patient 关联，见同文件 `:184-197,404-409`。新端已具备 owner/patient/session 校验和服务端短期附件代理，见 `apps/miniprogram/src/pages/report-detail/report-detail.ts:96-150,280-368`、`apps/api/src/modules/reports/index.ts:43-73`、`apps/api/src/modules/reports/service.ts:848-997`，本次复核通过报告 adapter/service 51 项测试和小程序报告详情/附件 11 项测试，但云影像真实 Provider 资源映射、公网/DevTools/真机/生产同链证据仍缺；分享保持 feature status 关闭，见 `apps/miniprogram/src/services/feature-navigation.ts:428-434`；复诊仅跳通用预约目录，不自动创建预约，见 `apps/miniprogram/src/pages/report-detail/report-detail.ts:364-368`，不能标为报告复诊已迁移。先冻结资源 allowlist/短期引用、分享受众/脱敏/TTL/防重放/撤回、复诊目标/患者上下文/预约关系 contract，再验收真实链路；不能外发任意图片 URL 或永久分享链接。
- P1-11 云影像优先级补漏（2026-09-17）：复核旧 `report_detail.vue:365-377` 后确认旧端依次赋值 `reportImgPath`、`reportPdfPath`、`pdfUrl`，后出现的非空字段覆盖前者；新端此前错误地优先图片。本轮改为打开 adapter 按旧字段事实排序的第一项（PACS 同时有图片/PDF 时优先 PDF），仍只使用 owner/patient/opaque attachment 服务端代理。分享继续保持关闭，复诊继续只跳通用预约目录；未调用 Provider、未下载真实附件、未导入旧报告数据。报告详情动作 acceptance 8 pass、0 fail、76 assertions，小程序全量回归 442 pass、0 fail、4863 assertions；P1-11 仍等待真实资源合同及同候选版本验收。

- P1-11 本轮行为收口：报告详情顶部云影像入口现按旧端 `reportImgPath → reportPdfPath → pdfUrl` 语义优先选择服务端附件中的图片，无图片时才回退 PDF；客户端仍只提交 opaque `reportId/attachmentId`，不恢复旧 URL 直连。新增小程序源码验收断言；Provider 资源、真机和外部 contract 仍待实证。
- P1-11 当前顺序复核（2026-09-17）：重新核对旧报告详情动作与当前实现，确认云影像仍只从 owner/patient/短期 opaque 引用进入服务端附件代理；PACS 附件按当前 adapter 的受控顺序展示，分享仍为明确关闭态，复诊只进入通用预约目录且不自动创建预约。定向回归共 71 pass、0 fail、320 assertions：报告 adapter 24/57、API service 27/116、小程序报告验收 17/140、报告日期/范围回归 3/7。未调用 Provider、未下载真实附件、未导入旧报告数据；真实资源 allowlist/TTL、分享受众与脱敏、复诊关联、真机/生产同链证据仍缺，P1-11 不勾选。
- P1-11 空附件交互补漏（2026-09-16）：旧端无云影像地址时仍保留入口并提示空结果；新端现不再隐藏入口，无服务端附件时明确提示“暂无可用报告附件”，有附件时继续只走 owner/患者/会话/短期引用保护的代理。验收断言已补齐；未恢复任意 URL 下载或本地长期保存。
- P1-11 LIS 专家意见字段补漏（2026-09-17）：旧端 LIS 明细实际展示 `expertOpinion`（专家意见），已将该可选字段加入报告 detail domain/contract、众阳 adapter 和小程序详情模板，受控上限 4096 字符；缺失时不补值，不改变报告解读、分享、复诊或附件 gate。报告 adapter/domain/API 回归 57 pass、0 fail、187 assertions；报告详情及相关视觉边界小程序验收 12 pass、0 fail、107 assertions；contracts、domain、adapters、API、miniprogram 类型检查通过。随后 `build:dev` 与 `runtime:verify:dev` 通过，development 包为 52 页、`sourceRevision=workspace-sha256:756afd57bc2ad095481c99110490407037ca2492c9d10582beaf1cee4c25e396`、`generatedAt=2026-09-16T16:37:54.129Z`。未调用 Provider、未导入旧报告数据；真实字段责任、附件资源、真机/生产证据仍缺，P1-11 继续关闭。
- P1-11 患者上下文展示补漏（2026-09-17）：旧 `report_detail.vue` 会在图文报告基本信息中展示“患者姓名”；新端详情读取流程本来已完成当前 owner/患者二次校验，但页面没有展示当前已脱敏的患者目录名称。本轮在 `ReportDetailPageData` 和 `report-detail` 页面中增加 `selectedPatientName`，只取当前服务端患者目录的 `displayName`，会话切换/详情错误时清空，并在 WXML 基本信息区按字段存在性展示；不读取旧历史、不使用 Provider 原始姓名、不改变报告详情/附件授权。新增小程序源码断言，定向验收 2 pass、0 fail；类型检查通过，待重新构建 development 包。
- P1-11 当前源码回归与运行包复核（2026-09-17）：报告 adapter/API 回归 51 pass、0 fail、173 assertions；小程序报告相关定向验收 17 pass、0 fail、140 assertions；全仓 `pnpm typecheck` 13/13 包通过。随后已重新执行 `build:dev` 和 `runtime:verify:dev`，用户指定 development 包 `pageCount=52`、`sourceRevision=workspace-sha256:bec20b7c481db6766dca24bf9856c68d068ba38c8344a29c0962acb2c49eb387`、`generatedAt=2026-09-16T17:40:17.166Z`。本轮未调用 Provider、未下载真实附件、未开放分享/复诊、未导入旧报告数据；P1-11 的真实资源、外部 contract、真机/生产证据仍缺，继续保持关闭。

### P1 健康内容与临床问卷

- [ ] P1-12 完成健康百科真实内容迁移，而不是先开放已有页面（静态二次验证见 [`健康百科迁移放行审计-2026-09-16.md`](docs/迁移/健康百科迁移放行审计-2026-09-16.md)，本轮复核见 [`健康百科内容放行二次验证-2026-09-16.md`](docs/迁移/健康百科内容放行二次验证-2026-09-16.md)）：旧 Python 服务真实挂载 `/knowledge/health/*` 目录、症状查病、疾病详情和药品详情，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_knowledge/health/controller.py:15-203`；旧小程序实际调用见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/health_encyclopedia.vue:241-247,280-429`、`search_result.vue:396,834-868`、`disease_detail.vue:172-210`、`drug_detail.vue:129-162`。当前源快照复核仍为 `sourceValid=true`、`publicationState=not-approved`、`publishable=false`，内容 15,668 条，质量告警仍为重复关系 6、控制字符 115、清理字段 10、未定义旧来源 1；严格审计按预期失败。新端 API、bundle validator、bundle check、staging 单事务导入和 published-only repository 的 22 项导入/持久化测试、9 项 API 测试均通过，但独立审核 bundle、内容责任/临床审核、staging 发布/撤回/重叠窗口和 Provider/公网/DevTools/真机同链证据仍缺，患者端继续 fail-closed；不得复制旧快照为 published，也不得把 `knowledge_tips` 混入百科。

- P1-12 当前复核记录（2026-09-16）：用户指定仓库 `pnpm health:source:audit` 默认模式返回 `sourceValid=true`、`publishable=false`；`pnpm health:source:audit -- --strict` 返回 `strictPassed=false` 并退出 1。源快照可审计但仍是 `publicationState=not-approved`，本轮未导入旧内容、未生成审核 bundle、未改变患者端发布 gate；上述 22 项导入/持久化测试与 9 项 API 测试通过，内容责任/临床审核、staging 发布撤回和真机证据仍待补齐。
- P1-12 功能链路复核（2026-09-16 15:22）：健康百科页面的目录、症状查疾病、疾病详情和药品详情入口均已有平台 API 与客户端白名单；API 9 项、客户端健康知识/视图 12 项回归通过。当前源快照 `sourceValid=true`、`publicationState=not-approved`、`publishable=false`，本轮没有安全的代码缺口可继续实现，也没有导入旧内容或开放患者端；P1-12 继续等待审核 bundle、临床审核和发布证据。
- P1-12 首字母索引交互补漏（2026-09-17）：对照旧端症状/疾病列表的首字母分组索引，新端新增 `groupHealthKnowledgeItems`，按服务端 `initialLetter` 分组，缺失值归入末尾 `#`；症状和疾病列表均使用同一分组结构。健康百科视图/API 回归 18 pass、0 fail、49 assertions；domain/persistence 回归 40 pass、0 fail、114 assertions；小程序菜单/健康百科页面验收 2 pass、0 fail、53 assertions。默认 `health:source:audit` 返回 `sourceValid=true`、`publishable=false`，显式 `--strict` 返回 `strictPassed=false` 并退出 1。随后 development 包已重建并通过 `runtime:verify:dev`，当前指纹见本文件“当前 development 运行包复核”。未导入旧内容、未生成 published 版本、未开放患者端，P1-12 继续关闭。
- P1-12 部位已选数量补漏（2026-09-17）：旧 `health_encyclopedia.vue` 的部位菜单会展示每个部位已选症状数量；新端此前仅在底部展示总数。本轮在 `health-encyclopedia.ts` 缓存当前发布版本已加载的“部位 → 症状 ID”关系并计算 `partSelectionCounts`，在左侧按部位显示数量徽标；切换/取消症状会同步更新，疾病 Tab 不展示该徽标。该逻辑不导入旧内容、不改变症状查询 contract；健康百科页面验收 1 pass、0 fail，健康视图 9 pass、0 fail，typecheck、`build:dev` 和 `runtime:verify:dev` 均通过，已进入当前 development 包。
- P1-12 顺序复核补充（2026-09-17）：重新逐项核对旧 `health_encyclopedia.vue`、`search_result.vue`、`disease_detail.vue`、`drug_detail.vue` 与当前健康百科、症状查询、疾病详情和药品详情页面。旧端“去搜索”按钮实际只有“请输入关键词（演示）”Toast，不是可迁移的独立搜索功能；旧疾病详情的概述/病因/症状/检查/预防/治疗内容，新端已按可审计字段展示为连续详情区块，疾病药品入口也已覆盖。旧病因页中的示例比例/机制文案不是可靠内容源，不迁移。未发现可在无审核 bundle、无质量清理和无发布证据前安全新增的功能；继续不导入旧百科数据、不生成 published 版本、不开放患者端内容发布，P1-12 仍等待内容责任/临床审核、staging 发布撤回演练和真实内容验收。
- P1-12 当前顺序复核（2026-09-17）：重新核对旧健康百科目录、症状查疾病、疾病详情和药品详情页面，确认旧“去搜索”仅为演示 Toast，当前新端已覆盖有可靠来源的目录、首字母分组、部位选择计数、症状查询和详情白名单；未发现可在审核 bundle、质量清理和发布证据缺失时安全新增的功能。定向回归共 53 pass、0 fail、209 assertions：domain/import 18/43、persistence 16/62、API 9/32、健康知识视图 9/17、小程序菜单/百科入口 1/55。`health:source:audit` 默认仍为 `publishable=false`，`--strict` 仍按预期失败；未导入旧百科数据、未生成 published 版本、未开放患者端内容，P1-12 不勾选。

- [ ] P1-13 按旧服务真实行为迁移入院预问诊和预约前预问诊（静态二次对照见 [`预问诊迁移边界审计-2026-09-16.md`](docs/迁移/预问诊迁移边界审计-2026-09-16.md)，二次验证见 [`问诊问卷二次验证-2026-09-16.md`](docs/迁移/问诊问卷二次验证-2026-09-16.md)）：旧端入院问卷真实包含 10 个健康史问题，按缓存 `user_id/pat_id` 组装 `content[]` 提交，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/admission_preconsultation.vue:128-203,265-288,340-404`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:389-438`；旧 Python 服务 `/admission-preconsultation` 强制当前用户过滤，并按 `user_id + pat_id` 存在则覆盖、否则新增，模型只有 `user_id/pat_id/content`，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/admission_preconsultation/controller.py:17-48`、`service.py:15-65`、`model.py:9-17`，没有住院事件、问卷版本、撤回或幂等事实。预约前问卷旧端有 6 个自由文本/选择题，使用 `medicalCardNumber/registerId/hospitalId` 调用外部 `POST /msun-hzzn-app-config/v1/saveBeforeVisitRecord`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/pre_visit.vue:80-130,136-167,194-293`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:181-203`；旧 Python 仓库未发现该外部接口实现、版本化题库或成功/超时最终状态。新端入院预问诊已保留 10 项本地填写与完整性校验；本轮新增预约前预问诊原生页 `apps/miniprogram/src/pages/pre-visit/pre-visit.ts`，迁移 6 项题目、无/有联动、当前就诊人和平台预约上下文入口，并将 `appointment-records` 的本地预约记录接入该页；Provider 历史摘要没有平台 `appointmentId` 时明确不进入填写页。定向小程序验收 4 pass、0 fail、107 assertions，页面 typecheck/Biome、development build 和 `runtime:verify:dev` 通过。两个页面提交仍关闭，未调用旧接口、不导入旧答案；仍缺住院事件/预约关系、问卷版本、患者授权、幂等、撤回、医护读取和外部服务真实响应，因此保持未完成。
- P1-13 当前顺序复核（2026-09-17）：重新核对入院预问诊与预约前预问诊的题目、患者上下文、无/有联动和入口边界，确认当前新端只承载旧端可确认的表单交互；提交仍明确关闭，不调用旧 `saveBeforeVisitRecord` 或旧覆盖存储，也不导入旧答案。定向 acceptance 2 pass、0 fail、82 assertions，覆盖临床页面当前患者上下文、会话失效/重试和医疗服务入口。未发现可在住院事件/预约关系、问卷版本、患者授权、幂等、撤回和医护读取 contract 缺失时安全开放的功能，P1-13 不勾选。

- [ ] P1-14 按旧服务真实行为迁移出院随访（静态二次对照见 [`出院随访任务对照审计-2026-09-16.md`](docs/迁移/出院随访任务对照审计-2026-09-16.md)，二次验证见 [`出院随访二次验证-2026-09-16.md`](docs/迁移/出院随访二次验证-2026-09-16.md)）：旧端固定展示 8 套专科/手术表单并调用 `createDischargeFollowUp`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/discharge_followup.vue:136-153,214-250`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/discharge_followup_detail.vue:20-95,140-270`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:318-387`；旧 Python 服务实际按 `user_id + pat_id` 查找并覆盖，模型只有 `user_id/pat_id/table_name/content`，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/discharge_follow_up/service.py:12-67`、`model.py:9-18`，没有出院事件、任务/表单版本、幂等、撤回或医护读取授权。新端已迁移八类表单目录、详情输入/选项交互和本地校验，见 `apps/miniprogram/src/pages/discharge-followup/discharge-followup.ts`、`discharge-followup-detail/discharge-followup-detail.ts`；仍缺唯一出院事件、任务/版本、授权、幂等、撤回、医护读取及 DevTools/真机/生产证据，因此提交保持关闭，不能按旧键迁移或把已完成预约当出院事件。
- P1-14 当前候选开发者工具只读补充（2026-09-16 14:21–14:22 CST）：从“住院”→“出院随访”进入 `pages/discharge-followup/discharge-followup`，页面显示当前就诊人、选择其他就诊人、暂无记录和八类表单迁移说明；`GET /appointments/records` 返回 HTTP 200，requestId=`mp-mu46w35j-b7he8fgc`。当前无已确认就诊记录，未展示旧历史随访，也未进入详情提交；未填写/提交答案。该结果仅证明当前候选包目录/空态和平台读取链路，P1-14 继续保持未完成。
- P1-14 功能复核（2026-09-16 15:25）：出院随访仍按旧端八类表单保留目录与详情入口，但旧服务缺少权威出院 episode、任务/版本、授权、幂等、撤回和医护读取规则；当前无安全依据开放答案提交或导入旧覆盖记录。出院随访相关静态验收 1 pass、0 fail、52 assertions，P1-14 继续保持未完成。
- P1-14 八类表单字段与交互复核（2026-09-17）：对照旧端 `discharge-followup-form*.vue` 的八个 `tableName` 分支，新端 `apps/miniprogram/src/services/discharge-followup-form-catalog.ts` 保留八个表单入口及基本信息、随访内容、单选/多选、文本、日期和二次回访区段；详情页支持当前就诊人、输入、选择切换和至少填写一项校验，提交仍明确未开放且未调用旧 `createDischargeFollowUp`。`native discharge follow-up forms preserve the old component field contract` 1 pass、0 fail、123 assertions（与临床关闭态组合命中 5 pass、0 fail）；仅证明字段目录/本地交互承载，不证明出院 episode、任务版本、临床适用规则、答案读写或真机/生产链路，P1-14 继续保持未勾选。
- P1-14 当前顺序复核（2026-09-17）：重新核对旧八类出院随访表单与当前目录/详情页，确认基本信息、随访内容、单选/多选、文本、日期和二次回访区段均有原生承载；提交仍明确关闭，不调用旧 `createDischargeFollowUp`，不导入旧覆盖记录。定向 acceptance 2 pass、0 fail、79 assertions，覆盖表单字段契约和临床页面当前患者/会话边界。未发现可在出院 episode、任务/版本、临床适用规则、授权、幂等、撤回和医护读取 contract 缺失时安全开放的功能，P1-14 不勾选。

- [ ] P1-15 分开处理风险评估、自测题库和结果（静态二次对照见 [`风险评估与健康自测对照审计-2026-09-16.md`](docs/迁移/风险评估与健康自测对照审计-2026-09-16.md)，二次验证见 [`风险评估与健康自测二次验证-2026-09-16.md`](docs/迁移/风险评估与健康自测二次验证-2026-09-16.md)）：旧风险入口有跌倒/压力性损伤/疼痛 3 类表单，跌倒表单实际组装答案并调用 `createRiskAssessment`；旧 Python 服务按 `user_id + pat_id` 覆盖风险记录。旧健康自测入口展示 9 项，其中 7 项走题库、2 项走计算器；题目和评分来自 7 套 Python 配置。新端已迁移风险量表题目/选项和本地必填校验，以及自测题流的原生题目交互，但评分、临床分级、结果提交和旧历史均关闭；仅 BMI/血压保留 `local-non-diagnostic-v1` 安全数值子集。仍缺题库/规则版本、临床审核、适用人群、患者授权、幂等、撤回/失效、保留审计及 Provider/DevTools/真机/生产证据，不能直接复制旧题库或旧覆盖写入。
- P1-15 当前候选开发者工具只读补充（2026-09-16 14:23 CST）：从“住院”服务进入 `pages/risk-evaluation/risk-evaluation`，实际渲染跌倒、压力性损伤、疼痛三类量表入口；进入跌倒量表后实际渲染旧题目组、选项和“提交评估”按钮，并提示“当前客户端不计算风险等级，提交接口开放前不会保存答案”。本次只检查入口/表单，未填写、提交或保存答案；唯一平台请求为 `GET /me` HTTP 200，requestId=`mp-mu46xrgf-9y6zxxok`。该结果证明题目承载和本地边界已进入当前候选包，不证明临床评分、写入或旧历史迁移，P1-15 继续保持未完成。
- P1-15 功能复核（2026-09-16 15:25）：健康自测的 BMI/血压安全计算器回归 6 pass，风险评估/健康自测入口边界继续保持关闭；未发现可以在缺少题库/规则版本、临床审核、适用人群和结果审计时安全开放的代码功能。旧题库、风险记录和结果不导入，P1-15 继续保持未完成。
- P1-15 入口与题库承载复核（2026-09-17）：旧端 9 个健康自测入口与新端 `apps/miniprogram/src/pages/health-test/health-test.ts` 一致，7 个旧题库在 `self-test-question.ts` 均有对应题目承载；新端仅允许逐题填写和完整性校验，结果按钮明确不生成风险结论，BMI/血压继续走 `local-non-diagnostic-v1` 安全数值子集。相关安全子集/迁移边界回归 12 pass、0 fail、71 assertions；未调用旧题库/评分接口，未写入答案或结果。没有发现应在题库版本、临床审核和结果 contract 缺失时补做的功能，P1-15 继续保持未勾选。
- P1-15 当前顺序复核（2026-09-17）：重新核对三类风险量表、七类自测题流和 BMI/血压工具，确认旧题目/选项已有原生承载；结果按钮仍不生成风险结论，BMI/血压仅保留 `local-non-diagnostic-v1` 数值计算和格式校验。定向回归共 11 pass、0 fail、83 assertions：安全计算器 6/17、医疗服务入口 1/55、临床关闭态 4/11。未调用旧题库/评分接口、未写入答案或结果、未导入旧数据；题库/规则版本、临床审核、适用人群、结果授权和审计 contract 仍缺，P1-15 不勾选。

- [x] P1-16 收口 BMI/血压计算器的安全参考范围（静态二次对照见 [`健康计算器安全子集审计-2026-09-16.md`](docs/迁移/健康计算器安全子集审计-2026-09-16.md)）：旧 BMI 分类/WHO-亚洲-中国参考表和血压分级/“1998 年标准”存在多套规则与适用范围缺口，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/bmi_calc.vue:80-145`、`blood_pressure_calc.vue:80-181`；新端明确只做 `local-non-diagnostic-v1` 的 BMI 公式和血压读数校验，见 `apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124`、`apps/miniprogram/src/services/health-safe-calculators.ts:1-6,10-18,46-115`，本轮补齐公式/范围/golden cases 和临床字段隔离测试。参考计算子集已完成；临床分级、危险值提示或建议如未来需要，必须另行冻结临床规则 contract，禁止把结果写入病历、报告或风险记录。

### P1 便民服务和外部能力

- [ ] P1-17 对照旧电子锦旗和表扬信真实接口，决定是否迁移（静态二次对照见 [`电子锦旗与表扬信反馈对照审计-2026-09-16.md`](docs/迁移/电子锦旗与表扬信反馈对照审计-2026-09-16.md)，二次验证见 [`电子锦旗与表扬信二次验证-2026-09-16.md`](docs/迁移/电子锦旗与表扬信二次验证-2026-09-16.md)）：旧服务真实挂载 `CommendatoryLetter/SilkBanner`，旧客户端有 create/list 和患者/医生/就诊快照入参，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/__init__.py:3-19`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/commendatoryLetter.ts:1-68`、`silkBanner.ts:1-73`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/gift_health_praise.vue:147-239,333-430`。旧服务只校验 `auth.user.id == data.user_id` 后直接新增，患者/就诊/医护快照和 `display_type` 由客户端提供，见旧 `commendatory_letter/service.py:30-76`、`silk_banner/service.py:24-68`、`base.py:7-28`，无审核、公开脱敏、撤回或幂等。新端仅有明确未开放的 convenience surface，见 `apps/miniprogram/src/pages/gift-banner/gift-banner.ts:1-4`、`health-praise.ts:1-4`、`apps/miniprogram/src/services/convenience-surface.ts:21-30,117-177`；本次通过便民页面/迁移边界测试及小程序便民验收，仍缺服务端就诊引用、内容审核、公开脱敏、幂等、撤回、管理端权限和 Provider/DevTools/真机/生产证据；当前不接旧 API、不导入旧历史。

- P1-17 本轮表单补齐就诊记录选择：`convenience-compose.ts` 从新服务 owner-scoped `/appointments/records` 读取当前就诊人记录，选择后自动填充日期、科室和医护信息，并以会话代际守卫防止旧响应回写；小程序验收断言已补齐，随后 development 包已按简介弹层及报告空附件入口补漏重新生成并通过来源校验（当前 `source=workspace-sha256:ff6b1500ea1efc9b293ae7077a6ae5727946a0cc7a9e7d292db5437535046c09`、52 个页面脚本）。报告详情相关回归当前为 439 pass、0 fail、4826 assertions。该功能不导入旧历史、不写旧库；电子锦旗/表扬信内容审核、提交、我的记录和公开列表接口仍未开放，P1-17 保持未勾选。
- P1-17 当前补充回归：原生入口/患者上下文/医疗服务菜单/出院表单契约定向 acceptance 4 pass、0 fail、135 assertions；本轮未开放反馈写入、列表、审核、撤回或公开展示。
- P1-17 当前候选开发者工具只读补充（2026-09-16 14:24 CST）：“便民”菜单可进入 `pages/gift-banner/gift-banner` 和 `pages/health-praise/health-praise`；两页实际展示当前就诊人、月份/公开入口或关闭态，并明确公开列表服务尚未接入、不会发起查询。进入时仅读取 `GET /me`，电子锦旗 requestId=`mp-mu46zjsk-ujzsnc10`、表扬信 requestId=`mp-mu46zu07-3yvous7r`，均 HTTP 200；未调用旧列表/创建接口，未迁移旧四条表扬信和四条锦旗历史，未产生写入。P1-17 按既定决定保持“功能入口已迁移、历史数据不迁移、提交/审核/公开关闭”。
- P1-17 新服务功能链第一阶段（2026-09-16）：新增 `packages/domain/src/patient-feedback.ts`、`packages/persistence/migrations/0048_patient_feedback.sql`、MySQL/内存 repository、`apps/api/src/modules/patient-feedback` 及 `/patient-feedback` GET/POST；创建请求只接受平台 `patientId + appointmentId`，服务端按 owner、当前临床可用患者和已预约记录复核归属，并从预约记录生成科室/医生快照，客户端不能伪造这些字段。新提交默认 `pending_review`，按 owner+幂等键重放返回同一记录；小程序 `convenience-compose` 已接入提交和“我的记录”，敏感正文走受控请求，不接旧 API、不导入旧历史、不向公开列表发布未经审核内容。相关 domain、persistence、API、miniprogram typecheck 通过；API 服务定向回归 3 pass、0 fail。P1-17 仍未完成：审核操作、管理端角色、approved 公开脱敏投影、撤回/保留周期、真实 schema migration/DevTools/真机/生产证据尚未完成，不能勾选。
- P1-17 状态说明：上方早期“提交/记录接口仍未开放”的审计描述保留作为迁移前证据；以本条“新服务功能链第一阶段”为当前状态，后续只继续实现审核、公开脱敏、撤回/留存和相应验收，不恢复旧数据链路。
- P1-17 范围核对补充（2026-09-17）：重新读取旧 Python 的两个 `/list` service/controller 及旧电子锦旗列表页后确认，表扬信和电子锦旗列表都强制按当前登录用户 `auth.user.id` 过滤；电子锦旗列表的月份筛选、赠送记录的患者筛选都不改变 owner 范围。旧端没有可直接迁移的跨用户公共列表接口，页面“公开”/`display_type=1` 不能当作审核通过事实。新端“我的记录”继续使用 owner-scoped 新服务，公共区域继续保持审核投影关闭；本次只补事实记录，不读取、不导入旧历史数据。
- P1-17 范围记录回归（2026-09-17）：`patient-feedback` 服务测试与便民/反馈小程序定向验收共 2 pass、0 fail、35 assertions；`miniprogram:navigation:audit`（52 页）、`migration:boundary:audit`（33 个冻结入口）、`migration:breadth:audit`、`migration:contract:audit`、`error:contract:audit`、`clinical:contract:audit`、`todo:audit` 和 `docs:audit` 均通过。审计通过只证明代码/文档边界，P1-17 仍因审核公开投影、撤回留存、管理端权限及真实环境证据未完成而保持未勾选。
- P1-17 当前服务回归（2026-09-17）：`patient-feedback` 服务与便民小程序组合定向测试 4 pass、0 fail、58 assertions；验证当前预约快照、默认 `pending_review`、患者/已取消预约越权拒绝。当前仍没有审核操作、管理端角色授权、approved 公共脱敏投影、撤回/保留周期及真实数据库/多环境执行证据；不读取、不导入旧历史，P1-17 继续保持未勾选。
- P1-17 当前顺序复核（2026-09-17）：重新核对旧端电子锦旗/表扬信个人列表与新端便民页，确认当前 owner-scoped 个人记录、新服务提交、预约快照填充和默认 `pending_review` 已承载；公共列表、审核、撤回和未经审核的公开展示仍关闭。定向回归共 5 pass、0 fail、53 assertions：patient-feedback service 3/10、便民页面/患者边界 acceptance 2/43。未调用旧接口、未导入旧历史、未开放公开内容；审核角色、approved 脱敏投影、撤回/留存和真实数据库/多环境证据仍缺，P1-17 不勾选。
- 当前 development 运行包复核（2026-09-17）：已按当前源码重新执行 `pnpm --filter @hospital/miniprogram build:dev` 和 `runtime:verify:dev`，通过；包路径为 `/Users/yxswy/Documents/GitHub/hospital-platform/.local/hospital-miniprogram/development`，`build-info.json` 记录 `pageCount=52`、`sourceRevision=workspace-sha256:ef52763b96805467b69bfd5291642a39056c5cac67e9b482cf0b2aee11e67f79`、`generatedAt=2026-09-16T18:05:27.059Z`。这只证明 development 包来源和页面脚本完整，不替代 Provider/审核/真机/生产业务验收。
- P1-01 绑定完成条件补强（2026-09-17）：修正“Provider 绑卡成功 + 目录同步返回空列表”可能被误报成功的风险。`PatientBindingGateway` 现在返回仅限服务端使用的 HIS 患者引用；绑定后必须通过 owner-scoped `resolvePatientByProviderReference` 反查 `his-patient` 映射，目录未出现时只重试同步，不重复建档/绑卡，最终未确认则返回 `provider-response-invalid`。内存/MySQL 仓储、绑定服务和回归已同步；相关定向测试共 56 pass、0 fail、192 assertions，API/持久化/小程序 typecheck 均通过。当前 `.env` 绑定与目录 gate 仍为 false，未发送真实绑定请求，P1-01 继续未完成。
- P1-01 完整回归补充（2026-09-17）：API 全量测试 232 pass、0 fail、825 assertions；持久化全量测试 142 pass、0 fail、956 assertions；小程序全量测试 439 pass、0 fail、4836 assertions；API、持久化和小程序 typecheck 均通过。本轮实际改动文件的 68 个源码/测试文件经 Biome 格式复核通过，`git diff --check`、`todo:audit`、`docs:audit`、`migration:boundary:audit` 通过。全仓 `format:check` 仍受未改动文件的 12 处格式差异影响，未把它误写成全仓格式通过；真实 Provider/owner/真机/生产证据仍缺，P1-01 继续关闭。
- 本轮 TODO 顺序复核汇总（2026-09-17）：从 P1-05 继续核对预约写入与 P1-06 历史/爽约后，完成 P1-11 报告详情字段补漏及 P1-12～P1-17 已有安全功能承载复核；没有新增旧数据导入、Provider 写入、支付/医保调用或临床结果开放。小程序全量回归 442 pass、0 fail、4856 assertions；报告 adapter/API 51 pass、0 fail、173 assertions；报告相关小程序定向验收 17 pass、0 fail、140 assertions；`pnpm typecheck` 13/13 包通过；`todo:audit`（37 项，19 done/18 open）、`docs:audit`（258 文档）、`migration:boundary:audit`（33 门禁）、`migration:breadth:audit` 和 `git diff --check` 均通过。当前仍有 18 项未完成，全部对应真实 Provider/临床审核/外部主体/生产运行证据或明确关闭态，不把静态页面和本地测试写成业务完成。
- [ ] P1-18 完成患者签名的外部主体和授权核对（静态二次对照见 [`患者签名外部主体对照审计-2026-09-16.md`](docs/迁移/患者签名外部主体对照审计-2026-09-16.md)，二次验证见 [`患者签名外部主体二次验证-2026-09-16.md`](docs/迁移/患者签名外部主体二次验证-2026-09-16.md)）：旧端直接调用 `navigateToMiniProgram`，硬编码 `appId=wx0b76c9904392518f`，不设 path，并把 `patientId/patientName` 放进 `extraData`，成功回调为空，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/patient/patient_signature.vue:104-130`；旧端患者列表还带默认伪患者和 `BOUND_PATIENTS` 任意字段映射，见同文件 `:97-101,139-149`。新端只读取 owner-scoped 脱敏患者目录，点击仅选中并提示未开放，不调用外部小程序，见 `apps/miniprogram/src/pages/patient-signature/patient-signature.ts:21-47,70-126`、`patient-signature.wxml:20-77`。本次通过患者签名小程序验收和患者签名覆盖断言，仍缺目标主体、path、最小字段、一次性短期会话、回跳、失败/撤回、文件安全和审计协议；不能恢复硬编码 appId 或外发内部患者标识。
- P1-18 本轮定向回归：患者签名验收 1 pass、0 fail、11 assertions；与实时/固定 WebView 边界组合回归 2 pass、0 fail、16 assertions；Provider 文档接收审计通过。确认新端仍只展示 owner-scoped 脱敏患者并保持关闭态，未恢复旧外部小程序跳转；目标主体、path、短期签名会话、回跳和签名结果仍未确认，故不勾选。
- P1-18～P1-20 当前边界回归（2026-09-17）：患者签名、实时就诊、固定互联网医院/客服 WebView、原生智能导诊组合回归通过；`consult` 未恢复 WebSocket/旧 token/patId URL，患者签名未恢复外部小程序，通用动态 URL/旧 ticket/平台 token 未外发。上述仅证明当前安全入口和关闭态，不证明外部主体、回跳、事件、生产域名或真机业务完成，P1-18～P1-20 继续保持未勾选。

- [ ] P1-19 恢复旧就诊页的实时能力前先冻结独立 contract（实时能力复核见 [`实时就诊对照复核-2026-09-16.md`](docs/迁移/实时就诊对照复核-2026-09-16.md)，二次验证见 [`实时就诊二次验证-2026-09-16.md`](docs/迁移/实时就诊二次验证-2026-09-16.md)）：旧端今日就诊确实连接 `VITE_APP_WS_API + /webSocket/online/message`，把 token 和 `patId` 放入 URL/Authorization，解析 `messages` 并对叫号通知查询队列位置，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/ws.ts:1-128`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pages/consult/consult.vue:214-287,320-337,430-433`；但没有可核验的消息版本、事件 ID、游标补偿、患者/就诊事件绑定和订阅授权 contract。新端 `apps/miniprogram/src/pages/consult/consult.ts:169-173,236-291` 只有 owner-scoped 预约历史摘要，WXML 明确标注实时状态暂未开放，见 `apps/miniprogram/src/pages/consult/consult.wxml:1-62`。本次通过就诊摘要边界和小程序实时关闭验收，仍缺队列/叫号事件、认证、患者映射、游标补偿、断线重连、保留周期、临床状态脱敏、Provider/DevTools/真机/生产证据；不能复制旧 URL token/patId 或用预约摘要冒充实时就诊。
- P1-19 当前候选开发者工具只读补充（2026-09-16 14:15 CST）：从底部“就诊”进入 `pages/consult/consult`，页面实际显示今日/未来/历史三标签；今日和未来为空，历史展示预约摘要、医生、地点、日期、时间、就诊序号和已取消状态。平台 `GET /appointments/records` HTTP 200，requestId=`mp-mu46nlox-cg4z3b19`；页面明确提示实时状态暂未开放。本次未建立 WebSocket、未查询队列、未提交医疗动作，该结果不开放 P1-19。

- [ ] P1-20 对照旧通用 WebView 的真实入口并完成外部边界（静态二次复核见 [`外部入口与通用WebView对照复核-2026-09-16.md`](docs/迁移/外部入口与通用WebView对照复核-2026-09-16.md)，二次验证见 [`外部入口与通用WebView二次验证-2026-09-16.md`](docs/迁移/外部入口与通用WebView二次验证-2026-09-16.md)）：旧 `pagesB/health/webview.vue` 同时承载智能客服、`outpatient-guide`、患者绑定/解绑 URL 和 `/system/auth/ticket`，传入完整 URL 时直接 decode 后追加 ticket，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/webview.vue:26-83`；互联网医院另有固定 H5，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pages/hospital/hospital.vue:13-29`。新端智能导诊已改为原生文字/语音 API，见 `apps/miniprogram/src/pages/smart-guide/smart-guide.ts:176-237`、`apps/api/src/modules/intelligent-guide/index.ts:46-97`，客服/互联网医院只保留固定地址，见 `apps/miniprogram/src/pages/smart-customer/smart-customer.ts:1-28`、`apps/miniprogram/src/pages/hospital/hospital.ts:1-31`，不接受任意 URL/path、不传平台 token、不复用旧 ticket。本次通过固定 WebView/原生导诊验收和旧入口目录断言，仍缺按 audience 分开的域名 allowlist、短期会话、回跳/退出、失败、外部主体和真机/生产证据；当前保持各自外部 contract 未完成。
- P1-20 当前候选开发者工具只读补充（2026-09-16 14:30 CST）：当前源码项目为 `/Users/yxswy/Documents/GitHub/hospital-platform/apps/miniprogram`；点击底部“互联网医院”后进入 `pages/hospital/hospital`，实际加载固定 WebView 并跳转外部 OAuth，随后显示“无法获取用户身份：登录的微信号未绑定为公众号网页开发者”。这是开发者工具模拟身份/外部公众号授权限制，仅证明固定入口和失败态可见，不证明正式业务域名、外部主体登录、回跳、退出或互联网医院业务完成；本次未输入患者信息或提交业务动作。首页“互联网医院”卡片另实际进入新端 `pages/hospital-list/hospital-list` 院区选择，按当前入口代码单独记录，不推断外部 H5 已完成。

P1-18～P1-20 当前源码定向回归（2026-09-16）：患者签名关闭边界、实时就诊关闭态、固定 WebView 和智能导诊共 3 pass、0 fail、64 assertions；只证明当前安全入口/关闭态和原生导诊页面边界，不证明外部主体、短期会话、回跳、WebSocket 事件或真机/生产链路已验收。

P1-18～P1-20 当前顺序复核（2026-09-17）：重新核对患者签名、实时就诊、固定互联网医院/客服 WebView 和原生智能导诊边界，确认 `consult` 未恢复 WebSocket/旧 token/patId URL，患者签名未恢复外部小程序，固定 WebView 未接受任意 URL、旧 ticket 或平台 token。定向回归共 22 pass、0 fail、590 assertions：签名/实时/WebView/导诊 acceptance 5/81、旧页面台账 13/498、临床 contract 4/11。未调用外部签名主体、未建立实时事件连接、未导入旧数据；主体/path/短期会话/回跳、事件 contract、正式域名及真机/生产证据仍缺，P1-18～P1-20 不勾选。

## P2：补齐“旧端本来没有”或工程上仍缺失的边界决策

### P2 不把旧端占位误写成待迁移业务

- [x] P2-01 对 patient-express 做结论性收口：旧端只有本地 BOUND_PATIENTS/CURRENT_PATIENT、固定假患者和空数组，查询位置是 TODO，见 hospital-app/src/pagesB/patient/express.vue:55-85；新端对此已正确保持不发请求。二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`。除非业务方提供真实物流 Provider、患者归属、状态字段和保留策略，否则不要实现快递接口；拿到材料后再从 status-only 改为真实只读。

- [x] P2-02 对 patient-subscription 做产品决策：旧端“确定修改”只 Toast 并返回，没有微信订阅授权或服务端保存，见 hospital-app/src/pagesB/user/subscription_message.vue:203-214；新端 enabled 固定 false 是正确防伪。二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`。只有拿到模板 ID、授权时机、业务事件、发送回执、撤销状态和 owner 规则后才新建 contract，否则将其标记为旧端假功能而非迁移缺口。

- [x] P2-03 清理 patient-address 的迁移假象：当前 FeatureKey 在 apps/miniprogram/src/services/feature-navigation.ts:21-25、migration-coverage.ts:126-130 中存在，但旧 64 页面和旧 action inventory 中没有 patient-address；旧仓库也没有患者地址管理 API/页面。已在 `apps/miniprogram/src/services/feature-navigation.ts:251-259` 明确标为“未来新需求”，并由 `apps/miniprogram/src/services/migration-coverage.test.ts` 锁定无旧来源断言；详见 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`，不得因为有 FeatureKey 就实现地址业务。

- [x] P2-04 对 bloodAppointment 做同样的事实收口：旧页只有硬编码患者、固定院区、空态和“功能开发中”，见 hospital-app/src/pagesB/hospital/bloodAppointment.vue:45-101；当前页也只读取患者并进入状态页，见 apps/miniprogram/src/pages/blood-appointment/blood-appointment.ts:103-150。结论和二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`；没有旧 Provider 号源/预约行为时不凭空实现；如果医院确有采血业务，另行取得业务来源和 contract。

### P2 工程和数据连续性

- [x] P2-05 补齐非支付旧数据连续性方案：当前数据切换决策是新库冷启动，不自动导入旧用户、患者关系、预约存量、便民历史或健康知识历史，见 docs/迁移/数据切换决策-2026-08-31.md:7-26；已对照旧服务和当前 hp_* 表逐域决定导入、只读兼容、人工复核或不迁移，覆盖患者关系、我的医生历史、报告引用、便民历史和已完成健康内容。已记录旧便民 42 行、健康知识 15,668 条的来源指纹、数量、目标写入为 0 和无写入回滚基线，见 [`非支付存量连续性复核-2026-09-16.md`](docs/迁移/非支付存量连续性复核-2026-09-16.md)。本项完成的是安全处置方案，不代表历史已迁移或患者端可见；未来导入仍需业务/数据/安全/临床审批和受控 staging。

- [ ] P2-06 给已存在代码的低风险域补真实证据包：患者目录、普通资料、预约目录/历史、我的医生、报告目录、门诊摘要目前都有 TypeScript/API/测试落点，但 apps/api/src/index.ts:92-118,186-295 明确按配置状态 fail-closed。本轮已整理六个域的代码测试结果、当前 dist/source 候选漂移和待采集字段，见 [`P2-06低风险域证据包状态-2026-09-16.md`](docs/迁移/P2-06低风险域证据包状态-2026-09-16.md)；历史机器可读发布基线为 `ce1c217/38 页`，上一版本地 dist 为 `cba13c71…/47 页`，当前 development dist 最新已重建为 52 页，sourceRevision=`workspace-sha256:058b1c90a85c14e678b43a0174d7cceab4e177d4bf562b6f9d7adf9d51cdd800`；九域 pending manifest [`真机证据-07ab94c3-pending.json`](docs/发布/真机证据-07ab94c3-pending.json) 仍是历史候选记录，不能冒充当前候选证据，`release:baseline:index:audit` 仍拦截漂移。每个域仍需同一候选版本的客户端 requestId、服务端 requestId/traceId、Provider 结果摘要、空/拒绝/超时、会话切换和真机截图。没有真实证据时状态保持代码已实现/待实证。
- P2-06 当前候选复核（2026-09-17）：development 包 `build-info.json` 当前为 52 页、`sourceRevision=workspace-sha256:07c39f3b0358e9733f457f1fd304bde88a13bf6b65abfef0acdf992829565c1f`；`migration:readiness` 真实证据域仍为 0，六个低风险域继续代码已具备/待实证；`release:baseline:index:audit` 仍因 live 包与当前基线索引 sourceRevision 不一致而失败。`todo:audit` 通过（37 项、19 完成、18 未完成、无结构失败）。本次未修改发布基线、未连接生产数据库、未采集或伪造同链证据，P2-06 继续保持未勾选。
- P2-06 当前环境复核（2026-09-17）：实际 development 包 `build-info.json` 当前为 52 页、`sourceRevision=workspace-sha256:cc0fba37652238c28c6583e8215d009f8a26ac147e94ae6d81751403e1c3423b`；`migration:readiness` 报告真实证据域为 0、当前 live 运行包为 49 页且未与基线索引一致，`release:baseline:index:audit` 仍 fail-closed。已检查本机运行面，CUI 状态显示没有可用原生应用，原因是 Mac 当前锁定，无法采集微信开发者工具/真机截图或客户端 requestId；未连接生产数据库、未调用 Provider、未伪造证据，P2-06 继续保持未勾选。
- P2-06 当前 development 重建（2026-09-17）：重新执行 `pnpm --filter @hospital/miniprogram build:dev` 与 `runtime:verify:dev` 均通过；包路径为 `/Users/yxswy/Documents/GitHub/hospital-platform/.local/hospital-miniprogram/development`，`pageCount=52`，`sourceRevision=workspace-sha256:cc0fba37652238c28c6583e8215d009f8a26ac147e94ae6d81751403e1c3423b`，`generatedAt=2026-09-16T19:02:16.148Z`。这只证明当前源码与 development 包一致，不替代 live/基线对齐、Provider、DevTools、真机或生产证据；P2-06 继续未勾选。

- [x] P2-07 固定 Node/Bun/pnpm 运行环境并补发布复现记录：仓库声明和 CI 已统一为 Bun 1.4.0、Node 24.12.0、pnpm 11.9.0；已显式使用机器上安装的 Node 24.12.0（默认 shell 仍为 v26.8.1）执行 `pnpm toolchain:audit`、`build:dev`、`runtime:verify:dev`、release `build` 和 `runtime:verify`，均通过。release/development 均为 47 页、453 个文件，release 来源为 `cba13c71a74022b756144b9c7a61965cd542b1af`，文件树指纹和构建输出见 [`工具链复现记录-2026-09-16.md`](docs/发布/工具链复现记录-2026-09-16.md)。本项完成的是本地工具链/运行包复现，不代表 DevTools、Provider、真机或生产验收完成；这些继续按独立证据包处理。

- [x] P2-08 为 94 个小程序页面源文件建立按业务域的真机回归矩阵：已逐项覆盖 `app.json` 的 47 页及其 `.ts/.wxml` 源文件，区分 `代码具备/待实证`、`安全静态/关闭`、`写入前受控` 和范围排除；固定 S0-S9 场景覆盖登录/退出、无患者、换患者、会话失效、Provider 503、空列表、超时、页面返回和 `dist` 实际加载。矩阵见 [`小程序页面回归矩阵-2026-09-16.md`](docs/迁移/小程序页面回归矩阵-2026-09-16.md)，并明确临床、外部、患者绑定、报告附件的 `600` 受控证据边界。`pnpm miniprogram:navigation:audit`（47 页）、`pnpm miniprogram:patient-display:audit`（94 个源文件）和 `pnpm migration:breadth:audit` 均通过；本次已用 Node 24.12.0 重建当前运行输入对应的 dist，release 来源为 `cba13c71`，但仍没有本文候选的 DevTools/真机/Provider/生产同链证据，因此矩阵内业务行保持 pending，不把矩阵建立或运行包复现误写成业务验收完成。本轮未触碰支付/医保/收银台/费用页面或相关代码。

- [x] P2-09 复核健康知识中的 `knowledge_tips`：二次核对确认旧 Python 确实存在 `knowledge_tips` 表和认证后的 `GET /knowledge/tips/{id}`，字段为 `id/title/content/status`，见旧服务 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_knowledge/tips/model.py:11-21`、`controller.py:13-29`；但旧小程序“指标解读”实际在 `hospital-app/src/pagesB/health/health_test.vue:154-271` 使用 10 项本地硬编码内容，没有发现调用该接口，不能把两个对象强行关联。新端导出器仍在 `packages/persistence/scripts/health-knowledge-source-export.ts:91-99,516` 将其列为 `ignoredLegacySources`，bundle/API 没有 `tip` 类型或路由。结论、数据范围/内容责任/临床审核/版本发布阻塞和未来输入已记录在 [`健康贴士来源与范围复核-2026-09-16.md`](docs/迁移/健康贴士来源与范围复核-2026-09-16.md)；在取得真实使用关系、脱敏数据指纹、责任人、审核和撤回 contract 前不实现、不导入、不塞入疾病/药品正文，也不因此开放健康内容。

> 数据口径修正（2026-09-16）：P2-07/P2-08 中早先记录的 47 页、94 个源文件和历史 release 信息仅代表当时的历史构建；当前 development 包已按最新源码重建为 52 页、104 个页面源文件，`runtime:verify:dev` 通过，sourceRevision=`workspace-sha256:058b1c90a85c14e678b43a0174d7cceab4e177d4bf562b6f9d7adf9d51cdd800`。52 页候选尚未重建 release 包，也没有新增 DevTools/真机/Provider/生产同链证据，不能把该修正当作业务验收完成。

> 本轮处理记录（2026-09-16）：按 P1-17 → P1-18 → P1-19 → P1-20 顺序继续核对。P1-17 已完成新服务电子锦旗/表扬信的 owner-scoped 提交、预约归属复核、幂等重放和“我的记录”第一阶段；公开列表、审核、撤回/留存和管理端权限仍关闭，旧历史数据不导入。P1-18 保持外部签名入口关闭，未恢复旧端硬编码 appId、患者 ID/name `extraData` 或未知 path；P1-19 保持实时就诊关闭，未复制旧 WebSocket token/patId URL；P1-20 保持固定 WebView/原生导诊边界，未恢复任意 URL、旧 ticket 或动态外部跳转。相关定向测试均通过；当前 development 包已重新生成并通过 `runtime:verify:dev`，sourceRevision=`workspace-sha256:1e49137`（完整值以 `.local/hospital-miniprogram/development/build-info.json` 为准）。`pnpm todo:audit` 通过，37 项中 19 项已完成、18 项仍待真实 Provider/外部主体/临床或真机证据；本记录不把本地测试、HTTP 200 或运行包生成当作业务验收。
>
> P1-17 功能补充（2026-09-16）：新服务个人记录查询已补齐旧服务的筛选语义：`donateDate=YYYY-MM-DD` 精确匹配、`donateDate=YYYY-MM` 按月匹配，`displayPublic` 公开标志筛选；领域校验、内存/MySQL仓储、API query 和小程序客户端均已同步，并增加日期索引；定向服务测试 3 pass、0 fail、8 assertions，API/持久化/小程序 typecheck、Biome、development build 和 `runtime:verify:dev` 均通过。公开审核投影、撤回/留存及真实环境证据仍未完成。
>
> P1-17 记录分页补充（2026-09-16）：按旧记录页的 `page_no/page_size` + 触底加载行为，将新 API 对应为 `pageNo/pageSize`（默认 1/50，最大 100），响应补充 `pageNo/pageSize/hasMore`；小程序“我的记录”首屏读取第一页并支持触底加载更多，切换患者/会话时清理分页状态。服务端定向测试 3 pass、0 fail、10 assertions；小程序 typecheck、Biome、acceptance、development build 和 `runtime:verify:dev` 通过。旧历史数据仍不读取。
>
> P1-01 真实环境只读核对（2026-09-16）：当前实际 `.env` 的 `ZHONGYANG_PATIENT_BINDING_READY=false`，`ZHONGYANG_PATIENT_DIRECTORY_READY=false`，`ZHONGYANG_AUTHORIZATION_TOKEN` 为空；`ZHONGYANG_BASE_URL=https://gpsrmyy.meiyi.pro`、`LEGACY_PATIENT_AUTH_BASE_URL=https://test-hp.meiyi.pro` 仅记录为配置来源，不执行外部调用。`pnpm provider:audit` 通过的是 7 份材料已登记，但 `confirmedDocumentCount=0`、`businessReady=false`；`pnpm migration:readiness` 也显示 D 批次 `awaiting-patient-contract`，P1-01 真实 owner/Provider/真机证据仍缺。为防止在未确认主体和授权下创建/绑定患者，本轮不执行真实绑卡写入；保留已有代码测试和关闭门禁，不勾选 P1-01。

> P1-13 题目/交互复核补充（2026-09-17）：重新按旧端源码逐项核对后，入院预问诊 10 题的题序、性别/年龄/关系控件、五项健康史“无/有”及详细输入联动，与新端 `apps/miniprogram/src/pages/admission-preconsultation/admission-preconsultation.ts/.wxml` 一致；预约前预问诊 6 题的题序、两项自由文本、四项“无/有”、输入自动选“有”和“无”清空输入，与新端 `apps/miniprogram/src/pages/pre-visit/pre-visit.ts/.wxml` 一致。定向 acceptance 5 pass、0 fail、112 assertions；本次未读取/回填旧答案，未调用旧保存接口，未复制 `user_id/pat_id`、`medicalCardNumber`、`hisRegisterId` 或旧 URL。没有发现可在临床 contract 未注册时安全开放提交的代码缺口，P1-13 继续保持未勾选。

## P3：后台运营和长期维护

### P3 后台能力不能只看患者小程序

- [x] P3-01 做旧后台系统管理域的迁移决策和实现排期：旧 FastAPI 总路由把 system、monitor、common、application、convenience、intelligent、knowledge 全部挂载，system 还包含 auth/user/role/menu/dept/position/dict/params/notice/log；当前新 API system 只有 ping，管理端只有认证兼容、日志和范围外管理入口，不能称为旧后台已迁移。已逐模块记录旧路由数量、当前承接状态、保留/新建/下线决策和 A0-A5 实现排期，见 [`后台系统管理域迁移决策与排期-2026-09-16.md`](docs/迁移/后台系统管理域迁移决策与排期-2026-09-16.md)。本项完成的是决策和排期，不代表后台 user/role/menu/dept/position/dict/params/notice 已实现；实际实现仍需责任人、RBAC、数据保留、staging 和生产验收。支付/医保管理入口由 P1-21～P1-25 独立管理，仍未开放。

- [x] P3-02 补齐后台监控、任务、文件和便民运营闭环，或形成明确不迁移记录：旧 monitor/application/common/convenience 的真实路由、当前新管理端缺口、旧服务保留边界、非支付文件/便民处置、删除与数据保留规则及解锁条件已记录在 [`后台监控任务文件与便民运营不迁移记录-2026-09-16.md`](docs/迁移/后台监控任务文件与便民运营不迁移记录-2026-09-16.md)。本项完成的是当前范围内的“不迁移记录”，不代表后台运营闭环已实现；若确认仍在生产使用，必须另行补 RBAC、审计、列表/详情/处理状态、失败重试和 staging/生产验收。支付/医保/结算 common 路由由 P1-21～P1-25 独立管理，仍未开放。

- [x] P3-03 建立迁移清单和实际代码的持续一致性门禁：已将 migration:audit、migration:boundary:audit、migration:contract:audit、migration:fact:audit、todo:audit、runtime:verify、clinical:contract:audit、readonly:audit、provider:audit、页面/患者显示审计、文档和工具链检查纳入根 `pnpm check:candidate`，GitHub CI 统一执行该命令；并在 [`迁移一致性持续门禁-2026-09-16.md`](docs/发布/迁移一致性持续门禁-2026-09-16.md) 记录每次页面、FeatureKey、旧接口矩阵或 dist 变化需同步来源 revision、旧页面状态、五类验收状态和未验证项。本项完成门禁配置，不把门禁通过写成 Provider、真机、生产或支付验收。

## P1：支付、迁移完整性与用户体验

### P1-21 处理支付链路中途退出但挂号或缴费已经成功

- [ ] P1-21 建立挂号、自费缴费、医保支付和混合支付的“中途退出/页面销毁/回调不确定”闭环：当前服务端已有 `POST /payments/appointments/:appointmentId/payment-exit` 和 `RegistrationPaymentExitService`，会按预约归属收敛自费订单、医保订单和预约状态；自费退款要求订单已确认完成，医保或混合支付在状态未知、已支付或现金已扣款时保持 fail-closed。小程序对明确的微信取消、医保授权取消会保留 pending 上下文并请求服务端退出，`payment-state.ts` 也已定义 `created → authorized/pre_settled/insurance_submitted/cash_pending → cash_paid → his_written_back → completed` 等状态。但 `registration-payment` 页的 `onUnload` 目前只释放监听器，不会在页面被系统销毁、应用被杀、网络中断或回调已成功而页面消失时自动完成服务端收敛；现有本地测试也不等于微信、Provider、HIS 的真实最终状态。

  实施边界和顺序：

  1. 先冻结订单主键、预约主键、`outTradeNo`、医保 `tradeNo/mixTradeNo`、`requestId/traceId` 和当前支付状态的来源；每次恢复必须先查服务端，不得以本地 pending 或客户端回调单独判断“未支付”。
  2. 为明确取消、返回、超时、页面销毁、应用重启、网络 5xx、微信支付成功但未回到页面、医保授权成功但现金阶段未完成分别定义幂等的 `payment-exit`/`resume` 行为；未知状态只能进入 `awaiting_confirmation` 或人工复核，不能直接关闭订单、释放号源或重新发起支付。
  3. 将挂号、自费门诊、医保纯支付、现金+医保混合支付和从预约记录进入的补缴入口统一到同一状态协议；服务端负责查询、取消、退款、预约取消和 HIS/医保回写顺序，客户端不自行拼接多次关闭或退款。
  4. 对“已经成功但页面退出”提供恢复页：显示确认中、已扣款待医院确认、退费中或需要人工处理，并提供查状态入口；在最终状态明确前禁止重复付款。
  5. 只在服务端最终确认后释放预约号源；任何取消/退款失败都保留订单和 pending 证据，展示下一步，不以页面返回或 Toast 当作成功。

  必须覆盖的验收场景：

  - 预支付前返回、关闭弹窗和切换患者：不得生成可支付孤儿订单或误取消他人预约。
  - 微信/医保授权取消、微信回调超时、网络断开和 HTTP 5xx：可重进恢复，且不会重复支付。
  - 微信侧已成功但小程序未收到回调、应用被杀、页面 `onUnload`、系统切后台再恢复：服务端查单后分别进入已完成、确认中、失败或人工复核。
  - 6201/6202 已提交、现金阶段未完成、2.27.2.32 或 `.5 isSettle=1` 已完成：不得盲目取消；必须按真实最终性和补偿顺序处理。
  - 双击支付、重复返回、重复 `payment-exit`、重复查单和多个设备恢复：结果幂等，日志能按订单和请求关联。
  - 已完成后用户主动取消：先走受控退款和 HIS/医保回写，再取消预约；任一环节未知则保持人工复核，不释放错误状态。

  完成证据：补齐状态转移表、API/客户端 contract、幂等键和补偿规则；补充 API、Worker、domain、mini-program acceptance；使用当前候选运行包完成 DevTools/真机网络故障和进程终止测试；对每次调用保留受控的入参 JSON、返回 JSON、状态查询和日志完整性摘要。必须分别证明微信侧结果、Provider/医保结果、HIS `.32/.5` 最终性和小程序页面结果，不能把 HTTP 200、`wx.requestPayment` 成功、混合单成功或页面跳转当作结算完成。未完成以上证据前，本项保持未勾选。

### P1-22 建立普通支付、医保混合支付和 HIS 退款的统一退费闭环

- [ ] P1-22 补齐退费的业务边界、患者入口、管理端、Worker 查单和 Provider/HIS 最终状态：当前已有 `WechatRefund` 状态模型、`hp_wechat_refunds` 表、微信 APIv3 退款/查单 adapter、受保护的管理端发起/查询接口；挂号自费取消路径会在订单完成后先退款，确认退款与 `.15` 回写，再取消预约；医保混合支付已有现金部分退款的管理端服务。但目前没有患者端统一的退费申请/状态/结果闭环，没有专门的退款对账/重试 Worker，医保 FSI `6203` 只有 contract/adapter 校验端口，尚未串成订单、医保、HIS、预约和支付结果的完整业务编排；外部材料中 2.6.65.7/2.6.65.8 的方向、鉴权、金额单位和查单语义也仍未确认。

  退费模型和实施顺序：

  1. 先按业务来源拆分普通微信自费、医保混合现金部分、医保纯支付和 HIS/Provider 退费，不允许用一套“微信退款成功”文案覆盖所有来源。
  2. 固化原订单、可退金额、已退金额、退款原因、患者/预约归属、`merchantRefundNo`/幂等键和资金去向；服务端以分为单位校验金额，保留部分退、全额退、并发退和金额超限拒绝记录。
  3. 采用 `requested → processing/unknown → query → success/closed/abnormal/manual_review` 的状态机；请求超时或结果未知时复用同一退款记录查单，不能再次创建第二笔退款。
  4. 明确退款成功、退款确认中、退款异常、需人工复核的客户端展示和管理端处理；退款未最终确认前，不得把预约标为已取消、把 HIS 标为已退或删除原支付证据。
  5. 由 Worker 或受控任务持续查退款状态，具备最大重试次数、退避、告警和人工接管；补齐 Provider/HIS 回写的正向、失败和回滚记录。
  6. 患者端只允许退当前 owner 可见且确实可退的订单；管理员接口继续使用独立权限、金额上限和审计，不把管理端 token 暴露给小程序。

  必须覆盖的验收场景：普通自费全额退、混合支付只退现金部分、医保/HIS 退费、部分退、重复点击、同幂等键并发、请求超时、退款状态未知、Provider 返回异常、退款金额超过可退金额、退款成功但后续 `.15`/HIS 回写失败，以及退款已成功后重复查单。每个场景都要核对订单状态、可退余额、预约状态、医保状态、HIS 状态、患者端展示和审计日志。

  完成证据：提供退款 contract、状态转移/金额守恒表、患者和管理端 API、Worker 查单记录、Provider request/response 受控证据、HIS/医保最终性证据和失败恢复演练；明确 6203、2.6.65.7/2.6.65.8 是否采用、由哪个系统发起、谁是最终权威。未确认外部契约前，不新增真实退款按钮，不执行不可逆退款写入。

### P1-23 审查旧服务到新服务的迁移完整性

- [ ] P1-23 完成旧服务页面、API、客户端行为、支付专项和文档口径的逐项迁移复核：2026-09-19 只读盘点得到旧端 64 个页面、195 条已挂载 API 路由、87 个客户端 endpoint literal，以及 websocket=1、mini-program-navigation=6、web-view=3、payment-invocation=3、qr-and-official-account=6、insurance-callback=4；新端当前 `app.json` 为 54 个原生页面。页面台账现状为 partial=45、replaced=10、surface-only=8、blocked-provider=0、blocked-external=0、excluded=1，表示“有落点/安全子集/关闭态”，不表示 64 个旧入口的业务等价已经完成。

  当前明确阻塞：显式设置 `LEGACY_HOSPITAL_ROOT=/Users/yxswy/Documents/GitHub/hospital` 运行 `pnpm migration:audit` 时，台账漏登记 `pages/outpatient-medical-settlement/outpatient-medical-settlement` 和 `pages/payment-result/payment-result` 两个新页面；`migration:boundary:audit` 33 项通过，`migration:breadth:audit` 通过，`docs:audit` 261 篇文档无断链，但 `migration:readiness` 仍为结构通过、业务未通过，代码就绪域 6、真实证据域 0，当前没有真机证据。部分历史迁移报告仍使用 47/52 页旧口径，必须在本项内标注历史或更新，不能与当前 54 页事实混用。

  复核顺序：

  1. 把两个遗漏页面补入旧来源、页面矩阵、Feature/route、边界审计、readiness 和运行包登记，并明确挂号结算页与支付结果页的职责边界。
  2. 对 64 个旧页面逐项比对旧源码实际行为、新页面/服务落点、状态（replaced/partial/surface-only/excluded）、Provider/外部 contract、读写风险、owner 归属和真实证据；“页面能打开”不得自动改成 replaced 或完成。
  3. 对 195 条旧路由、87 个客户端 endpoint 和六类特殊行为逐项核对新 API、adapter、domain、persistence、权限、字段白名单、错误态、幂等和日志；特别复核支付/医保/HIS 相关的 F 批次，不与普通非支付迁移混在一起。
  4. 检查旧页面入口、患者切换、会话失效、WebView、WebSocket、外部小程序、回调、二维码/公众号和数据连续性；旧端假功能、静态壳和本地保存要记录为“无需迁移”或“新需求”，不能凭空实现。
  5. 同步所有发布、迁移、运行包和审计文档的当前数字，保留历史快照但明确日期和不可作为现状依据的范围。
  6. 在当前候选源码和 `apps/miniprogram/dist`/development 运行包上分别验证，不手工编辑生成目录；没有 DevTools/真机/Provider/HIS 证据的业务项继续保持待实证。

  交付物为一张可追溯差距矩阵，至少包含：旧路径/接口、旧行为、新落点、状态、contract/版本、读写风险、owner/患者边界、代码测试、运行包 revision、Provider/外部/真机/生产证据、未验证项、下一步和停止条件。完成标准是审计命令重新通过、台账与 `app.json`/API/客户端行为一致、历史口径已隔离、每个业务域有明确“已完成/安全子集/待实证/关闭/不迁移”结论；不以代码量或页面数量宣称迁移完成。

### P1-24 检查服务链路并持续优化用户体验

- [ ] P1-24 建立跨挂号、门诊缴费、医保、混合支付、退款和迁移页面的一致用户体验协议：当前挂号支付页已经有 preparing/authorizing/insuring/settling/polling/cash-paying/self-paying/self-confirming/success 等阶段文案，且部分路径会保存 pending 并恢复；但各业务的“支付成功”“确认中”“已扣款待医院确认”“退费中”“人工复核”仍未统一，DevTools/真机现状也没有当前候选的业务证据。

  优化范围：

  1. 把服务端状态映射为用户可理解且不误导的状态：准备支付、授权中、医院结算中、现金支付中、结果确认中、已完成、已扣款待医院确认、退费处理中、退费成功、退费异常、需要人工处理；错误提示同时说明是否可以重试、是否禁止再次付款以及如何恢复。
  2. 统一返回、关闭、切后台、应用重启、网络断开和会话过期的处理：保留必要 pending，`onShow` 先查服务端，未知状态不清本地凭据、不重新支付、不释放号源；用户主动切换患者或预约时明确提示当前订单风险。
  3. 统一金额和业务身份展示：金额只能来自服务端可信字段，清楚区分 6201/6202、6301、2.27.2.32、`.5 isSettle=1` 和普通微信订单；展示挂号费、医保支付、现金支付、已退金额和待退金额，避免把支付层成功显示成 HIS 结算成功。
  4. 保证支付方式选择只是更新选择状态，只有用户明确确认后才发起支付；防止双击、重复授权、重复退费和多页面同时操作，并为不可逆动作保留确认弹窗和结果页。
  5. 统一患者、预约、订单和会话切换的归属校验；离开当前患者时不能带走上一位患者的 pending/订单，也不能因为本地缓存缺失而遗忘服务端仍在确认的订单。
  6. 建立低敏可观测性：用 `requestId/traceId/orderId/providerRequestId` 串起客户端、API、Worker、Provider 和 HIS 结果，记录耗时、重试、状态转换、用户可见结果和人工接管原因，不在普通日志写入身份证、支付密钥或完整原始报文。
  7. 用当前候选运行包进行真实可用性回归：首次支付、返回恢复、支付取消、网络故障、后台恢复、重复点击、退费查询、空数据、失败和人工复核；记录用户看到的页面、按钮是否可用、文案是否与最终状态一致和恢复耗时。

  完成证据：提交状态-文案-操作权限映射表、关键页面交互截图/录屏、客户端/API/Worker 日志关联样例、可用性测试矩阵和问题闭环；分别报告源码、运行包、DevTools/真机、Provider、微信和 HIS 的证据边界。若某链路仍无最终状态，不得用“体验优化完成”覆盖业务风险，必须保留确认中/人工复核入口。

### P1-25 补齐医保结算页费用明细（处方明细）来源和 HIS 接口确认

- [ ] P1-25 为门诊医保结算页补齐可追溯的费用明细/处方明细读取方案：当前 `apps/miniprogram/src/pages/outpatient-medical-settlement/outpatient-medical-settlement.ts` 只消费 6202 的 `totalFen`、`insuranceFen`、`cashFen`，页面没有项目级费用明细数据结构和明细 API；当前公共 API 的 `GET /api/v2/payments/outpatient/records/{recordId}` 虽然支持按平台 `recordId` 查询单笔费用，但 `apps/api/src/modules/outpatient-payments/index.ts` 的 `detail()` 实际会再次调用列表查询，再按 opaque `recordId` 匹配并返回已核对的摘要，代码注释已经明确“没有项目级费用明细 contract”。

  当前已确认的来源和限制：

  - 当前众阳 adapter 使用 2.6.33 门诊费用列表路径 `/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records`，按服务端患者映射、时间窗口、`tradeStatus` 和 `authSysCode` 查询；待缴费使用 `tradeStatus=1`，已缴费使用 `tradeStatus=3`，不是按平台 `recordId` 或小程序订单号直查。
  - 列表条目已经有经白名单投影的 `itemName`、`spec`、`quantity`、`unitName`、`priceFen`、费别、优惠金额、自付比例、账单时间等字段；`recordId` 是由 `mainId/chargeId/chargeCode/presCode/visitRecordId` 等 Provider 身份字段和患者引用计算出的平台 opaque 标识，不能反向当作 HIS 订单号或处方号使用。
  - 6202 结算金额仍是支付和金额展示的权威来源。待缴费列表中的项目金额只能用于明细展示或比对，不能由小程序自行累加后替代 6202，也不能把列表变更、缺项或过期快照当作已结算事实。
  - 当前临时方案是复用同一患者、同一 `recordId`、同一查询快照下的待缴费列表数据，展示已有白名单字段；如果列表重新读取，必须由服务端按 owner/patient/record/status 再次校验，不能只相信客户端缓存。若条目不存在、身份冲突、金额与 6202 不一致或列表发生变化，应显示“费用明细已更新，请刷新确认”，停止继续展示可能错误的处方明细。

  HIS/众阳接口核查必须向对方确认，而不是从字段名推断：

  1. 是否存在按照 `outTradeOrderId`、`mainId`、`chargeId`、`chargeCode`、`presCode`、`visitRecordId` 或 HIS 就诊号查询单笔处方/费用明细的正式接口；平台 `recordId` 是内部 opaque 值，不能直接作为对方接口 ID。
  2. 明细接口属于 2.6.33、6201 费用上传前置接口、6202 结算接口还是其它 HIS 服务；请求方向、认证方式、`authSysCode`、患者引用、时间窗口、订单状态和是否需要授权码必须取得正式材料和样例。
  3. 返回是否能明确关联 6201 的费用上传、6202 的结算分项、医保基金支付、个人账户支付、现金支付、优惠/减免、处方号、项目号、数量、单位、单价、执行科室/医生和退款状态；同时确认元/分单位、舍入规则和处方多项目金额守恒。
  4. 明确处方明细在待缴费、已生成结算、已支付、退款中、已退款、作废和订单确认中各状态下是否可查；确认结算后明细是否冻结，还是必须保存平台费用快照以保证结果页可重现。
  5. 取得至少一笔受控的脱敏请求/响应和字段字典，核对同一笔费用在列表、明细、6201、6202、微信/医保订单和 HIS 最终结算之间的关联，不把“接口 HTTP 200”当作明细契约已确认。

  实施顺序：

  1. 先实现临时只读 fallback：由服务端提供与待缴费列表同源的明细投影或保存本次列表快照，结算页明确标注来源；支付金额继续只读取 6202，明细只作展示和核对。
  2. HIS 方确认正式接口后，再新增独立的处方明细 adapter、domain contract、API 和小程序读模型；不得把 Provider 原始响应整包透传，也不得让页面提交 Provider 患者号、处方号或订单号。
  3. 明细查询必须校验当前登录用户、当前就诊人、门诊记录/订单归属、状态、版本和幂等/请求关联；患者切换、会话切换、重复请求、超时和接口未知结果不能回写到旧页面。
  4. 明细金额与 6202 总额、医保基金、现金支付、优惠减免保持可核验关系；发现缺项、重复项、金额不守恒、处方归属不一致或状态不明时 fail-closed，不显示“已确认处方明细”。
  5. 经过 DevTools/真机和受控 HIS 同链验收后，才能决定是否把 fallback 替换为正式 HIS 明细；如果 HIS 没有该接口，则把“待缴费列表快照”固化为正式降级 contract，并在页面和文档中明确其不是 HIS 实时处方详情。

  必须覆盖的验收场景：有效处方多项目、单项目、同一订单多处方、列表中项目缺少可选字段、项目金额为零或小数、医保/现金/优惠金额守恒、待缴费列表更新后重新进入结算页、已支付或退款状态、重复/未知项目 ID、患者切换、会话过期、Provider/HIS 超时、明细接口返回空结果、明细与 6202 不一致，以及付款成功后结果页重新打开。任何场景都要分别记录列表来源、明细来源、6202 金额、订单/就诊关联、requestId/traceId/providerRequestId 和最终页面状态。

  完成证据：HIS 正式接口材料及字段字典、脱敏 request/response、列表与明细关联矩阵、费用金额守恒测试、API/adapter/domain/小程序回归、当前运行包校验、DevTools/真机截图和医保结算同链结果。未得到 HIS 方明确接口或正式降级 contract 前，本项保持未完成，不把待缴费列表查询描述成“按 ID 查询处方明细”。

## 已确认不作为本次 TODO 的事项

- 本文件原有的非支付逐页矩阵不在每一页重复展开支付；支付、医保、退费、收银台、门诊/住院支付、支付订单、微信支付/医保回写和支付相关 HIS 证据已转入 P1-21～P1-25 独立管理。真实写入仍未通过 gate，不能因为进入本文件就被视为已完成。
- pages/setting/setData.vue 是旧测试数据页，明确 excluded。
- 旧 hospitalList.vue 和 navigation.vue 目前证据只支持单院区静态卡片、静态地图、预览；新端的静态替换已完成。动态医院、院区、路线、楼层定位若将来需要，必须另立新业务 contract，不能写成旧迁移遗漏。
- 旧 feedback.vue 没有真实提交 API；当前静态帮助/拨号替换满足旧的可执行行为，不新造客服工单。
- 旧 express.vue 是空列表预留，不存在可迁移的物流查询实现。
- 旧 subscription_message.vue 是本地假保存，不存在可迁移的微信订阅链路。
- patient-address 在旧 64 页面和 action 清单中没有来源，不属于旧服务迁移。
- 旧 my_consultation.vue 的演示数据和外部问诊入口不能用预约历史顶替；本轮仅提供明确标注为兼容版的当前患者过去 120 天历史摘要，不代表旧外部问诊 API、会话、正文或附件已迁移；外部主体、归属、会话和保留规则确认前继续维持关闭。

## 每项完成标准

完成任一 TODO 时，必须在对应项下补充：旧源码行为和新源码落点；contract/字段白名单/版本；请求与响应样例的受控存放位置；服务端和 Provider requestId/traceId；成功、空、拒绝、超时、会话切换和越权结果；小程序 dist/runtime 校验；真机或生产验收结论；未验证项和回滚方式。不得只把页面打开、单元测试通过或 HTTP 200 写成业务完成。

支付与退费项还必须补充：订单/预约/患者归属、支付或退款幂等键、状态转移、金额守恒、微信/医保/Provider/HIS 各自的最终性证据、未知状态处理、重复操作保护、Worker 查单/告警和人工接管记录。`wx.requestPayment`、医保授权回调或退款申请返回成功，只能作为过程证据，不能单独作为挂号、缴费或退费最终完成。

本文件是当前审计快照，不替代旧页面矩阵、Provider 合同、临床审核、发布证据或生产验收记录；这些材料更新后必须重新运行相应门禁并更新本文件。

> 当前顺序复核（2026-09-17）：P1-01 项目 `.env` 仍保持 `ZHONGYANG_PATIENT_BINDING_READY=false`、`ZHONGYANG_PATIENT_DIRECTORY_READY=false`，未配置有效用户级授权，未执行查档、建档、绑卡、目录写入或旧数据导入；P1-04 仍保持预约目录 gate 关闭，既有渠道 4 只读探针不替代正式 Provider contract、平台同链和真机证据。两项均继续按 fail-closed 处理，等待受控外部材料后再推进真实验收。

> P1-01 装配层 fail-closed 补强（2026-09-17）：修正 `apps/api/src/application.ts` 的默认服务装配：只有患者绑定网关真实配置时，才将旧服务认证网关传入患者绑定服务；当患者绑定 gate 关闭或绑定网关缺失时，即使环境中存在 `LEGACY_PATIENT_AUTH_BASE_URL`，请求也会先由 `DependencyNotConfiguredError("patient-binding")` 拒绝，不会先调用旧服务微信认证。新增 `apps/api/src/application.test.ts` 回归锁定旧认证调用次数为 0。定向 API 回归 70 pass、0 fail、436 assertions；`pnpm typecheck` 13/13 通过。该修复不打开任何 gate、不执行 Provider 写入、不导入旧数据；P1-01 仍因真实 owner/Provider/真机/生产证据缺失保持未完成。

> P1-04 当前只读回归复核（2026-09-17）：按 TODO 顺序重新执行预约目录 adapter、预约 service、预约目录视图和 dashboard 白名单回归，共 105 pass、0 fail、335 assertions。覆盖 `first-depts=3`、排班/号源 `requestChannel=4`、医生嵌套排班、日期边界、空结果、停诊/未知状态、重复标识、`usableSourceNum`、快照失败/过期和 Provider trace 等边界；当前上游渠道 4 的无患者只读探针记录在 [`预约目录真实验收复核-2026-09-16.md`](docs/迁移/预约目录真实验收复核-2026-09-16.md)。这些证据只证明代码白名单和当前样本可解析，不证明 Provider 正式合同、平台同链、DevTools/真机或生产验收，P1-04 继续未完成。

> 本轮顺序复核（2026-09-17）：从 P1-01 开始重新核对患者绑定装配、Provider 患者引用反查和 owner-scoped 目录确认；当前绑定/目录 gate 仍为 `false`，未执行真实查档、建档、绑卡、目录写入或旧数据导入。P1-01 现有代码已在绑定成功后只用服务端 HIS 引用做目录反查，确认窗口内未出现目标患者时 fail-closed，不向小程序暴露 Provider 患者号。随后复核 P1-13～P1-20：问卷、出院随访、风险/自测、反馈、外部签名、实时就诊和固定 WebView 的可迁移功能承载/关闭态均已记录；本轮未发现可在缺少正式 contract、临床审核或外部主体协议时安全新增的功能。小程序全量回归 `442 pass / 0 fail / 4863 assertions`，全仓 `pnpm typecheck` 为 13/13 成功；development 包重建为 52 页，`pnpm --filter @hospital/miniprogram runtime:verify:dev` 通过，sourceRevision=`workspace-sha256:ef52763b96805467b69bfd5291642a39056c5cac67e9b482cf0b2aee11e67f79`。`todo:audit` 37 项（19 完成、18 未完成）、`docs:audit` 258 文档无断链；未把上述本地回归写成 Provider/真机/生产业务完成，P1-01 及其余需外部证据项继续保持关闭。

> 当前定向回归补充（2026-09-17）：P1-01 患者绑定服务/众阳 adapter/装配与小程序入口共 12 pass、0 fail、73 assertions；覆盖 owner 与 unionId 一致性、一次性微信登录 code、同幂等键并发、目录确认重试、未确认不报成功和 gate 关闭时不调用旧认证。P1-04 预约目录 adapter/service/小程序目录视图共 35 pass、0 fail、122 assertions；覆盖医生目录、排班状态、号源白名单、日期/科室绑定、失效引用、重复排班号和空结果。以上均为本地替身/源码回归，不替代真实 Provider 请求响应、平台同链、DevTools/真机或生产验收；本轮未执行任何 Provider 写入或旧数据导入。

> P1-04 医生卡排序补漏（2026-09-17）：旧端 `department_select.vue:505-553` 按医生首条 `visitCount` 降序展示，新端此前只保留 Provider 返回顺序；现已在 `packages/adapters/src/zhongyang-appointments.ts` adapter 内恢复稳定降序，`visitCount` 不进入客户端 contract。旧端党员标识实际写死为 `false` 且接口无该字段，本轮明确不迁移徽章。新增回归 2 pass、0 fail、5 assertions；未扩展费用/党员字段、未调用 Provider 写入、未导入旧数据。P1-04 仍等待正式 Provider contract、平台同链及真机/生产证据。

> P1-04 排序实现复核（2026-09-17）：重新执行 `zhongyang-appointments.test.ts` 的预约目录/排班/号源相关回归，共 10 pass、0 fail、24 assertions；Biome 格式检查、`git diff --check` 和全仓 `pnpm typecheck`（13/13）通过。排序仅消费旧 `scheduling-doctors` 外层 `visitCount`，按每位医生首条记录稳定降序，未扩展公共 contract；本轮仍未调用 Provider 写入、未导入旧数据，正式字段 contract、平台同链、真机/生产证据继续待补。

> P1-05 确认页展示字段补漏（2026-09-17）：旧端 `confirm_registration.vue:45-65` 展示“预约号别”，且排班上下文包含院区；新端此前从号源页进入确认页时没有传递这些真实字段。现已将白名单后的 `registrationClassName`、`hospitalAreaName` 从 `timeslot-source` 传入 `confirm-registration` 并按字段存在性展示；缺失时不拼接演示号别，不恢复费用或 Provider 患者字段。小程序 acceptance 1 pass、0 fail、34 assertions，类型检查、development 构建和 `runtime:verify:dev` 通过；未调用 Provider 写入、未导入旧数据，P1-05 仍等待真实写入 contract、锁号生命周期和跨系统补偿证据。

> P1-05 写入后详情展示字段持久化补漏（2026-09-17）：发现 MySQL 排班快照/本地预约记录此前未保存已白名单的 `registrationClassName`、`hospitalAreaName`，会导致真实写入后挂号详情再次丢失旧端号别和院区。本轮新增 `packages/persistence/migrations/0049_appointment_display_context.sql`，并贯穿 MySQL/内存仓储、预约注册响应、挂号详情和挂号支付页；新增服务层 4 项 10 assertions、MySQL 快照相关 12 项 39 assertions、小程序预约 acceptance 2 项 45 assertions，API/持久化/小程序 typecheck、development build 和 `runtime:verify:dev`（52 页，source=`workspace-sha256:f479482`）通过。未调用 Provider 写入、未导入旧数据；migration 0049 尚需受控环境实际执行验证，Provider 正式写入 contract、锁号生命周期和跨系统补偿仍缺，P1-05 保持未完成。

> P1-06 详情注释与行为对齐（2026-09-17）：预约记录页 WXML 注释仍描述“点击详情会提示未开放”，但当前实现已经对平台预约使用 owner-scoped `appointmentId` 读取真实详情，对 Provider 历史摘要进入经校验的只读详情版式；本轮已修正注释，未改变业务行为。预约记录/爽约/二级动作定向回归 6 pass、0 fail、93 assertions；`git diff --check` 通过。未调用 Provider 写入、未导入旧历史，P1-06 的 Provider 状态范围及真机/生产证据仍缺。

> 当前 development 运行包（2026-09-17）：针对 P1-06 页面源码变更重新执行 `build:dev` 与 `runtime:verify:dev`，均通过；包路径为 `/Users/yxswy/Documents/GitHub/hospital-platform/.local/hospital-miniprogram/development`，source=`workspace-sha256:cc0fba3`，包含 52 个页面脚本。该运行包仅证明源码与 dist 一致，不替代 Provider、真机或生产业务验收。

> P1-07 顺序复核（2026-09-17）：重新对照旧医生名片的关注/取消、简介弹层、未来七日日期切换、排班号别、停诊/无号状态和预约入口，当前新端均已有对应功能；挂号费仍不进入公共 contract，等待正式金额合同。独立回归：我的医生 service 5 pass、0 fail、15 assertions；预约排班/医生视图 3 pass、0 fail、17 assertions；众阳医生/排班 adapter 8 pass、0 fail、20 assertions；小程序医生页面 acceptance 1 pass、0 fail、39 assertions。未调用 Provider 写入、未导入旧关系；真实关注/取消、Provider contract 及真机/生产证据仍缺，P1-07 保持未完成。

> P1-08 顺序复核（2026-09-17）：重新对照旧报告查询/详情页，确认新端已承载四类报告目录、日期与类型筛选、报告详情、附件打开和复诊预约入口；旧端分享动作实际为待实现 Toast，不新增分享功能。众阳报告 adapter 24 pass、0 fail、57 assertions；报告 API service 27 pass、0 fail、116 assertions；小程序报告 acceptance 17 pass、0 fail、140 assertions；报告日期/范围回归 3 pass、0 fail、7 assertions。未导入旧报告、未调用 Provider；临床正文、PACS/ECG/PEIS 详情、附件资源授权及真机/生产同链证据仍缺，P1-08 保持未完成。

> 当前执行审计（2026-09-17）：按 P1-01 → P1-05 顺序复核后，已确认本轮代码、测试和记录没有打开任何 Provider 写入、支付、医保或旧数据导入。API 330 pass、0 fail；小程序 442 pass、0 fail；持久化 142 pass、0 fail；全仓 typecheck 13/13；`migration:audit`、`migration:contract:audit`、`todo:audit`、`docs:audit` 通过。P1-01、P1-04、P1-05 仍保持未勾选，原因是外部 contract、真实同链/真机证据和受控环境执行尚缺；后续按 P1-06 及 TODO 顺序推进可安全实现的功能。
