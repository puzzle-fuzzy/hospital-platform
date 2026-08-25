> 当前服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`（提交 `8eb51b5f`）；线上小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。两者是有意分层发布，不能互相替代。

> **当前功能候选事实（2026-08-26）**：本轮小程序功能候选为 `0bb4877ee890894bdb63e32c4b2b2d9e1167d555`，当前运行输入/pending 来源与该候选一致；后者包含全量迁移入口覆盖视图、A–F 批次展示、契约族边界、逐入口说明、前序业务候选、协议静态页以及共享构建/门禁输入。服务端本地候选按 `apps/api` 最新提交为 `b42922f4`；后续文档提交不改变已构建的 pending 运行包，源码或构建输入更新时必须重新生成来源记录；
> 小程序 pending 运行包来源为 `0bb4877ee890894bdb63e32c4b2b2d9e1167d555`，包含 21 个页面；
> `apps/miniprogram/dist/` 仍由开发者工具锁定，当前 live dist 来源为 `fcc6630e`。本地候选、pending、live dist 和线上包必须分开记录。

> 当前功能里程碑为 `0bb4877ee890894bdb63e32c4b2b2d9e1167d555`；当前 pending 运行输入来源一致，包含 21 个页面脚本和当前源码 `292 pass / 0 fail / 3250 expect()`。项目固定使用微信原生 `tabBar`，四个主入口、普通图标和选中图标只在 `app.json.tabBar.list` 声明一次；页面不渲染 `custom-tab-bar`，也不手动同步 selected。当前候选继续把开发者工具 watcher 根、`src`/`scripts` 源码监听隔离、运行包来源日志、81×81 图标尺寸门禁、当前 Tab 重复导航 no-op、主 Tab 前四项注册约束、预约标签重载范围一致性、可见 action 分发回归、21 个页面 WXML 事件方法闭环、就诊记录 8 条分批展示和 `dist` 独立运行工程一致性纳入门禁。
> 紧随其后的 `485c0892`、`296516a5`、`39cbf021`、`8bc649f`、`1404a03`、`e5345c4`、`f97f9f0`、`fc70fa0b`、`7627843a`、`cd26a01`、`ad793c80` 和 `7f7a7a18` 构建记录是历史候选；当前验收、发布和回滚只认本页顶部的 `0bb4877e` 运行包候选。
> `485c0892` 已完成 staging 构建并通过类型检查、页面入口、旧端 64 页面台账、action 分发回归和运行包静态门禁，但微信开发者工具锁定了当前 `dist/`，候选暂存于 `.local/hospital-miniprogram/pending/`；当前可运行 `dist/` 仍是上一候选 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`。候选均不包含 `custom-tab-bar/`、`*.test.js` 或 `*.spec.js`。
> 当前本地源码的 `app.json` 已注册 21 个页面，四个主入口由微信原生 TabBar 统一固定在窗口底部；这个数字不应与线上历史运行包 `13f597e` 的 14 页记录混用。
> 这份本地候选不能替代线上 `13f597e`，
> 也不能产生当前真机三层业务证据。

> 上方版本信息优先于下方历史记录。`8eb51b5f` 已完成生产 env preflight、隔离 runtime smoke、原子切换和切换后公网 runtime smoke；旧 Python `8001` 未修改、未停止。

# 剩余迁移盘点与下一步计划

> **最新候选纠正（2026-08-26）**：当前小程序 pending 运行输入为 `0bb4877ee890894bdb63e32c4b2b2d9e1167d555`（提交 `0bb4877e`），21 个页面，`292 pass / 0 fail / 3250 expect()`。本轮新增使用条款原文只读页；健康内容仍因审核 bundle 缺失保持 fail-closed，协议版本/同意/撤回/审计仍未开放。二维码、就诊页等前序候选只作历史交接，不能生成当前真机证据。

> 全量 64 个旧页面的状态分布、已替换子集、阻塞原因和批次顺序集中见
> [`migration-breadth-status-2026-08-25.md`](migration-breadth-status-2026-08-25.md)。本页继续保留更细的历史证据和逐域说明。

> **最新候选覆盖补充（2026-08-26）**：当前小程序功能候选为 `0bb4877e`，原生页面注册数为 21 个，健康百科目录、搜索、疾病/药品详情三个只读落点、客户端运行时响应校验、分类级空态修复、互联网医院安全壳迁移分类、全局资料授权跨 bundle 单飞与异常恢复、首页二维码入口状态、跨会话授权拒绝保护、使用条款原文只读页、健康知识错误码文案、未知/过期入口错误语义、迁移入口覆盖视图、契约族展示、逐入口说明、A–F 迁移批次展示和统一页面滚动边界均已纳入；pending 候选位于 `.local/hospital-miniprogram/pending/`，当前源码回归为 `292 pass / 0 fail / 3250 expect()`，且首页/我的 31 个可见 action 与全部 21 个页面 WXML 事件均通过广度审计。页面接入不等于健康内容开放，正式审核 bundle、发布/撤回演练、协议同意审计和真机证据仍待。

> 当前事实源（2026-08-26，优先于下方历史交接）：小程序功能源码候选为 `0bb4877ee890894bdb63e32c4b2b2d9e1167d555`，当前运行输入/pending 来源一致，位于 `.local/hospital-miniprogram/pending/`；
> 当前 live `dist` 仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，因为开发者工具锁定目录尚未发布。本轮小程序回归为 `286 pass / 0 fail / 3217 expect()`；更早候选仅作历史交接。

> 本候选新增旧端 64 页面逐页机器台账、健康百科客户端运行时响应校验、分类级空态修复和迁移入口覆盖视图，不改变线上服务或旧项目；当前交接与运行包来源详情见
> [`full-migration-handoff-2026-08-25.md`](full-migration-handoff-2026-08-25.md) 和
> [`../release/candidate-68902677-miniprogram-runtime-2026-08-25.md`](../release/candidate-68902677-miniprogram-runtime-2026-08-25.md)。


## 2026-08-25 患者中心审计补充

本轮完成首页患者卡片、患者选择、旧端二维码和新增就诊人流程的只读对照，并继续补齐首页/服务/“我的”可见入口的 action 分发门禁；下述患者中心审计属于历史候选 `b587c7ea`，
小程序当前工作树复跑为 `259 pass / 0 fail / 2525 expect()`；候选构建已确认 20 个页面脚本完整，预约记录增加未来/历史摘要的 8 条分批展开，待发布到被锁定的 `dist/` 后再生成真机入口。旧端二维码实际使用
`medicalCardNo` 调用第三方二维码图片服务，不能从代码注释推断为医院所需的 `patId`；新版二维码继续保持关闭，
不把完整卡号、身份证号、HIS `patId` 或 `thirdPatientId` 放进小程序或第三方 URL。旧端新增就诊人存在查档异常继续建档、
身份证号复制为卡号、无幂等/最终确认等问题；新版仍不注册建档、绑卡、解绑写入路由。详见
[`patient-qr-contract-audit-2026-08-24.md`](patient-qr-contract-audit-2026-08-24.md) 和
[`patient-binding-contract-draft.md`](patient-binding-contract-draft.md)。本轮未修改旧项目、线上服务、数据库、Redis，
也未触碰另一会话负责的众阳自动化。

报告与门诊病历本轮复核结果：报告目录/LIS 详情已有 owner、患者、来源和短期引用的安全代码骨架，但生产 gate 仍关闭，
不能把关闭态、测试桩或空列表当成真实报告迁移；PEIS、PACS/ECG 详情、附件和报告解读继续独立等待授权。旧端“门诊病历”
实际只调用 `out-visit-records` 摘要，病历正文/住院病历是另一域；由于仍没有正式 contract、字段白名单、患者映射和
脱敏失败样例，新端 `/api/v2/medical-records` 继续未注册。详见 [`current-report-profile-invariant-audit-2026-08-24.md`](../release/current-report-profile-invariant-audit-2026-08-24.md)、
[`report-provider-contract-audit-2026-08-19.md`](report-provider-contract-audit-2026-08-19.md) 和
[`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)。

下一阶段已有患者/预约/门诊费用只读验收顺序固定在 [`readonly-acceptance-next-2026-08-25.md`](../release/readonly-acceptance-next-2026-08-25.md)，
先使用当前 `dist/` 候选和真实微信设备采集 requestId，再与服务端低敏业务日志配对；支付、医保、二维码、患者绑定和 HIS 回写不在该手册范围。

临床只读的并行推进顺序、停止条件和四条独立队列见
[`clinical-readonly-intake-board-2026-08-25.md`](clinical-readonly-intake-board-2026-08-25.md)。

> 历史执行基线（2026-08-25 早前窗口）为 `45742ff4450b223b8db3b36e4a3859e3fc86e1c5`，随后曾短暂验证 `ad7b079`；这些候选以及此前的 `7fc22fae` 均为历史来源，当前验收以本页顶部的 `a6319d7` pending 候选为准，live `dist` 仍是 `fcc6630e`。早前候选已经通过当时的 `runtime:verify`，但不能继续作为当前运行包来源；开发者工具应直接打开 `apps/miniprogram/dist/` 的独立工程。之前的 `0f40ab9`、`4ea15b8`、`4e8f6877`、`0bf2bf8`、`7a85dce8`、`f4c844c1`、`ecff1f9`、`49c641b6`、`e039e99f`、`3b8a04e5` 仅为历史来源；线上仍是 `13f597e`，两者不能混用。
> 历史候选更新（2026-08-22）：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`（提交 `0e2a366e`）；小程序运行包来源为 `4ba492a3fdae8283409bd2ab4a0a45247c46600c`（提交 `4ba492a`）。本段仅作追溯。


> 当前本地最新运行包来源校验值：`0bb4877ee890894bdb63e32c4b2b2d9e1167d555`，候选暂存于 pending；被开发者工具锁定的当前 `dist/` 仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`。线上配套小程序仍为 `13f597ea9ee3f65b9be858117826d948339d904a`；线上服务端 release：`8eb51b5ffe85b0b8f8a032783f893117d3df549d`。两者为有意分层发布，不要求同源。

> 历史发布基线（2026-08-22 18:55 CST）：服务端当时为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源
> `4ba492a3fdae8283409bd2ab4a0a45247c46600c`。P0 运行层切换已完成，P1 真机/Provider 三层证据仍未完成。

> 当前执行基线（2026-08-25）：线上新 API 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，线上配套小程序运行包为 `13f597e`（来源 `13f597ea`）；本轮 adapter 门禁已随服务端切换进入线上，渠道 4 “全部挂号”查询仍待真机三层证据，普通资料真实写入/409 也仍待同一候选下的受控验收。本地最新运行包候选为 `a6319d7`，尚未替换当前被工具锁定的 `dist/` 或线上小程序运行包。

> 历史观察（2026-08-22 18:04 CST）小程序运行包恢复：重新构建和 `runtime:verify` 通过，关闭/重开新项目窗口并普通编译后重新生成
> iOS/局域网真机二维码；`dist/` 没有 `single-flight.test.js` 或其它测试脚本，旧 `mp-weixin` 窗口未操作，手机仍未连接。成功请求的低敏
> requestId 观测已补齐，当前小程序全量测试为 `221 pass / 0 fail / 1640 expect()`。

> 历史观察（2026-08-22 15:16 CST）新 API `active` 并监听 `10.0.0.3:18081`，旧 Python 仍监听 `8001`，
> Worker 为 `inactive`，新 API live/ready 均为 `200`；最近 60 分钟没有任何指定业务域的请求/成功事件。
> 本地当前工作树 `pnpm check` 全部通过。该窗口只证明新旧服务共存和代码门禁正常，不替代真机页面、客户端 requestId
> 与服务端业务事件三层证据。详见 [`../release/current-business-observation-2026-08-22-1510.md`](../release/current-business-observation-2026-08-22-1510.md)。

> 历史发布复核（2026-08-22 18:55 CST）：门诊费用只读 adapter 的公开 `recordId` 已加入不可见的 Provider 患者作用域，Provider 稳定身份字段若只有空白字符则按格式异常拒绝；补丁已按无损手册发布到当时的 `0e2a366e`。门诊费用真实 Provider/真机业务证据仍为 0。

> 历史发布通道复核（2026-08-22 21:13 CST）：当时阿里云到内网可达，但 `ps@10.0.0.3` 拒绝现有公钥；该状态已在后续恢复。该段只保留历史 SSH 证据，当前运行态以 [`../release/8eb51b5f-production-acceptance-2026-08-24.md`](../release/8eb51b5f-production-acceptance-2026-08-24.md) 为准。

> 当前线上运行层只读复核（2026-08-24）：新 API release `8eb51b5f` 为 production，监听
> `10.0.0.3:18081`；旧 Gunicorn 继续监听 `0.0.0.0:8001`，Worker 为 `inactive`。内网 live/ready/
> `/api/v1/system/ping` 和公网 `/api/v2` 对应探针均为 200，ready 的 database/redis/schema 均为 `ok`。
> 本次没有重启、配置修改、业务写入或患者/Provider 原始数据读取；由于 `sudo journalctl` 需要密码，未把日志
> 不可读误写为“没有业务请求”。详见 [`../release/current-runtime-coexistence-readonly-2026-08-24.md`](../release/current-runtime-coexistence-readonly-2026-08-24.md)。

## 2026-08-25 当前执行补充

> 本轮继续只修改新项目；当前小程序功能候选为 `a6319d7`，最新本地运行输入/pending 候选为 `a6319d7`，
> 已完成原生 tabBar 运行包重建、全局启动资料初始化、授权点击修复、未迁移入口统一状态页、首页悬浮客服入口收口、预约/报告/门诊缴费/新增就诊人二级动作状态路由、就诊预约记录未来/历史摘要的 8 条分批展示、健康百科分类级空态修复、互联网医院安全壳迁移分类修正、全局资料授权跨 bundle 单飞、首页二维码入口状态路由、跨会话授权拒绝状态保护、健康知识错误码契约、未知/过期入口错误语义、迁移入口覆盖视图、候选构建和小程序 `286 pass / 0 fail / 3217 expect()`；候选目前因开发者工具锁定 `dist/` 暂存 pending，上一候选 custom-tab-bar 在真机未呈现，已撤回。全局用户资料仓库同时完成多 Tab 单飞和冻结快照引用一致性回归。
> 预约记录页补齐了一个业务不变量：患者会话或显式就诊人失效后，切换“在线挂号/全部挂号”
> 必须携带用户刚点击的范围重新查询，不能让标签状态和服务端读取范围短暂错配。

> 当前没有新增线上部署、真机页面证据或 Provider 真实业务证据；线上仍保持
> `8eb51b5f` 新 API 与旧 Python `8001` 共存，小程序线上运行包仍为 `13f597e`。
> 支付、医保、结算、退款、二维码真实协议、患者新增绑定和 HIS 写回继续关闭。

> 2026-08-25 门诊病历准入复核：旧端 `electronic_record.vue`、`ZY.ts`、`medicalRecord.ts` 和患者院区选择器的
> 当前 SHA-256 与既有审计指纹一致，`docs/provider-intake/` 没有新增 `out-visit-records` 正式确认包、脱敏样例、
> 字段白名单或资源授权说明。`/api/v2/medical-records` 继续保持未注册/404；本轮没有新增病历 schema、adapter、
> 页面或兼容转发。详见 [`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md) 的 0.6 节。

> 2026-08-25 00:54 CST 只读 SSH 复核：新 API release `8eb51b5f` active，监听 `10.0.0.3:18081`；
> 旧端口 `0.0.0.0:8001` 仍监听，本轮未修改或重启旧服务；内部 `/health/ready` 与
> `/api/v1/system/ping` 为 200，未登录 `/api/v1/me/profile` 为预期 401。该证据只覆盖运行层和认证边界，
> 不增加普通资料 GET/PUT/409 的业务完成度；下一步仍按 [`next-profile-business-acceptance-plan-2026-08-24.md`](../release/next-profile-business-acceptance-plan-2026-08-24.md)
> 使用专用测试账号采集页面、HTTP requestId 和 Pino 同链证据。

## 2026-08-24 当前执行决策

> 最新只读复核（2026-08-24 21:20–21:36 CST）：受控 SSH 已恢复，线上 `8eb51b5f`、新 API `18081`、旧 Python `8001`
> 和依赖 readiness 均正常；该窗口只有微信登录与患者目录事件，没有预约、预约目录、门诊费用或普通资料请求。
> P1 仍必须由真实小程序页面、客户端 requestId 和服务端低敏日志三层配对完成，详见
> [`../release/current-readonly-business-observation-2026-08-24-2134.md`](../release/current-readonly-business-observation-2026-08-24-2134.md)。

> 2026-08-24 21:19–21:49 CST 后续只读窗口：新旧服务继续共存，live/ready/system-ping 均为 200；窗口内出现 1 次微信登录成功、3 次患者同步和 6 次患者目录读取，但预约历史、预约目录、门诊费用和普通资料均为 `requested=0/success=0`。本轮首次错误版本前缀探针返回的 404 已单独标明为操作员探针，不计入业务失败。详见 [`../release/current-readonly-business-observation-2026-08-24-2149.md`](../release/current-readonly-business-observation-2026-08-24-2149.md)。

> 2026-08-24 21:37–22:07 CST 最新只读窗口：`8eb51b5f`、新 API `18081`、旧 Python `8001` 和 database/redis/schema readiness 均正常；观察到 9 次完整患者同步链、18 次患者目录读取，普通资料、预约历史、预约目录和门诊费用均为 `0 / 0`。窗口内唯一 404 是操作员误用 `/api/v2/health/ready` 的内网探针，不计入业务失败。详见 [`../release/current-readonly-business-observation-2026-08-24-2207.md`](../release/current-readonly-business-observation-2026-08-24-2207.md)。

本节是本轮继续推进时的唯一执行顺序入口；下方历史记录保留证据，但不能覆盖这里的当前状态。

| 优先级 | 当前动作 | 放行条件 | 当前决定 |
| --- | --- | --- | --- |
| P0 | 恢复受控发布链 | 阿里云 SSH 可用；服务端候选可在不停止旧 Python `8001` 的情况下切换；公网 live/ready、旧端口和新端口均有证据 | 已完成：线上 `8eb51b5f` 已稳定运行，切换后 runtime smoke 通过；旧 Python `8001` 继续共存 |
| P1 | 真机只读与普通资料受控验收 | 新小程序运行包来源与已验证服务端配套；微信登录、患者同步/切换、预约历史、门诊费用、普通资料 GET 分别取得页面、HTTP requestId/Provider requestId、Pino 日志三层证据；普通资料 PUT/409 仅使用明确授权的可恢复测试值 | 当前进行中：线上真机配套运行包为 `13f597ea9ee3f65b9be858117826d948339d904a`，当前本地未发布候选运行输入为 `a6319d79f9f1e940ea5bcbd2ab7fe6500345466f`；`dist` 原子发布仍受开发者工具锁定，pending 运行包校验已通过，但显式患者切换、页面截图、预约历史、门诊费用和普通资料三层证据仍待，真实写入尚未执行，详见 [`../release/next-profile-business-acceptance-plan-2026-08-24.md`](../release/next-profile-business-acceptance-plan-2026-08-24.md) |
| P2 | 门诊病历、二维码、患者新增/绑定、住院和动态外部入口 | Provider/HIS 正式 contract、字段授权、owner/患者映射、成功/空/拒绝/暂时失败样例、回滚方案 | 继续保持未注册或迁移提示；不写兼容转发、不猜 `patId`/卡号用途。二维码停止条件详见 [`patient-qr-contract-audit-2026-08-24.md`](patient-qr-contract-audit-2026-08-24.md) |
| P3 | 微信支付、医保授权、结算、退款和 HIS 写回 | 金额/状态机、授权、回调/查单、幂等、回滚及真实沙箱/生产验收全部冻结 | 最后处理；当前已统一关闭支付运行闸门，订单/预支付/通知不会访问仓储或 provider；只读费用列表不能触发支付或医保流程 |

当前线上服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，小程序运行包来源为
`13f597ea9ee3f65b9be858117826d948339d904a`。因此可以继续进行真机准入，但只有页面、客户端 HTTP 和 Pino 同链证据齐全时
才能把只读业务标记为已验收；本地测试仍不能代替部署后的页面和 Provider 证据。

> 历史状态语义复核（2026-08-22 18:34 CST）：旧端预约历史声明使用 `status`，但在线列表曾用未声明的
> `statusCode` 排除取消；新端已将 `0/1/3/4/5/6/7` 集中映射为稳定公共枚举，并由 domain/service
> 二次校验。预约历史 adapter、API service 和小程序展示边界定向测试分别为 `15/25/8 pass`；
> 当时的“全部挂号”渠道 4 contract 尚未冻结，详细边界见
> [`../release/appointment-record-status-mapping-audit-2026-08-22.md`](../release/appointment-record-status-mapping-audit-2026-08-22.md)。

2026-08-22 09:18 CST 的历史线上低敏观察显示当时已验证 release 曾出现微信登录、患者目录和预约历史事件，但门诊费用事件为 0；
该窗口不属于当前候选证据，也不替代真机页面和同链 requestId 证据。详细统计见
[`../release/current-2a2acd9-business-observation-2026-08-22-0918.md`](../release/current-2a2acd9-business-observation-2026-08-22-0918.md)。
本轮已确认 `pnpm migration:audit`、`pnpm architecture:audit` 和 `pnpm provider:audit` 通过；这三项只证明台账、架构边界和
Provider 文档接收记录完整，不替代 SSH、部署、真机或真实 Provider 证据。

> 2026-08-22 17:50 CST 历史工作树补充：小程序提交 `a64fe023` 的运行包已重新构建，患者范围页面入口门禁已收口；门诊费用继续只读，未开放支付、医保、结算或 HIS 写回。该记录不覆盖当前 `4ba492a`，详细证据见 [`../release/candidate-a64fe023-local-build-2026-08-22.md`](../release/candidate-a64fe023-local-build-2026-08-22.md)。

> 2026-08-22 09:35 CST 历史运行层只读观察确认当时新 API `active`、`10.0.0.3:18081` 和旧 Python `8001` 继续共存，Worker 为 `inactive`；该观察不作为当前候选业务证据。详见 [`../release/current-2a2acd9-runtime-observation-2026-08-22-0935.md`](../release/current-2a2acd9-runtime-observation-2026-08-22-0935.md)。

当前受控 SSH 发布通道已可使用；`8eb51b5f` 已按启动窗口门禁完成切换。后续线上步骤仍须遵守“只重启新 API、不触碰旧 Python/旧数据库/旧 Redis”的边界；当前不影响线上 `8eb51b5f` 和旧 Python `8001`。

## 历史记录（仅供追溯）

下方内容保留过去的候选、线上观察和失败原因，仅用于追溯；不得覆盖本页顶部及“当前执行决策”中的线上 `13f597ea` 基线。

除本页顶部“2026-08-24 当前执行决策”外，下方所有按历史日期记录的“当前”均只表示当时窗口的当前事实；
它们不能覆盖本页当前的 `13f597ea` 线上基线。

> 历史候选记录：服务端 release `2a2acd9`（完整提交 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5`）；当时小程序运行包来源为 `b0e093565493285e07fe549879f8b87eda649cc7`（提交 `b0e0935`）。该历史段落不覆盖本页当前候选。

> 2026-08-22 07:32 CST 工作树补充：当前本地服务端/小程序候选为 `b0e093565493285e07fe549879f8b87eda649cc7`，
> 但线上仍是 `7181e99e`，所以 `4e1b2e2` 仍是线上配套的历史真机候选，`b0e0935` 不能在未发布前直接验收。
> 根 `pnpm check` 唯一停止点是发布基线不一致；本机 PEM 连接阿里云中转机 `8.130.127.184` 被服务器拒绝，
> 没有执行上传、切换、旧 Python `8001` 检查或线上修改。后续先恢复受控 SSH，再继续候选发布和重新构建真机包。

> 2026-08-22 07:38 CST 当前服务端候选已推进为 `4f2d890d`：只收紧众阳超长卡号响应，超过平台 64 字符资源边界时
> 在 `patInfosFind` 前 fail-closed；小程序运行包来源仍是 `b0e0935`，因为本轮未修改小程序运行输入。该服务端
> 候选尚未部署，SSH 仍被阿里云拒绝；详见 [`../release/candidate-4f2d890-local-build-2026-08-22.md`](../release/candidate-4f2d890-local-build-2026-08-22.md)。

> 当前基线更新：服务端 `7181e99e`；小程序候选 `4e1b2e2`，必须在开发者工具重新编译后以 `build-info.json` 固定来源。下文更早候选只作历史追溯。

> 2026-08-21 报告只读 adapter 已收紧 LIS `pdfUrlList`：数组元素必须为无控制字符字符串，异常对象、数字、布尔值和控制字符会整批拒绝；当前仍只返回附件存在性，不返回地址、不开放下载或授权。详见 [`../release/report-attachment-boundary-2026-08-21.md`](../release/report-attachment-boundary-2026-08-21.md)。

> 2026-08-21 门诊费用只读 adapter 已收紧稳定身份字段：字段存在但为对象、数组、布尔值、非有限数字、控制字符或超过 256 个 UTF-16 单元时整批拒绝，不再静默忽略并生成可能漂移的 `recordId`；账单时间使用同一边界校验。该修正不开放支付、医保或结算，详见 [`../release/outpatient-payment-identity-boundary-2026-08-21.md`](../release/outpatient-payment-identity-boundary-2026-08-21.md)。

> 2026-08-21 排班只读快照边界已加固：进入内存/MySQL persistence 前统一校验 `zhongyang` 来源、排班嵌套字段、号源数量和不超过 5 分钟的观察 TTL；这只保证只读观察事实不被错误调用方写入，不开放预约写入或锁号。详见 [`../release/appointment-schedule-snapshot-runtime-validation-2026-08-21.md`](../release/appointment-schedule-snapshot-runtime-validation-2026-08-21.md)。

> 2026-08-22 当前服务端已从 `84fac75c` 原子切换到 `7181e99e`；新 API 与旧 Python `8001` 共存，生产 preflight、隔离 smoke、公网 runtime smoke 和切换后低敏日志聚合通过，旧 Python PID 未变化。当前小程序候选已更新为 `4e1b2e2`，运行包不含测试脚本；`single-flight.test.js` ENOENT 必须按开发者工具旧增量索引恢复，不得把测试脚本复制进 `dist/`。详见 [`../release/7181e99e-production-acceptance-2026-08-22.md`](../release/7181e99e-production-acceptance-2026-08-22.md) 和 [`../release/candidate-4e1b2e2-local-build-2026-08-22.md`](../release/candidate-4e1b2e2-local-build-2026-08-22.md)。

> 上一条 `9f491cb5`/`002acc1b` 切换记录仅作历史追溯；当前服务端指针以本节的 `7181e99e` 为准。

> 2026-08-21 19:36–19:44 CST 当前服务端已从 `5a31427` 原子切换到 `c8eef370`；新 API 与旧 Python `8001` 共存，
> readiness、生产模式和依赖探针通过。当前 release 仍没有新的微信真机、预约 Provider 或门诊费用三层业务证据，详见
> [`../release/c8eef370-production-acceptance-2026-08-21.md`](../release/c8eef370-production-acceptance-2026-08-21.md)。

> 2026-08-21 当前小程序运行包门禁复核：本地运行包来源为 `f488c6f3270514af10b19fdf3c45a47519e1736b`，小程序测试
> `197 pass`、`1493 expects`，14 个页面入口齐全，`dist/` 不包含 `*.test.js`/`*.spec.js`。服务端当前 release 已另行切换为
> `c8eef370`；这只证明代码与运行包边界，预约历史、门诊费用、报告 Provider、真机和支付/医保/HIS 仍按下方准入条件处理。

> 2026-08-21 16:04 CST 历史工作树复核（不作为当前候选）：再次执行 `pnpm check`，架构、迁移清单、Provider intake、文档链接、Biome、工具测试、
> 9 个 workspace 的类型检查/测试/构建均通过；小程序 `181 pass/1444 expects`、API `199 pass/829 expects`，运行包来源仍为
> `9c582a1c38b3b3cdecf7145c6b126b185fe474c2`，且 `dist/` 中测试脚本为 0。SSH 读取 `ps@192.168.112.172` 和阿里云中转机
> 本轮均被公钥拒绝，因此没有新增线上日志或真机三层证据；旧项目、旧服务、数据库和 Redis 未触碰。

> 2026-08-21 16:06 CST 公网只读复核：新 API 的 live、ready、system-ping 均为 `200`，ready 的 database/redis/schema 均为 `ok`；
> 无会话的患者、预约历史和门诊费用读取均为预期 `401/unauthorized`，刻意关闭的门诊病历为 `404/not-found`。这只证明公网运行层和
> 关闭/鉴权边界，没有产生微信、患者、预约、门诊费用或真机三层业务证据，详见 [`../release/current-public-readonly-smoke-2026-08-21-1606.md`](../release/current-public-readonly-smoke-2026-08-21-1606.md)。

> 2026-08-21 14:04 CST 当前复核：预约/门诊费用/报告定向测试 `62 pass`，小程序标准测试 `176 pass`，公网运行层和未登录鉴权边界通过；SSH 日志读取本轮被拒绝，且新小程序二维码仍未出现手机连接。因此代码门禁已通过，但预约历史、门诊费用、报告 Provider 和真机页面仍不能标记为当前 release 的真实业务完成。详见 [`../release/readonly-business-and-device-preflight-2026-08-21-1404.md`](../release/readonly-business-and-device-preflight-2026-08-21-1404.md)。

> 当前盘点基准：2026-08-21；旧端初始扫描基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app`，新端来源为
> `E:\\__Super_Core__\\hospital-platform`。本文只把源代码和测试证据作为“实现证据”，不把页面存在、接口返回 200
> 或旧接口曾经可调用误判为真实业务完成。

> 当前发布基线补充（2026-08-22）：服务端为 `7181e99e`；小程序候选为 `4e1b2e2`，完整运行包来源为
> `4e1b2e224964797c103eba832323ee7074c7ad2b`，必须由开发者工具重新编译后再进行真机验收。
>
> 逐页完整清单见 [`legacy-page-matrix.md`](legacy-page-matrix.md)；本文件负责优先级、业务不变量和 provider 文档冻结规则。
> 旧小程序和旧 FastAPI 的逐接口快照见 [`legacy-api-endpoint-inventory.md`](legacy-api-endpoint-inventory.md)。

> 当前配套小程序候选构建来源为 `4e1b2e224964797c103eba832323ee7074c7ad2b`（提交 `4e1b2e2`），尚未上传线上；用户已有的开发者工具配置修改不属于本次候选代码。

> 2026-08-21 当前执行顺序：私网监听、数据库/Redis/schema readiness 和新旧服务共存已经完成只读复核；下一步先取得当前小程序候选的真实微信会话、患者显式切换、预约历史和门诊费用只读三层证据，
> 再验收普通资料写入。报告、患者绑定、门诊病历和二维码必须等各自 Provider contract、权限/归属、脱敏样例和可回滚验收材料齐全后再实现；支付、医保和 HIS 回写最后处理。

> 2026-08-21 首页二维码字段审计补充：旧端源码注释声称二维码包含 `patId`，但实际运行代码读取并外发的是 `medicalCardNo`，通过第三方 `api.qrserver.com` 生成图片；该旧行为缺少签名、受众、有效期、防重放、撤销和扫码回执。新端不得直接复用卡号或 `patId` 生成二维码，入口继续关闭。详见 [`../release/miniprogram-qr-contract-audit-2026-08-21.md`](../release/miniprogram-qr-contract-audit-2026-08-21.md)。

> 2026-08-22 患者绑定字段边界复核：旧端手动选择已有患者时把 `patInfosFind(type=3)` 返回的 `idCardNo` 写入
> `patCardNo`，首次默认选择却优先写入 `cardNo`；该字段在旧缓存中可能混用身份证号和医疗卡号。新端继续只保存
> 平台 opaque `patientId`，新增/绑卡/修改/解绑保持关闭。详见 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md) 的 0.2 节。

> 2026-08-21 状态机复审补充：普通资料与就诊人选择的代码门禁已重新执行，未发现可在不扩大
> contract 的前提下安全修复的缺口；标准测试、类型检查和运行包校验通过。开发者工具已在
> 正确的 `miniprogram` 窗口生成新二维码，但尚无设备页面、HTTP 链和服务端日志三层配对证据，
> 因此不能把二维码生成写成真机完成，详细规则见 [`../release/readonly-profile-patient-state-audit-2026-08-21.md`](../release/readonly-profile-patient-state-audit-2026-08-21.md)。

> 2026-08-20（历史网络与门禁阶段记录）：WireGuard `10.0.0.3 ↔ 10.0.0.1` 的 MySQL `SELECT 1`、Redis `PING` 已真实验证；
> 新 API 私网切换脚本已加入仓库，但因 systemd 重启需要交互授权，当前线上配置已保持原公网目标并自动回滚。
> `8817f90` 后全仓 `pnpm check` 通过；这不替代真机、Provider 和真实业务证据。

> 2026-08-20 当前仓库复核：前序提交 `a2af341` 已修正微信身份和微信支付上游地址的空字符串/空白值解析，
> 统一回退到官方 HTTPS 默认地址，避免配置状态与实际 adapter 地址不一致；新增配置单元测试和运行配置复核文档。
> 小程序运行包继续只包含 `single-flight.js`，不包含 `single-flight.test.js` 或其它测试脚本；该 ENOENT 仍属于微信开发者工具旧增量索引，
> 应关闭真机调试、重开项目、普通编译后重新生成二维码，不能把测试文件复制进 `dist/`。

> 2026-08-20 Redis 运行边界复核：readiness、会话读写和 TTL 维护命令现在共用同一 Redis 连接单飞，
> 连接竞争不会再被直接当作业务失败；业务写入仍不自动重放。persistence 测试 83 项通过，详见
> [`../release/redis-readiness-concurrency-audit-2026-08-20.md`](../release/redis-readiness-concurrency-audit-2026-08-20.md)。

> 2026-08-21 生产更新：服务端已切换到 `5a31427`；旧 Python `8001` 未修改并继续共存。新 release 的运行层、
> 只读多请求 trace 日志链和患者映射安全边界见 [`../release/5a31427-production-acceptance-2026-08-21.md`](../release/5a31427-production-acceptance-2026-08-21.md)。

> 2026-08-21 05:45 CST 线上只读复核：正确内网 readiness 地址 `10.0.0.3:18081` 返回 database/Redis/schema `ok`，
> 新旧端口继续共存，最近 30 分钟没有 P0 业务事件；回环地址 `127.0.0.1:18081` 不是新 API 监听地址。该窗口只证明运行层，
> 不增加真机或 Provider 业务证据。详见 [`../release/current-5a31427-p0-business-observation-2026-08-21-0545.md`](../release/current-5a31427-p0-business-observation-2026-08-21-0545.md)。

> 2026-08-21 05:47 CST 公网只读 smoke：健康探针为 `200`，未登录业务读取为 `401`，门诊病历、医保授权和预约写入为 `404`，
> live/ready 为 `no-store`；这只证明公网 fail-closed 边界，不增加真机或 Provider 业务证据。详见
> [`../release/current-public-readonly-smoke-2026-08-21-0547.md`](../release/current-public-readonly-smoke-2026-08-21-0547.md)。

> 2026-08-21 05:54 CST SSH 只读复核：`5a31427` active，Worker inactive，新 API `10.0.0.3:18081` 与旧 Python `8001` 共存，
> readiness 的 database/Redis/schema 均为 `ok`；最近 30 分钟没有 P0 业务事件。该窗口只证明运行层和业务请求为空，
> 不增加当前候选的真机或 Provider 证据。详见
> [`../release/current-5a31427-p0-business-observation-2026-08-21-0554.md`](../release/current-5a31427-p0-business-observation-2026-08-21-0554.md)。

> 2026-08-21 患者只读证据补充：在历史服务端 release `0e360d3` 的运行窗口中，
> `2026-08-20 23:35:18 CST` 至 `2026-08-21 00:05:18 CST` 低敏日志窗口中，解析记录 13 条、解析错误 0、HTTP 完成 5 条且全部为
> `200`；患者目录读取 `2/2`、患者目录同步 `1/1` 均通过同链业务证据门禁。该窗口没有微信登录、预约历史或门诊费用事件，
> 因此只能证明当前 release 的患者读取/同步服务链，不能替代新的微信扫码、真机页面、多患者切换或其它业务验收；详见
> [`../release/miniprogram-real-device-login-acceptance-2026-08-20.md`](../release/miniprogram-real-device-login-acceptance-2026-08-20.md) 第 10 节。

> 2026-08-21 00:23 CST 线上共存只读复核：`hospital-platform-api-v2.service` 为 `active`，新 Bun API 监听
> `10.0.0.3:18081`，旧 Python API 仍监听 `0.0.0.0:8001`，公网 `/api/v2/health/ready` 返回 `200`。
> 本次只读取服务状态、监听和 readiness，没有重启服务、修改配置或触碰旧项目；该运行层证据不增加任何新的 Provider 或真机业务结论。

> 2026-08-21 公网关闭能力边界复核：患者新增、门诊病历、医保授权和预约写入均保持 `404`；普通资料、预约历史、门诊费用和报告
> 在无 Bearer 会话时均返回 `401`。这证明路由的关闭/鉴权边界仍符合 fail-closed 设计，不证明任何 Provider 或真机业务已经完成；详见
> [`../release/current-public-closed-boundary-2026-08-21.md`](../release/current-public-closed-boundary-2026-08-21.md)。

> 2026-08-21 00:49 CST 使用本地 `b4a73c4` 的生产模式 runtime smoke 复核当时公网 `0e360d3`：live/ready/ping 为 `200`、
> ready 连续 `3/3`，认证边界为 `401/unauthorized`，7 条未开放能力均为 `404/not-found`。该请求不携带会话、不调用
> Provider、不写 MySQL/Redis，也不增加微信、患者、预约、费用或真机业务证据；旧 Python `8001` 不属于本次范围。

> 2026-08-21 01:01 CST SSH 只读观察：`hospital-platform-api-v2.service=active`，新 API `10.0.0.3:18081` 和旧 Python
> `0.0.0.0:8001` 均在监听；最近 30 分钟仅统计到 `http.request.completed=10`、`http.request.failed=26`，没有
> `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*` 或 `user.profile.*` 业务事件。因此当前仍没有
> 真机微信登录、患者同步或后续业务请求证据；本次未读取原始日志、未改配置、未重启服务。

> 2026-08-20 12:05 CST SSH 与公网只读复核：线上 `current` 仍为完整 release
> `0e360d32edcfaa49128a7c29aaa4947cf739e090`，新 Bun API 监听 `10.0.0.3:18081`，旧 Python API 仍监听
> `0.0.0.0:8001`；公网 live/ready/ping 均为 200，ready 依赖为 `database=ok`、`redis=ok`、`schema=ok`，
> 未授权患者/预约接口均返回 `401 unauthorized`。本地 `8f80b3e` 尚未部署；这次没有 Provider 调用、服务重启或
> MySQL/Redis 业务写入。详见 [`../release/current-public-readonly-smoke-2026-08-20.md`](../release/current-public-readonly-smoke-2026-08-20.md)。

> 2026-08-20 12:27 CST 再次只读复核：新 API 与旧 Python `8001` 仍同时监听，Worker 仍为 inactive，公网 readiness
> 返回 `200` 且 database/redis/schema 均为 `ok`；最近 30 分钟没有新的登录、患者、预约、门诊费用或报告业务事件。
> 这只是运行层和日志窗口证据，不能把“没有事件”解释为业务失败，也不能替代真机操作。完整证据见
> [`../release/current-runtime-readonly-observation-2026-08-20-1227.md`](../release/current-runtime-readonly-observation-2026-08-20-1227.md)。

> 2026-08-20 18:11 CST 真机入口复核：正确的 `miniprogram` 项目已重新打开，资源树指向 `dist/`，运行包无
> `*.test.js`/`*.spec.js`，并重新生成 iOS 真机调试二维码；当前服务端同时间窗口只观察到健康检查，没有
> `/auth/wechat` 或 `/patients` 请求。因此仍未形成真机登录/患者同步三层证据，旧 `mp-weixin` 项目和旧 Python 服务均未触碰。

> 本文下方保留了切换前的 b7/c26/652/08/398 等历史窗口；其中“当前 release”只表示记录当时的线上指针，不能覆盖上面的 `c8eef370`。

> 2026-08-20 迁移审计更新：重新核对旧端门诊病历页面和 `ZY.ts` 的当前 SHA-256，确认仍只有
> `POST /msun-middle-aggregate-clinic/v1/out-visit-records` 的历史调用线索；没有 Provider 正式 contract、患者映射确认、
> 字段授权或四类脱敏响应样例。因此 `/api/v2/medical-records` 继续保持未注册/404，不新增兼容转发或空数据实现。
> 详见 [`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md) 的 0.3 节。

> 2026-08-20 患者绑定审计更新：复核旧端 `patientAdd.vue`、`patientChange.vue` 和 `ZY.ts` 后确认，旧流程会把查档异常
> 降级为建档、把身份证号当卡号、把患者身份写入旧用户资料接口，且缺少幂等/最终状态查询/协议版本校验。新增、绑卡、修改和解绑
> 继续保持未注册；新端只允许已绑定目录同步和显式选择，不迁移旧端写入副作用。详见
> [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md) 的 0.2 节。

> 2026-08-21 历史工作树门禁复核（不覆盖顶部当前基线）：当时服务端发布基线为 `5a31427`，原生小程序运行输入来源已更新为
> `968a587158289da6a482b3614907bde0a5ad9581`。代码、架构、迁移清单、Provider intake、文档、类型、测试均通过；小程序构建门禁随后以当前候选重新执行，
> 400 篇 Markdown 文档、Biome、9 个 workspace 的类型检查/测试/构建均通过；当前 API 测试 199 项通过，小程序测试 186 项通过、1463 个断言通过，
> 配置包新增的空白上游地址回退测试也通过。
> 这只能证明代码边界和构建门禁一致，不能把微信真机、患者多选、预约历史、门诊费用、报告 Provider 或普通资料写入标记为当前 release
> 的真实完成。当前工作树中的 `apps/miniprogram/project.config.json` 修改和 `.codegraph/` 未跟踪目录属于并行会话，本次未触碰、暂存或提交。

> 2026-08-20 继续审计剩余业务后的停止结论：旧端门诊病历只能确认 `out-visit-records` 的历史调用线索，仍缺 Provider 正式请求/响应 contract、
> `patId` 用途映射、字段展示授权、成功/空/拒绝/暂时失败样例和分页/时区语义；二维码、患者新增/绑卡、支付、医保和 HIS 回写同样缺少必要准入证据。
> 本轮没有新增 schema、adapter、service、兼容转发或旧服务修改；缺少契约时保持 404/迁移提示是当前正确状态。

## 当前准入复核（2026-08-19 08:47 CST）

补充记录（2026-08-19 11:49 CST）：数据库瞬态断连恢复后，SSH 只读确认该观察窗口 release `b7c9451`、新 API `active/running`，
正确监听地址 `10.0.0.3:18081` 的 readiness 为 `database/redis/schema=ok`，旧 Python `8001` 继续共存。Redis 会话 TTL
审计仍返回 `redis-session-scan-unavailable`（退出码 2），所以会话实际 TTL、过期后的重新登录和多患者失效恢复继续保持未验收；
没有修改 ACL、重启服务、写数据库/Redis 或操作旧项目。详见 [`../release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md`](../release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md)。

补充记录（2026-08-19 11:55 CST）：线上环境确认 `NODE_ENV=production`；schema、微信身份、患者目录、预约目录/记录和门诊费用
配置 gate 为 `true`，微信支付、报告目录/详情仍为 `false`。这些只是配置准入，不替代真实 Provider、公网、页面和真机证据；旧 Python
服务仍在 `8001`，本次未重启、未写数据库/Redis、未修改 ACL 或旧项目。详见
[`../release/current-b7c9451-config-gates-observation-2026-08-19-1155.md`](../release/current-b7c9451-config-gates-observation-2026-08-19-1155.md)。

补充记录（2026-08-19，档案引用输入边界）：旧端档案接口返回的 `data.patId` 是预约、报告和门诊费用共用的临床引用，不能接受
数字形式的 Provider schema。新 adapter 严格保留字符串 `patId`，并用完整脱敏包络测试确认
身份证、手机号和 `patCardVOList` 不进入内部公共结果；本轮未调用真实 Provider，未修改旧项目、数据库、Redis 或线上服务。

补充记录（2026-08-19 11:43–11:44 CST）：重启后只读检查发现新 API 远端 MySQL 曾短暂出现 `PROTOCOL_CONNECTION_LOST`，readiness
一度为 `not_ready`，随后 database/Redis/schema 自动恢复为 `ok`；新旧服务监听、release 和旧 Python 均未改变。服务器本机 3306
不是新 API 的数据库目标，根分区约 95% 使用率需要单独运维关注。该事件只记录运行层恢复，不增加患者、预约、报告、费用或真机证据，详见
[`../release/current-b7c9451-database-transient-observation-2026-08-19.md`](../release/current-b7c9451-database-transient-observation-2026-08-19.md)。

通过 SSH 只读确认该观察窗口 release 为 `b7c9451`、`hospital-platform-api-v2.service` 为 `active`；服务进程环境中的
`ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false` 均为显式关闭。报告目录/详情因此继续
保持 `503 dependency-not-configured` 的 fail-closed 边界，不调用 Provider、不把空列表伪装成真实结果，也不因页面已经存在就打开 gate。

补充记录（2026-08-19，报告来源差异）：旧端报告页实际包含 LIS、PACS、ECG 和体检 PEIS 四类请求；新端前三类只有只读目录/LIS
详情骨架，PEIS 仍需要完整身份证号和独立患者归属 contract，PACS/ECG 详情、附件和报告解读也未冻结。旧端非 LIS 报告对象会写入
本地缓存的做法不迁移。详细停止条件见 [`report-provider-contract-audit-2026-08-19.md`](report-provider-contract-audit-2026-08-19.md)。

补充记录（2026-08-22，当前候选报告只读复核）：对照旧端真实报告查询链后，确认新端当前实现只把 LIS/PACS/ECG 投影为安全目录摘要，
并仅在服务端建立 owner + patient + TTL 短期引用时开放 LIS 详情；PEIS 身份证查询、PACS/ECG 详情、附件下载和报告解读继续保持关闭。
本轮报告 domain、adapter、API service、小程序 API client 和静态验收均通过，未打开真实 Provider gate。详见
[`../release/report-readonly-migration-audit-2026-08-22.md`](../release/report-readonly-migration-audit-2026-08-22.md)。

门诊病历的 `/api/v2/medical-records` 仍刻意未注册。旧端 `out-visit-records` 只有历史调用线索，尚未获得正式请求/响应 contract、
患者映射确认、字段脱敏白名单和权限/错误样例；本轮不新增 schema、adapter、service、页面或兼容转发。待 Provider/HIS 材料齐全后，
必须先完成 intake 和差异表，再按 contract → adapter → API → 小程序 → 测试 → 验收手册顺序推进。

补充记录（2026-08-19 11:20 CST）：重启后重新读取微信开发者工具，新 `miniprogram` 窗口的资源树仍为 `dist/`，但没有形成新的
真机二维码、手机连接或可绑定的独立真机调试窗口；一次入口操作也没有产生可复核的“当前候选来源 + 有效二维码 + 设备连接”证据链。
因此本次不把模拟器画面、页面变化或 Network 面板变化计入微信登录、患者切换、预约、门诊费用、报告或其它业务验收。旧 `mp-weixin` 窗口继续排除，
旧 Python 服务、线上新 API、数据库和 Redis 均未触碰。下一步仍需在新 `miniprogram` 窗口人工重新生成二维码并扫码，再按
[`../release/miniprogram-device-session-boundary-2026-08-18.md`](../release/miniprogram-device-session-boundary-2026-08-18.md) 同时采集设备归属、页面结果、
HTTP `traceId/requestId` 和低敏服务端日志。

## 历史 release 基线（2026-08-19 00:50 CST，不覆盖顶部当前基线）

补充记录（2026-08-19 00:48–00:50 CST）：服务端 `b7c9451` 已从 `c26e696` 原子切换到线上 `current`，只重启新 API；
P0 日志聚合已经使用同链 `correlation` bundle，内外网运行层和旧 Python `8001` 共存复核通过。第一次无密码 sudo
被服务器拒绝后已精确回滚并复核，再使用标准 sudo 完成切换；没有修改旧服务、数据库、Redis 或 Worker。完整记录见
[`../release/b7c9451-production-acceptance-2026-08-19.md`](../release/b7c9451-production-acceptance-2026-08-19.md)。

补充记录（2026-08-18 23:37 CST）：服务端 `b7c9451` 曾作为未切换候选完成远端 checksum、真实生产依赖 preflight 和隔离 runtime smoke；随后已按受控窗口切换，当前事实以本节最新记录为准。候选只修正 P0 日志同 `traceId/requestId` 关联链门禁，不改变业务路由开放状态；旧 Python `8001` 未触碰，候选过程见 [`../release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md`](../release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md)。

### 2026-08-19 00:48 CST 前的历史运行窗口（不覆盖上方当前基线）

补充记录（2026-08-18 23:40 CST）：当前 `c26e696` 重启后日志窗口已形成患者目录读取 `12/12`、同步 `6/6` 的同链服务端证据；微信登录、患者切换设备结果、预约历史、门诊费用、报告和普通资料仍不能由日志总数补齐，详见 [`../release/current-c26-p0-business-observation-2026-08-18-2340.md`](../release/current-c26-p0-business-observation-2026-08-18-2340.md)。

补充规则：P0 日志门禁现在还要求业务成功链包含 HTTP `2xx` 完成事件，且不能同时出现同链 `http.request.failed`；这只是证据真实性门禁，不会把当前日志或未验收页面升级为真实业务完成。

补充记录：`387b4a3` 候选已完成该门禁的远端 checksum、真实生产 preflight 和隔离 runtime smoke，但尚未切换线上；当前业务未完成项和真机停止条件不变，详见 [`../release/candidate-387b4a3-http-success-gate-2026-08-18.md`](../release/candidate-387b4a3-http-success-gate-2026-08-18.md)。

最新日志窗口（2026-08-18 23:49 CST）在当前 `c26e696` 上观察到微信登录 `1/1`、患者读取 `14/14`、同步 `7/7` 的同链 HTTP `2xx` 证据；这仍没有页面和患者显式切换证据，预约历史、门诊费用、报告、普通资料和真机三层验收保持未完成，详见 [`../release/current-c26-p0-business-observation-2026-08-18-2349.md`](../release/current-c26-p0-business-observation-2026-08-18-2349.md)。

最新运行复核（2026-08-18 23:54 CST）：误重启后系统 uptime、`current=c26e696`、新旧监听和 `hospital-platform-api-v2.service` 均未漂移，`18082` 无残留；内外网 live/ready 均为 200，ready 依赖为 `database/redis/schema=ok`。当前 P0 日志门禁仍只通过微信登录、患者读取和同步，预约历史、门诊费用、报告和普通资料没有业务链；这次记录不增加真机、多患者切换或 Provider 业务证据，详见 [`../release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md`](../release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md)。

本节优先于下方历史盘点记录。当前服务端 release 为 `7181e99e`，生产切换与新旧服务共存证据见
[`../release/7181e99e-production-acceptance-2026-08-22.md`](../release/7181e99e-production-acceptance-2026-08-22.md)。下方仍保留
`687690e`、`4ae2a31`、`bf67b96`、`52e9624`、`0995f7c` 等历史窗口，引用它们时必须按历史证据理解，不能覆盖本节的当前状态。

- 当前小程序运行输入来源为 `4e1b2e2`，本轮完整构建已生成并通过 `runtime:verify`；`dist/build-info.json` 的来源指纹为
  `4e1b2e224964797c103eba832323ee7074c7ad2b`，注册页面和生成脚本均为 14 个；本轮患者上下文
  将患者目录与普通资料拆成关键路径和可降级增强；用户已有的
  `apps/miniprogram/project.config.json` 修改仍未触碰、暂存或提交。
- 2026-08-19：小程序微信登录与 `/me` 会话恢复已增加客户端 canonical 运行时响应门禁；登录只在完整校验后写入 token，
  会话恢复只接受安全 owner 引用，协议错配不伪造已登录。提交 `c727e1c`，小程序定向测试 152/152、1215 个断言和类型检查通过；
  该门禁不替代微信真机、服务端同链日志、Redis TTL 或 Provider 业务证据，详见
  [`../release/miniprogram-auth-session-response-contract-2026-08-19.md`](../release/miniprogram-auth-session-response-contract-2026-08-19.md)。
- 2026-08-19：患者、预约和门诊费用列表读取统一先验证 `success/data` 平台包络，再进入业务字段校验和白名单重投影；
  门诊费用额外拒绝重复 `recordId` 和无效中国标准时间日历值，预约扩展字段不会进入页面。提交 `31ce94a`，小程序定向测试
  154/154、1231 个断言和类型检查通过；该修正不改变 Provider、数据库、Redis、线上服务或旧 Python，详见
  [`../release/miniprogram-list-response-envelope-contract-2026-08-19.md`](../release/miniprogram-list-response-envelope-contract-2026-08-19.md)。
- 2026-08-19：修正“我的”页资料与患者目录并行读取的会话代际风险；资料 GET 先完成或降级，患者目录再从最新会话代际读取，避免旧患者与新资料混合；无可用会话时停止后续患者读取，并在新周期清空旧患者卡片和数量。提交 `3a66d12`，小程序定向测试 154/154、1235 个断言和类型检查通过，详见
  [`../release/miniprogram-my-page-session-generation-order-2026-08-19.md`](../release/miniprogram-my-page-session-generation-order-2026-08-19.md)。
- 2026-08-19：预约科室/排班客户端已补齐第二道 canonical 响应门禁，覆盖唯一标识、公开展示字段、请求科室归属、
  日期、时间分组和号源数量；异常整批 fail-closed。该门禁只保护两列级联只读展示，不代表 Provider、真机或预约写入
  已完成，详见 [`../release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md`](../release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md)。
- 2026-08-19：报告目录/LIS 详情客户端已补齐第二道 canonical 响应门禁，覆盖报告来源、状态、详情引用匹配、检测项枚举和
  临床展示文本；异常整批 fail-closed。该门禁不打开报告 Provider、影像/心电详情或附件下载，详见
  [`../release/miniprogram-report-readonly-response-contract-2026-08-19.md`](../release/miniprogram-report-readonly-response-contract-2026-08-19.md)。
- 2026-08-18 23:27 CST：P0 业务证据门禁新增同一 `traceId/requestId` 关联链校验；日志聚合只输出 SHA-256
  指纹和事件计数，跨请求拼接的 `requested/success` 总数不再通过。该修正只影响验收工具和 worker bundle，未打开
  预约写入、支付、医保、HIS 或任何新的业务路由。
- 当前服务器 release 为 `7181e99e`，新 Bun/Elysia API 监听 `10.0.0.3:18081`，旧 Python API 继续监听
  `0.0.0.0:8001`；本轮只重启新 API，没有覆盖、停止或修改旧服务。生产 preflight、隔离 live/ready/system-ping/401 smoke、
  原子切换和 readiness 均通过，MySQL、Redis、schema 为 `ok`，schema 基线为 `0016_patient_directory_sync_owner_index`。
- `687690e` 切换后的 journald 低敏启动窗口 `parseErrors=0`、`systemdWarningCount=0`，只有服务启动、健康探针和预期未登录 401；
  没有新的预约历史、门诊费用、报告或微信业务事件，因此本次发布只证明运行层和 adapter fail-closed 边界，不推进真实业务验收。
  完整 provenance 见 [`../release/687690e-production-acceptance-2026-08-18.md`](../release/687690e-production-acceptance-2026-08-18.md)。
- 2026-08-18 21:22 CST 使用当前 release 的 `redis-session-ttl-audit.js` 进行只读 TTL 审计；应用 Redis 账号没有
  `SCAN` 权限，安全结果为 `verified=false`、`redis-session-scan-unavailable`、退出码 `2`。没有扩大常驻 ACL，
  因此会话数量和 TTL 范围仍未验证，详见 [`../release/687690e-redis-session-ttl-observation-2026-08-18.md`](../release/687690e-redis-session-ttl-observation-2026-08-18.md)。
- 2026-08-18 16:44 CST 公网只读复核再次通过 live/ready，ready 返回 `database/redis/schema=ok`；未登录资料接口返回预期 401。
  该结果只证明公网运行层和认证边界，不增加微信会话、患者切换、预约、报告或费用业务证据。
- 2026-08-18 19:36 CST 重启后公网只读探针再次确认 live/ready/system-ping 为 200，ready 的 `database/redis/schema` 均为 `ok`，
  未登录 profile/patients 均为 401；当前环境 SSH 仍无法建立，因此没有新增新旧监听端口或 systemd 共存证据，详见
  [`../release/current-public-readonly-smoke-2026-08-18-1936.md`](../release/current-public-readonly-smoke-2026-08-18-1936.md)。
- 2026-08-18 20:25 CST 本地重启后再次从公网只读复核 live/ready/system-ping 为 200，ready 的 `database/redis/schema` 均为 `ok`，
  未登录 profile/patients 均为 401；本次仍未携带微信会话，也没有产生预约、报告、门诊费用或患者切换业务事件，详见
  [`../release/current-public-readonly-smoke-2026-08-18-2025.md`](../release/current-public-readonly-smoke-2026-08-18-2025.md)。
- 2026-08-18 21:36 CST 通过 SSH 只读确认 `current=687690e`、新旧监听和 `hospital-platform-api-v2.service=active` 未漂移，公网 ready
  的 `database/redis/schema` 均为 `ok`；本次仍未携带微信会话或业务参数，也没有修改旧服务，详见
  [`../release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](../release/current-runtime-coexistence-readonly-2026-08-18-2136.md)。
- 2026-08-18 16:48 CST 公网 `GET /api/v2/medical-records` 返回 `404/not-found`，确认病历路由仍未注册；这是关闭边界证据，不代表病历功能已经迁移。
- 历史 release `9acdaf2` 曾观察到预约历史 `itemCount=60`、`statusCounts={cancelled:60}`，在线标签排除已取消记录的空态符合当时规则；
这不能回填为当前 `5a31427` 的业务事件。全部挂号继续保持迁移提示，因为独立 `requestChannel=4` Provider contract 尚未冻结。
- 当前下一步是取得真机微信会话并按候选验收手册重新采集页面、HTTP trace 和低敏日志三层证据；在此之前不开放全部挂号、预约写入、详情、
  支付、医保或 HIS 回写。

### 早于当前 `687690e` 的历史运行窗口
- 2026-08-18 12:31 CST：重启后线上只读复核仍确认新旧服务共存；正确内网探针为 `10.0.0.3:18081/health/ready`，
  不应把服务绑定的非 loopback 地址误写成 `127.0.0.1:18081`。内网和公网 ready 均为 `200` 且 database、redis、schema 为 `ok`，
  该证据只覆盖运行层，不推进预约历史、门诊费用或真机业务状态。详见
  [`../release/restart-coexistence-readonly-audit-2026-08-18.md`](../release/restart-coexistence-readonly-audit-2026-08-18.md)。
- 2026-08-18 12:38 CST：应用会话重启后再次只读复核，`c63dba9`、`10.0.0.3:18081`、旧 Python `0.0.0.0:8001`
  和内外网 readiness 均保持正常；本次没有新的预约历史、爽约、门诊费用或报告业务事件，Redis TTL 仍未验证。
- 2026-08-18 12:42 CST：公网未登录访问患者目录、普通资料、预约历史和门诊费用均返回 `401/unauthorized`，
  认证边界正常，但该结果不替代真实微信会话、患者切换或 Provider 只读业务证据。
- 2026-08-18 12:47 CST：重启前只读复核确认当时 release 为 `c63dba9`，新 Bun `10.0.0.3:18081` 与旧
  Gunicorn `0.0.0.0:8001` 同时监听，内网 `/health/ready` 与公网 `/api/v2/health/ready` 均返回 200，
  `database/redis/schema` 均为 `ok`；本次没有业务写入、release 切换或旧服务操作。
- 2026-08-18 12:49 CST：架构边界 62/62、迁移台账、Provider 文档接收审计和 lint 通过；除用户已有的
  `apps/miniprogram/project.config.json` 外，218 个源码/工具文件定向格式检查通过。全量格式检查仍仅被该用户文件的
  未格式化差异阻断，本轮不修改、不暂存、不提交该文件。

完整历史切换与候选证据见 [`../release/687690e-production-acceptance-2026-08-18.md`](../release/687690e-production-acceptance-2026-08-18.md)；
`9acdaf2`、`c63dba9` 和更早文档保留为历史 release 证据。
此前 `0995f7c` 的切换和 2026-08-18 02:54 CST 运行时只读快照仍作为历史证据保留，分别见
[`../release/0995f7c-production-acceptance-2026-08-18.md`](../release/0995f7c-production-acceptance-2026-08-18.md) 和
[`../release/0995f7c-current-runtime-observation-2026-08-18-0254.md`](../release/0995f7c-current-runtime-observation-2026-08-18-0254.md)；
历史快照只覆盖当时的 release、双服务监听和 health/ready，不包含当前业务请求或 journald 业务计数。

## 1. 盘点结论

旧端当前有 64 个 Vue 页面，新原生小程序有 20 个 TypeScript 页面源文件。新端已经形成患者端的第一条纵向切片，
但还不是旧端的功能等价替换：

页面之外的旧端请求封装、WebSocket、状态仓储、问卷/随访组件和静态业务配置，不能按“公共工具”视为已迁移；
它们的实际行为和禁止兼容方式见 [`legacy-client-infrastructure-boundaries.md`](legacy-client-infrastructure-boundaries.md)。

旧服务 Redis/MongoDB、APScheduler、文件资源、AI/WebSocket 和 Admin/RBAC 的运行边界另见
[`infrastructure-and-operations-boundaries.md`](infrastructure-and-operations-boundaries.md)；连接探针通过不等于这些能力已替代。

```text
已形成代码闭环（服务端真实微信登录与单患者同步已有受控生产证据，预约科室/排班曾在配对候选中取得真实只读与快照持久化证据，但当前 release 的其他只读域和真机证据仍待重新采集）：登录 -> 患者目录 -> 选择患者 -> 只读预约/报告/费用查询 -> 爽约记录安全筛选
已迁移旧端静态能力：医院列表单院区卡片、公众号通知说明、意见反馈帮助页、院内导航静态地图（均不含动态机构/路线或授权能力）；旧端意见反馈没有真实提交接口，消息订阅只有本地假保存，因此不复制假业务
仍缺业务契约：患者新增绑定、病历、住院、便民、AI、预约写入、支付、医保、HIS、二维码、公众号关注/订阅；医院列表仍缺动态机构/院区/路线 contract
仍缺真实证据：Redis 实际 TTL、多就诊人切换/失效恢复、众阳预约历史/报告/门诊费用、公网分域真机页面和生产回归；预约科室/排班当前已取得只读与快照持久化证据，上一版快照暂时不可用仅保留为历史故障
```

### 2026-08-16 二次盘点证据

- 旧端 `hospital-app/src/pages` 与 `src/pagesB` 共扫描到 64 个 Vue/页面源文件；当时新端
  `apps/miniprogram/src/pages` 共 14 个 TypeScript 页面源文件，`src/app.json` 也注册 14 个页面，
  本次没有发现漏登记页面。
- 新端构建会动态读取 `app.json`，检查每个注册页面的 `.json/.wxml/.wxss/.ts` 源文件和 `dist/*.js` 是否生成；
  API 测试会检查 OpenAPI 的每个 method/path 是否出现在 [`api-v2-public.md`](../api-v2-public.md)，因此“页面存在但
  构建找不到 JS”和“路由存在但接口文档漏写”已有自动门禁。门禁通过只证明清单一致，不证明 provider、生产或真机业务完成。
- 原生小程序构建还会逐页检查 WXML 事件绑定确实存在于 `Page` 实现、`wx.navigateTo` 的页面目标已经在
  `app.json` 注册、WXML 本地 `/assets` 引用真实存在，并拒绝 WXSS 通过 `background-image` 读取本地图片；
  这把此前真机才暴露的页面 JS 缺失、跳转 404 和 WXSS 本地资源错误提前到构建阶段。
- 当前架构边界审计为 26 条规则，并扫描 `apps/miniprogram/src` 全部生产文本源码；它会阻止 provider
  地址、旧请求封装、旧患者标识、WebSocket 配置和万能转发残留重新进入原生小程序。历史发布证据中的
  19/19 是当时的审计快照，不代表当前规则数量。
 - 旧版本生产切换证据（历史快照）为：`current=0b6f38f`、新 API `18081` active、旧 Python `8001` 继续监听、Worker
   `inactive/disabled`；该记录不代表当前线上 bundle。当前服务器状态以 2026-08-17 22:57 CST 的只读观察为准，详见
   [`../release/current-server-p0-observation-2026-08-17-2257.md`](../release/current-server-p0-observation-2026-08-17-2257.md)。
- 文档记录的最近一次生产 capability 复核（证据快照，不代表当前 `main` 或当前线上状态；同为历史复核）显示微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；
  报告目录、报告详情和微信支付为 `disabled`。因此报告页面只能保留 fail-closed 迁移提示，不能把页面
  注册或 readiness 200 写成报告已迁移。
- 本轮非页面逻辑复核覆盖了旧端 `src/api`、`src/stores`、`src/utils`、健康业务复用组件和静态配置，
  重点核对 `httpZy.ts` provider 直连、`ws.ts` token/patId query、患者状态仓储、unionId 查询、
  `navigateToMiniProgram`/`web-view` 外部入口、文件下载和微信支付调起。新端生产源码只通过
  Hospital API client 访问平台接口，没有发现新的 provider 直连、WebSocket、万能转发或文件/二维码
  业务遗漏；这些边界仍保持“未迁移/待契约”，详细证据见
  [`legacy-client-infrastructure-boundaries.md`](legacy-client-infrastructure-boundaries.md)。
- 服务器已为新 API 安装并验证 `ps` 的窄权限 systemd 操作；权限只覆盖新 API 的状态/重启，不覆盖旧 Python
  unit、Worker 或任意通配符命令。候选切换与回滚步骤仍以 [`../../infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)
  为准，不需要也不允许触碰旧 Python unit。
- 本轮收到 2.6.7 挂号登记、2.10.4.2 支付挂号和 2.6.65.7 外部退款 3 份 Provider HTML 文档，
  已按 [`../provider-intake/2026-08-16-appointment-registration-payment-refund.md`](../provider-intake/2026-08-16-appointment-registration-payment-refund.md)
  登记 SHA-256、字段和状态；它们当前只能标记为 `normalized`。文档引用的执行预约、排班/号源、患者档案、
  支付登记和退款查单依赖尚未齐全，故没有打开预约写入、支付挂号或退款 route/gate。

- 2026-08-17 只读复核旧项目 `hospital-app/docs` 时发现 7 份此前未进入 Provider intake 台账的材料：门诊待支付列表、
  科室基础信息、用户信息、门诊结算信息、山西医保规范和微信医保支付订单材料；已按
  [`../provider-intake/2026-08-17-legacy-document-discovery.md`](../provider-intake/2026-08-17-legacy-document-discovery.md)
  登记文件大小、更新时间、SHA-256、风险分类和冻结边界。`2.6.33` 仅用于核对现有门诊费用只读 adapter；科室/用户
  信息仍是潜在目录依赖；2.27.2.27、医保规范和微信医保材料属于高风险 contract，不能直接打开费用详情、支付、医保
  或 HIS 回写。同期发现的 `PatientHospitalSelector.md` 是内部 UI 组件说明，已在登记文档中明确排除，不计入 Provider
  文档数量，避免把 UI 资料误判为接口契约。

- 2026-08-17 已完成 `2.1.9` 科室基础目录和 `2.1.13` 院内用户资料的 contract diff，详见
  [`directory-contract-diff-2026-08-17.md`](directory-contract-diff-2026-08-17.md)。这两个 `base-common` 接口不能
  替代当前预约使用的 AMC 科室/排班接口，也不能替代平台用户资料、患者目录或“我的医生”关系；Provider 用户/机构
  标识、证件、医保、签名、角色和图片字段继续留在服务端待确认边界，不新增通用公共目录路由。

- 前序提交 `ff5ea6e` 已补充 P0 业务事件链证据门禁：安全日志聚合必须按业务域同时出现请求和明确成功事件，
  `parseErrors` 或成功事件缺失时验收失败。该工具只约束服务端日志证据，不把日志计数当作患者归属、HTTP、页面或
  真机完成证据；本轮未部署，线上 release 仍需重新取得 provenance。

- 2026-08-16 23:19-23:20 CST 当前公网只读观察确认 `/api/v2/health/live`、`/api/v2/health/ready`、
  `/api/v2/system/ping` 均正常，ready 的 database/redis/schema 均为 `ok`；未登录患者目录仍返回 401，
  刻意冻结的 `/api/v2/medical-records` 返回 404。该证据只覆盖公网运行时和关闭边界，不能替代真实微信、
  患者 Provider、预约/报告/费用只读或真机验收；完整 requestId 见
  [`../release/current-public-readonly-smoke-2026-08-16.md`](../release/current-public-readonly-smoke-2026-08-16.md)。

- 2026-08-17 公网只读复核再次确认 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping`
  返回 200，ready 的 database/redis/schema 均为 `ok`；刻意关闭的 `/api/v2/medical-records` 仍返回 404。
  本次未携带会话，也未查询服务器进程，因此不能替代真实微信、患者 Provider、预约/报告/费用只读、真机或
  新旧服务共存证据；requestId 和限制见 [`../release/current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md)。

- 2026-08-17 `ca5a372` 切换后核对确认新 Bun API 正在 `10.0.0.3:18081` 监听、旧 Python API 仍在 `0.0.0.0:8001`
  监听；随后约 02:30 CST 原子切换到 `527d163`，`hospital-platform-api-v2.service` 仍为 active/running，
  服务器 current 指向 `527d163`，Worker 仍 inactive。这证明运行层新旧服务共存，不证明任何患者端 Provider、
  支付或真机业务完成；完整限制见 [`../release/527d163-production-acceptance-2026-08-17.md`](../release/527d163-production-acceptance-2026-08-17.md)。
- 同次进程和生产配置脱敏核对确认 Bun API 与旧 Python 共用远端 MySQL `8.130.127.184:3306/hospital-dev`，
  新 API 使用 `hp_*` 表、旧服务继续使用 legacy 表；Redis 则分别使用 DB3 和 DB1。本机 `127.0.0.1:3306/6379`
  虽可达但不是 Bun 当前连接目标，MongoDB/旧 Redis namespace/旧任务仍不属于已迁移能力。

- 同次 journald 复核发现 MySQL/schema 探针存在多次 unavailable/recovered 抖动，并出现过微信登录
  `PersistenceUnavailableError`/503；虽然随后有一次登录和单患者同步成功，但当前不具备多患者、TTL、失效恢复
  和只读业务稳定验收证据。P0 顺序已调整为先定位依赖抖动并取得连续稳定观察，再进入预约历史、门诊费用和报告验收；
  详见 [`../release/current-production-observability-audit-2026-08-17.md`](../release/current-production-observability-audit-2026-08-17.md)。

日期窗口的服务端跨度、客户端窗口和 provider 待确认项已单独记录在
[`date-window-boundary-audit.md`](date-window-boundary-audit.md)；这部分不能用页面数量或列表 `total` 推断为已完成 provider 分页。

### 当前新端能力的准确状态

> 本表的当前验收基线为服务端 `8eb51b5ffe85b0b8f8a032783f893117d3df549d` 与小程序 `13f597ea9ee3f65b9be858117826d948339d904a`（`13f597e`）的分层配套。表内更早提交或历史线上窗口只用于说明实现来源，
> 不能替代当前 release 的页面、客户端 HTTP 和服务端 Pino 三层证据。

| 能力 | 新端代码 | 业务状态 | 不能宣称的内容 |
| --- | --- | --- | --- |
| 微信登录与平台会话 | `auth`、Redis session | 线上 `13f597ea` 已通过 production preflight、隔离 smoke、公网 readiness 和认证边界检查；当前小程序尚无新的真实微信真机业务事件 | Redis 实际 TTL、多就诊人切换、完整真机网络对齐和其他业务仍未完成；日志成功不等于页面验收 |
| 患者目录与切换 | `patients`、独立选择页 | 目录同步、脱敏、owner 隔离、`0013` 快照 schema 和代码级完整快照状态模型已实现；此前受控窗口曾同步 1 条 active 患者并建立 1 条 `his-patient` 映射，但该历史事实不能替代当前 release 的真机证据；页面首帧、读取/同步期间及失败时均不绘制未经确认的当前标记并保持 fail-closed | 真实失效/恢复数据、多患者显式切换、切换后的真机页面证据和新增/绑定家属仍未完成；绑定写入草案见 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md) |
| 普通个人资料 | `profile`、`pages/profile/profile` | 0014 表、owner/version API、小程序资料页、生产未登录 401，以及 2026-08-18 配对模拟器的 `GET /me/profile` 200 已验证；`ca46091` 又补充了 service 对仓储读模型的 owner、字段、版本二次校验和白名单投影，避免脏资料先记录成功事件 | 本轮未执行 PUT；真实微信默认值/首次更新/409 冲突和真机证据仍未完成；头像、实名、手机号不属于本能力 |
| 预约科室/排班 | `appointments/departments`、`schedules` | 历史 `41c9c18` 曾取得真实 Provider 科室/排班只读结果并出现 `snapshotPersistenceStatus=persisted`；当前代码仍只接受已确认的 `usableSourceNum`，页面两列级联和排班分批渲染正常 | `13f597ea` 尚待重新取得当前候选的多次稳定、公网/真机网络证据；缺少 `usableSourceNum` 的响应会 fail-closed；不能锁号、不能把 `scheduleId` 当成写入授权 |
| 预约历史/爽约筛选 | `appointments/records`、`missed-appointments` | contract、服务端状态映射、挂号记录页和 `missed` 派生页已实现；在线范围固定 `requestChannel=3` 并排除服务端明确的 `cancelled`，全部范围固定 `requestChannel=4` 并保留完整历史中的取消记录；当前 `8eb51b5` 服务端最近 24 小时出现 9 次成功只读同步事件，详见 [`current-production-readonly-observation-2026-08-25.md`](../release/current-production-readonly-observation-2026-08-25.md) | 当前 release 尚未完成同一运行包的客户端、公网、Provider 和真机三层证据；未知状态不能推导为爽约，详情/取消/预问诊/预约写入仍关闭；历史渠道审计见 [`request-channel-4-all-records-contract-audit-2026-08-18.md`](request-channel-4-all-records-contract-audit-2026-08-18.md) |
| 报告目录/详情 | `reports`、目录/详情页 | 目录和短期 opaque 详情引用骨架已实现；跨 LIS/PACS/ECG 合并目录按严格可解析时间倒序，未知 Provider 时间放到末尾；当前服务最近 24 小时报告请求均为 `401`，没有成功 Provider 观察，详见 [`current-production-readonly-observation-2026-08-25.md`](../release/current-production-readonly-observation-2026-08-25.md) | 报告真实 provider、文件下载、PACS/ECG/体检详情未验收；Provider 新时间格式仍须先取得脱敏样例，目录/详情 gate 继续关闭 |
| 门诊费用 | `payments/outpatient/records` | 只读目录已实现，查询时间显式使用 `Asia/Shanghai`；当前 `8eb51b5` 服务端最近 24 小时出现 4 次 `requested → loaded` 成功观察，但尚未取得金额非空样例和同一运行包的客户端/公网/真机闭环，详见 [`current-production-readonly-observation-2026-08-25.md`](../release/current-production-readonly-observation-2026-08-25.md) | 真实微信真机证据、费用详情、金额非空样例、支付、医保、结算回写和退费未开放；空列表或低敏 loaded 事件不能替代费用字段和支付链路验收 |
| 医院列表 | `pages/hospital-list/hospital-list` | 单医院静态卡片、受控本地原图、顶部院区提示和预约前置跳转已迁移 | 动态医院/院区目录、多院区选择、真实坐标/路线和版本化机构数据未迁移 |
| 公众号说明 | `pages/official-account/official-account` | 旧端运行时静态通知说明已迁移；旧端二维码区域本身是注释代码，未有关注 API | 二维码、关注状态、订阅消息授权和真实发送结果属于未来新增能力 |
| 意见反馈帮助 | `pages/feedback/feedback` | 旧端实际只有热点问题、客服电话和 Toast；新端保留静态内容并明确提示未开放，拨号需用户确认 | 真实反馈写入、客服工单、电话/工作时间受控配置属于未来新增能力 |
| 院内导航 | `pages/hospital-navigation/hospital-navigation` | 旧端静态地图、背景色、`aspectFit` 和点击预览已迁移 | 楼层/科室定位、实时路线和地图服务未迁移 |
| 微信支付 | 订单、预支付、通知、查单基础设施 | 代码基础和 gate 已具备 | 商户、回调、公网和真机支付未验收；gate 必须关闭 |
| 医保/HIS | domain/规则层部分存在 | 规则边界和文档基础存在 | 真实加密、授权、6201/6202/6301/6203/6401、HIS 回写均未迁移 |
| 健康知识 | contract/domain/repository、版本化 schema、导入校验、旧表映射文档、受保护只读路由和原生页面已具备 | 明确 fail-closed，正式内容未发布 | 内容来源/临床审核、staging 发布撤回、内容真机证据仍未完成 |
| 管理端/Worker | Worker 与持久化基础部分存在 | 运维边界和支付补偿基础存在 | RBAC 管理端、监控、通用任务管理、文件管理和后台日志查询未迁移为新 API；详见 [`infrastructure-and-operations-boundaries.md`](infrastructure-and-operations-boundaries.md) |

### 2026-08-22 剩余 P2 与健康知识复核

本轮再次对照旧端页面矩阵、接口清单和新端组合根检查后，没有找到可以在不猜 Provider/HIS contract 的情况下安全扩大范围的 P2
功能。门诊病历、患者绑定、二维码、健康知识和支付/医保分别缺少正式 contract、内容/权限/状态证据或真实验收材料，继续保持未注册或
关闭状态。健康知识的具体判断、代码事实和开放顺序见
[`../release/next-safe-migration-audit-2026-08-22.md`](../release/next-safe-migration-audit-2026-08-22.md)。

这条记录的含义是“停止条件已确认”，不是“剩余功能已经完成”；当前执行顺序仍优先补齐已开放只读业务的真机三层证据。

## 2. 按旧端页面的剩余清单

### P0：当前纵向切片必须先完成的验收

这些项目代码大部分已经存在，下一步不是增加新 UI，而是补真实证据和一致性：

- 患者目录重新同步后，确认每个患者都有正确的 `his-patient` 映射；完整快照缺少映射时必须清除旧 `patId`，预约历史、报告、门诊费用必须在 provider 请求前失败。
- 首页、患者选择页、预约历史、报告目录、门诊费用切换患者后，确认不会沿用上一个患者的异步响应或列表；首页从选择页返回时即使本地旧 ID 未变化，也必须重新读取目录，避免 inactive/空目录仍展示旧患者。
- 已有本地选择但该患者在最新 owner-scoped 目录中失效时，页面必须要求用户显式重新选择；只有首次没有历史选择时才默认目录第一位，禁止用 `patients[0]` 静默切换到另一位患者。
- 首页下拉刷新必须等待健康检查和服务端目录读取完成；患者选择页还必须等待医院目录同步完成后再结束刷新指示器，并在完整同步成功前禁止点击患者返回，避免用户在临床映射仍未落库时进入预约、报告或费用业务；首页普通刷新不隐式放大为 provider 同步。
- 首页和“我的”页的患者目录并发回写已在代码中使用最后一次请求获胜守卫；仍需在真机验证会话恢复、下拉刷新、同步和返回选择页同时发生时的展示结果。
- 首页或“我的”页的患者目录/临床映射读取失败时，必须清理当前页面展示状态但保留本地显式选择和可重试 token；不能把旧患者卡片当作当前认证事实。
- 首页和患者选择页的患者同步通过 `services/single-flight.ts` 使用单飞 Promise，自动恢复、生命周期回调和手动刷新不会在同一页面实例内重复进入 provider；执行成功或失败都会释放锁，允许下一次刷新重新读取。这只是客户端第一层保护，跨页面/跨进程仍必须依赖服务端 owner-scoped operation ledger 和 `Idempotency-Key`。
- 原生页面的请求守卫和患者同步单飞状态已统一收敛到 `services/page-instance-state.ts` 的 `WeakMap`；不能把 `createLatestRequestGuard()` 或 `createSingleFlight()` 放在页面模块顶层，否则两个同类页面实例会互相淘汰请求或共享同步 Promise。该边界已有页面静态门禁和实例隔离单元测试，但仍需真机页面栈切换验证。
- 门诊费用在“待缴费/已缴费”之间切换时，查询必须使用用户本次点击的状态快照，不能因为小程序 `setData` 异步回写而读取旧 tab。
- 门诊费用首次读取患者目录期间切换 tab 不能取消初始 owner-scoped 请求；只能记录最后点击状态，患者上下文确认后再查询费用，避免页面停在无法恢复的空状态。
- 预约目录切换左侧科室或下拉刷新时，确认旧科室排班不会覆盖当前科室，旧请求也不会恢复旧的日期分组和号源列表；下拉刷新开始即清空旧科室和号源读模型，失败时不得继续把上一轮目录当作当前事实；合法空科室目录必须展示明确空态。
- 患者目录同步使用 provider 请求发起时间做快照版本；较早请求晚返回时，不能覆盖较新的患者资料、临床映射，
  也不能重新激活已被新快照标记为 inactive 的患者。
- 2026-08-21 发现并修正不同幂等键接管后的旧响应竞态：旧 operation 即使暂时仍为 `in_progress`，也必须在患者写入前
  通过 `completedAt` 与 `lease_until` 栅栏校验；校验失败直接返回过期快照错误，不会留下短暂的患者资料或临床映射污染。
  该修正只影响新项目本地代码和测试，尚未替代真实 MySQL 并发、Provider 延迟响应、线上日志和真机证据，详见
  [`../release/patient-sync-lease-fencing-2026-08-21.md`](../release/patient-sync-lease-fencing-2026-08-21.md)。
- 原生小程序的患者目录读取和同步共用 `requirePatientListData` 运行时门禁，除列表总数外重新校验唯一 opaque
  ID、关系/来源/临床访问枚举、展示文本和脱敏卡号，并只投影公共字段；异常 JSON 必须整批 fail-closed，不能
  伪装成空目录或默认换人。该门禁只保护客户端协议边界，不能替代服务端 owner/HIS 映射；详细规则见
  [`../release/miniprogram-patient-read-model-contract-2026-08-19.md`](../release/miniprogram-patient-read-model-contract-2026-08-19.md)。
- 预约目录曾在历史配对候选中取得真实 Provider、内网 API 和微信开发者工具只读证据，且 `snapshotPersistenceStatus=persisted`；该观察不自动回填为线上服务端 `6db3217b` 与小程序 `4ba492a` 的业务证据。预约历史、报告、门诊费用仍需分别完成线上 release 的 provider、内网 API、公网 HTTPS 和真机四层证据；`13f597ea` 切换后还要重新验证预约历史双范围。
- 排班只读快照的 `observedAt` 与 `expiresAt` 必须使用同一次服务端时钟采样；快照有效只表示近期观察事实，不能单独授权锁号、预约或支付。
- 预约只读目录的 adapter 会拒绝重复科室/排班主键；预约历史 adapter 也会拒绝重复的 `appointmentInfoId`，
  但不会为缺少预约号的摘要伪造稳定公开记录 ID，原生页面的渲染 key 不能作为可写入或详情引用。
- 排班号源只接受当前 contract 已确认的 `usableSourceNum`；旧端不同接口的 `usableNum` 和 `remainingNumber` 不作为
  fallback，字段缺失时拒绝整批响应，避免把错误号源数量展示给患者或误作锁号前置事实。
- 统一 `unauthorized`、`patient-selection-required`、`dependency-not-configured`、provider 暂时不可用和空列表的用户态文案与日志事件。
- 预约记录、爽约记录、报告目录和门诊费用页现在统一通过 `loadCurrentPatient` 读取最新 owner-scoped 患者目录并解析 ready 患者；该读取门禁不会隐式触发 Provider 同步，避免只读页面并发制造同步租约冲突。详见 [`patient-context-read-contract.md`](patient-context-read-contract.md)。
- 爽约记录只允许展示服务端已归一化的 `missed`；`unknown`、空列表和 provider 未返回不能推断爽约，且当前只覆盖过去 90 天窗口；“我的挂号”仍使用当前日前后各 90 天。停诊、替诊和已登记必须保留为独立状态，不能误显示为未知。
- 受保护 API 已在 Elysia 的 route schema 校验前建立模块级认证边界：缺少或失效 Bearer 时统一返回 `401 unauthorized`，只有认证通过后才进入 query/body/params 的 `400 validation`；微信登录和微信支付回调仍保留明确公开入口。该行为已有 API 集成测试、候选 smoke 和 `131fb5a` 公网回归证据；这只证明认证错误边界，不代表真实微信会话或业务 Provider 已完成。
- 患者目录失效回收已使用“active/inactive + 事务快照”实现；`0013` 已完成生产 migration 和 schema probe，仍需真实失效/恢复验收，不能直接删除 `hp_patients`。
 - 患者同步的 durable operation ledger、租约代次和重放分支已经在代码与 `0015_patient_directory_sync_operations` 中实现，`0016_patient_directory_sync_owner_index` 已在当前生产 schema 中应用，为同一 owner/provider 的不同幂等键增加活跃租约查询索引；`a11f117` 已取得单患者真实同步成功证据，但真实并发、第二条患者记录、失效/恢复、公网真机和切换业务验收仍待完成，具体状态机见 [`patient-sync-idempotency-contract.md`](patient-sync-idempotency-contract.md)、[`../release/patient-sync-0016-readiness-audit-2026-08-17.md`](../release/patient-sync-0016-readiness-audit-2026-08-17.md) 和 [`../release/0b6f38f-production-acceptance-2026-08-17.md`](../release/0b6f38f-production-acceptance-2026-08-17.md)。

### 旧端顶层页面的重分类

旧端 `src/pages` 另外包含 5 个页面，它们不能因为不在 `pagesB` 清单中而被遗漏：

| 旧页面 | 当前状态 | 迁移边界 |
| --- | --- | --- |
| `pages/index/index.vue` | 已被原生首页替换 | 保留首页患者上下文、服务入口和底部导航；不保留旧端 provider 直连 |
| `pages/user/user.vue` | 已被原生“我的”页部分替换 | 患者选择、挂号记录和普通个人资料已接入；头像、实名、反馈、订阅消息等扩展入口仍未迁移 |
| `pages/consult/consult.vue` | 部分迁移 | 新端已具备患者栏、今日/未来/历史标签和稳定查询状态壳；智能陪诊/导诊仍需要独立会话、免责声明、内容审计和外部服务 contract，旧端实时消息、预约历史和叫号队列的拆分见 [`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md) |
| `pages/hospital/hospital.vue` | 已注册安全状态壳 | 互联网医院入口已进入原生主 Tab 和统一迁移状态页，但外部小程序/医院服务协议未确认，不能伪造站内页面；固定 WebView、通用 URL 代理和短期票据边界见 [`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md) |
| `pages/setting/setData.vue` | 开发辅助页，不纳入生产迁移 | 不进入生产 `app.json`，保留在旧端作为测试工具即可 |

### P1：取得新的 provider 文档后迁移

| 旧页面/入口 | 缺失内容 | 必要前置 |
| --- | --- | --- |
| `pagesB/hospital/department_select`、`doctor_card`、`timeslot_source` | 科室/医生/号源详情、分时段号源和写入前确认 | 新 AMC 目录/号源 contract、字段白名单和 TTL；`2.1.9` 基础科室目录不能直接替代 AMC |
| `pagesB/hospital/confirm_registration`、`registration_detail` | 预约确认、预约详情和状态刷新 | 锁号、预约写入、最终状态查询、幂等与取消矩阵 |
| `pagesB/health/outpatient_pay_detail`、`electronic_bill` | 费用明细和可支付金额展示 | 费用详情 contract、金额单位和患者归属规则 |
| `pagesB/health/report_query`、`report_detail` 的真实能力 | LIS/PACS/ECG/体检真实数据、附件和详情授权 | provider 文档、资源 URL/短期授权、数据脱敏规则 |
| `pagesB/health/electronic_record` | 门诊病历目录、内容和结构化字段；旧端实际调用 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，病历正文接口另有定义 | HIS/EMR 只读 contract、资源授权和脱敏清单；必须先确认 `thirdPatientId` 经 `patInfosFind(type=3)` 得到的 HIS `patId` 是否能复用现有 `his-patient` 引用；目录差异草案见 [`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)，整体边界见 [`medical-record-and-hospital-boundary.md`](medical-record-and-hospital-boundary.md) |
| `pagesB/account/follow` | 公众号说明 | 静态说明已迁移至 `pages/official-account/official-account`；二维码、关注状态、订阅消息和外部主体 contract 仍缺 |
| `pagesB/user/feedback` | 意见反馈 | 静态帮助页已迁移至 `pages/feedback/feedback`；真实反馈写入、客服工单和受控配置仍缺 |
| `pagesB/hospital/hospitalList` | 医院列表 | 静态单院区入口已迁移至 `pages/hospital-list/hospital-list`；医院列表数据来源、机构选择语义和版本 contract 仍缺 |
| `pagesB/hospital/navigation` | 静态院内地图已迁移；实时楼层/科室定位未迁移 | 原始 `map.jpg`、`aspectFit`、点击预览已完成；动态地图数据、定位和路线 contract 待确认 |
| `pagesB/hospital/bloodAppointment` | 采血预约 | 采血服务 contract、号源状态和取消规则 |

### P2：内容和便民服务逐域迁移

| 旧页面组 | 页面范围 | 当前状态 | 迁移方式 |
| --- | --- | --- | --- |
| 健康百科/药品 | `health_encyclopedia`、`disease_detail`、`drug_detail`、`search_result` | 新端已挂载受保护的版本化只读路由和原生页面；无 published bundle 时 fail-closed | 只迁移审核后的版本化内容；不能直接复制旧数据库正文 |
| 健康自测 | `health_test`、`self_test_question`、`self_test_result`、BMI/血压计算 | 未迁移 | 题目、分值和结果必须版本化并经临床复核；BMI/血压计算还需确认适用人群、阈值、输入边界和免责声明；先不开放自动风险判断，详见 [`health-calculator-contract-draft.md`](health-calculator-contract-draft.md) |
| 风险评估 | `risk_self_evaluation`、`risk_form_*` | 未迁移 | 题目、分值、风险分级和建议必须版本化并经临床复核；未知版本拒绝写入，不能把客户端风险结论当权威；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 预问诊/随访 | `pre_visit`、`admission_preconsultation`、`discharge_followup*` | 未迁移 | 旧端按原始 `pat_id` 和 JSON 数组保存，且不同表单可能按 `(user_id, pat_id)` 互相覆盖；必须先绑定预约/住院/随访任务、问卷版本、患者授权、幂等和医护读取权限；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 电子锦旗/表扬信 | `list_*`、`gift_*`、`record_*` | 未迁移 | 旧端可提交伪造的患者/医生/就诊字段，且 `display_type=1` 不等于已审核公开；必须完成内容安全、审核、脱敏展示、撤回和幂等；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 我的医生 | `pagesB/patient/doctor.vue` | 未迁移 | 旧端保存客户端医生快照，重复关注非幂等且使用 GET 删除；必须依赖受控医生目录、owner 关系、命令语义、唯一约束和审计；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 智能陪诊/导诊 | `consult`、`webview`、`my_consultation` | 未迁移 | 独立 AI/会话 contract、免责声明、模型和知识版本审计 |

### P3：患者个人中心与低风险账户能力

- `user/user.vue` 目前已由新端“我的”页、普通个人资料页和就诊人选择页组成安全子集；爽约记录已提供基于预约历史读模型的安全筛选子页，但真实 provider/公网/真机证据仍未完成；头像、实名资料、真实意见反馈提交、订阅消息、咨询历史、公众号真实关注、我的医生和患者签名尚未迁移。公众号静态通知说明和反馈帮助页的旧端静态行为已经迁移，但不代表未来关注、工单或反馈提交能力已开放；旧端反馈和订阅当前没有真实后端事实，不能复制假保存；详见 [`static-and-closed-feature-parity.md`](static-and-closed-feature-parity.md)，普通资料契约见 [`user-profile-contract.md`](user-profile-contract.md)，总边界见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md)。
- `patientAdd`、`patientChange` 的真实建档/绑卡接口尚未开放；旧端在查询档案失败时可能继续建档，当前“添加就诊人”只能显示迁移边界，不得伪造成功。候选状态机、字段白名单、幂等和待 provider 确认问题见 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md)。
- `patient/agreement`、隐私授权、患者签名需要重新确认法律文本、授权记录和撤回策略，不能只复制旧页面；跨小程序票据和 WebView 规则见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md)。

### P3：旧端非页面逻辑

- `httpZy`、`ws.ts` 和 `utils/index.ts` 仍包含直连 provider、token/patId 传递、unionId 查询和万能 URL 代理等旧边界；新端不得复制，必须由服务端 adapter、短期会话引用或专用实时 contract 替代。
- Pinia 用户/患者 store 仍会持久化旧身份、provider 患者号、卡号和身份证字段；新端只能持久化平台会话和 opaque `patientId`，并以当前 owner 的服务端读模型为准。
- `SelfTestEngine`、`selfTestConfig`、出院随访组件和院区选择器承载医疗/患者上下文逻辑；它们不是普通 UI 组件，需先完成临床审核、版本、授权、任务绑定和回滚规则。
- 首页/我的页 JSON 导航和旧底部 Tab 包含未注册页面与外部资源；新端只能跳转 `app.json` 已注册且完成 contract 的页面。详见 [`legacy-client-infrastructure-boundaries.md`](legacy-client-infrastructure-boundaries.md)。

### P4：费用、医保和外部回写（按用户要求最后处理）

- `outpatient_pay` 的真实支付、`payment_cashier`、医保授权和结算结果；
- `registration_medical_pay`、挂号医保支付、微信自费/混合支付；
- FSI `1101/6201/6202/6301/6203/6302/6401`、查单、退款、回调去重和补偿；
- 云健康 `medical-settlement-notify` / `medical-settlement-complete` 和 HIS 最终回写；
- 二维码：必须取得扫码字段、签名、TTL、撤销/防重放和医院设备证据后才实现。

## 3. 新 API 与旧 API 的差异风险

当前新端不是旧接口的路径替换，而是安全读模型。新的 provider 文档到达前，以下差异必须保持冻结：

1. 小程序只调用 Hospital API；任何 provider URL、token、provider 患者号和支付签名都不能进入小程序。
2. 业务输入使用内部 `patientId`；服务端根据 owner 和用途解析外部引用，禁止让客户端提交 `patId`、`thirdPatientId` 或金额。
3. 只读查询与写入命令分开；费用目录不能直接变成支付订单，排班目录不能直接变成锁号授权。
4. HTTP 成功只表示请求被接收/读模型生成；预约、支付、医保和 HIS 必须有独立的最终状态事实。
5. 旧服务继续运行在原边界；新端新增 route、migration 或 gate 必须能独立回滚，不修改旧服务的业务表语义。

## 4. 新接口文档到达后的冻结模板

新的文档获取方式接入后，每一个接口在实现前必须登记以下信息；缺任何一项都只能进入“待核对”，不能写成兼容猜测：

| 类别 | 必须记录 |
| --- | --- |
| 来源 | 文档名称、版本、发布日期、适用环境和 provider 联系/确认人 |
| 请求 | method、path、query/body/header、必填/条件字段、编码、单位、示例 |
| 身份 | token/签名/证书、调用方、患者标识来源、权限和有效期 |
| 响应 | 成功 envelope、业务成功条件、字段类型、枚举、空值和分页语义 |
| 失败 | HTTP/业务错误码、是否可重试、超时后的最终查询方式和人工处理方式 |
| 状态 | 状态机、幂等键、并发冲突、锁/过期/取消/退款/回写顺序 |
| 金额 | 元/分/字符串精度、总额守恒、各支付渠道边界和舍入规则 |
| 安全 | PII、日志禁止字段、回调验签、短期引用、脱敏和审计要求 |
| 证据 | golden fixture、sandbox 响应、内网/公网/真机验收步骤和回滚方案 |

### 文档变更规则

- 新文档与旧代码冲突时，先更新 contract/ADR 和差异记录，再修改 adapter；不能只改一处字段映射。
- 只有 provider 文档不能证明真实权限；还要有受控请求、响应和失败样例。
- 文档未说明的字段不进入公共 contract；先保留在 adapter 内部并标为待确认，不能“为了兼容”透传。
- 每完成一个域，必须同步更新 `docs/migration/api-matrix.md`、本清单、日志文档和验收手册。

## 5. 下一步执行顺序

1. 先完成 P0 的真实只读验收和患者上下文竞态审计，不扩大功能面。
2. 接收新的 provider 文档后，冻结预约写入、门诊费用详情、病历和报告资源的 contract 差异表。
3. 爽约记录安全筛选子页已完成代码闭环，但不替代真实验收；静态医院列表已恢复预约前置流程，取得新的 provider 文档后，优先选择病历目录等低风险只读域完成 contract → adapter → API → 小程序 → 测试 → 验收手册闭环。医院列表不能把静态卡片扩展成动态业务，仍等待机构/院区/路线 contract。
4. 健康知识已经完成旧表/接口映射和导入前置校验；仍必须先做内容审核和版本化导入，再挂载患者 GET 路由；自测、AI 和报告解读继续分开。
5. 便民服务先按 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) 完成 contract 和旧数据隔离，再按“医生关系只读 → 患者反馈 → 临床问卷 → 预约后预问诊/出院随访”推进；provider/临床资料不足时不注册患者 API。
6. 最后按“现金支付 → 医保授权/结算 → 查单/退款 → HIS 回写”推进，任何未知状态都进入人工/补偿队列，不在前端显示成功。

## 6. 当前不做的事情

- 不根据旧页面字段猜新的预约写入、二维码、医保或支付接口。
- 不为了页面看起来完整而把未验收页面接到旧 provider 万能转发。
- 不删除旧服务、旧表或旧端口；不在文档证据不足时打开生产 gate。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> **当前事实源覆盖旧段落（2026-08-26）**：请以运行输入/pending 来源 `a6319d7`、20 个原生页面、`286 pass / 0 fail / 3217 expect()` 和 pending 运行包为准；本页前置的 `baa31df0`/17 页文字只作历史交接。
> **当前本地源码候选纠正（2026-08-26，优先级高于本文下方旧交接段落）**：最新运行输入/pending 来源为 `a6319d79f9f1e940ea5bcbd2ab7fe6500345466f`，原生页面 20 个，当前工作树复跑为 `286 pass / 0 fail / 3217 expect()`；候选仍在 pending，`dist` 被开发者工具锁定。本文下方旧候选、17 页和 `258 pass` 的表述均为历史交接，不得作为当前真机入口。
