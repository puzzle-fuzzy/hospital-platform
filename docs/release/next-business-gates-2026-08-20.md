# 下一阶段业务门禁执行板（2026-08-20）

> 本文是新会话继续工作的短入口，不替代各业务域的详细 contract、代码测试或真实验收记录。
> 当前服务端候选为 `5a31427`，当前本地小程序候选为 `6ce1272`，完整运行包来源为
> `6ce12729c3e112a6cb8333c5132c23713d1cb1ec`。小程序尚未上传线上。
>
> 本轮只维护新项目文档和执行顺序；不修改旧 Python 服务、不中断旧 `8001`、不写线上 MySQL/Redis，
> 也不触碰并行会话正在维护的众阳自动化代码。

## 2026-08-21 `5a31427` 当前候选运行层复核

服务端已从 `6038560` 原子切换到 `5a31427`，只重启新 API；新 API `18081`、旧 Python `8001` 共存，Worker 保持 inactive。
真实 production preflight、隔离 `18082` runtime smoke 和公网 `/api/v2` smoke 均通过；完整发布证据见
[`5a31427-production-acceptance-2026-08-21.md`](5a31427-production-acceptance-2026-08-21.md)。
这只证明新候选运行边界，不能替代微信、患者、预约或门诊费用的真机三层业务证据。

## 2026-08-21 03:54 CST 后的业务事件观察

`5a31427` 切换完成后，SSH 只读窗口只观察到服务启动和 readiness 请求，没有新的
`auth.*`、`patient.*`、`appointment.*` 或 `outpatient.payment.*` 业务事件。因此本轮日志多请求
trace 保留修正尚未取得真实 Provider 三层业务样例；下一次真机操作必须从当前二维码重新开始，
并同时记录页面结果、客户端 HTTP 与服务端低敏日志。旧 Python `8001` 未修改、未停止。

最新 SSH 只读窗口（2026-08-21 04:29 CST）仍只有 3 条基础 HTTP `200`，没有业务事件；
服务端 `5a31427` active，新 API `18081` 与旧 Python `8001` 共存。该空窗口记录见
[`current-5a31427-p0-business-observation-2026-08-21-0429.md`](current-5a31427-p0-business-observation-2026-08-21-0429.md)，
不能替代真机业务证据。

2026-08-21 04:51 CST 的最新 SSH 只读观测仍确认 `5a31427` active、`10.0.0.3:18081` 与旧 Python
`0.0.0.0:8001` 共存；最近 30 分钟没有新的微信、患者、预约、门诊费用或普通资料业务事件。
本窗口没有修改配置、重启服务、调用 Provider 或写入 MySQL/Redis，详见
[`current-5a31427-p0-business-observation-2026-08-21-0451.md`](current-5a31427-p0-business-observation-2026-08-21-0451.md)。

2026-08-21 05:45 CST 的最新复核改用实际监听地址 `10.0.0.3:18081`，readiness 的 database/Redis/schema 均为 `ok`；
回环地址 `127.0.0.1:18081` 不属于新 API 监听地址。最近 30 分钟仍没有业务事件，详见
[`current-5a31427-p0-business-observation-2026-08-21-0545.md`](current-5a31427-p0-business-observation-2026-08-21-0545.md)。

2026-08-21 05:47 CST 的公网只读 smoke 确认 live/ready/ping 为 `200`，未登录业务读取为 `401`，病历/医保授权/预约写入为 `404`；
live/ready 返回 `no-store`。该结果只证明公网路由边界，不替代真机业务证据，详见
[`current-public-readonly-smoke-2026-08-21-0547.md`](current-public-readonly-smoke-2026-08-21-0547.md)。

2026-08-21 05:54 CST 的 SSH 只读复核再次确认 `5a31427` active、Worker inactive、新 API `10.0.0.3:18081` 与旧 Python
`0.0.0.0:8001` 共存，readiness 的 database/Redis/schema 均为 `ok`；最近 30 分钟仍没有 P0 业务事件。
这只说明当前没有新的真机请求，不能替代三层业务证据，详见
[`current-5a31427-p0-business-observation-2026-08-21-0554.md`](current-5a31427-p0-business-observation-2026-08-21-0554.md)。

2026-08-21 06:03 CST 再次通过 SSH 只读复核：当前 release 仍为 `5a31427`，新 API `10.0.0.3:18081` 与旧 Python
`0.0.0.0:8001` 共存，Worker 仍为 inactive；readiness 的 database/Redis/schema 均为 `ok`，最近 30 分钟业务事件计数仍为 `0`。
本次没有修改配置、重启服务、调用 Provider 或写入 MySQL/Redis；由于没有新的微信扫码请求，当前候选的真机登录、患者切换、预约历史和门诊费用
三层证据仍未变化，下一步仍需使用 `6ce1272` 新二维码开始人工操作。

## 2026-08-21 当前候选只读业务复核

本次代码复核基于服务端 `5a31427`、小程序候选 `6ce1272`；本节只检查代码、领域 contract、adapter、页面状态机和本地测试，
没有调用真实 Provider，没有修改线上配置，也没有把模拟器或历史日志当作真机验收证据。

### 已确认的业务边界

- 预约历史只使用已确认的微信渠道 `requestChannel=3`，服务端通过 owner-scoped 的 `his-patient` 映射取得 Provider 患者引用；小程序只接收白名单摘要和归一化状态。在线标签只排除明确的 `cancelled`，爽约页只接受服务端明确归一化的 `missed`，不能把 `unknown` 或空列表猜成爽约。
- “全部挂号”仍然是关闭状态。旧端渠道 `requestChannel=4` 的独立请求、字段、状态、错误和权限合同尚未冻结，不能用渠道 3 的结果拼接或改标签伪装完成。
- 门诊费用只开放待缴/已缴只读目录；服务端固定最近 30 个中国标准时间日，adapter 只把 Provider `tradeStatus=1/3` 映射为 `unpaid/paid`，金额只读取已确认的 `amount` 并精确转换为分。旧端 `waitPayAmount`、费用详情、支付调起、医保授权、结算回写和退费均不属于当前读模型。
- 预约详情、预问诊和费用详情没有稳定且已授权的公共引用，因此页面保留入口位置但给出迁移提示；不能把数组下标、Provider 预约号或费用单号拼进小程序 URL。
- 三个页面均在新一轮 owner-scoped 读取开始时清空上一位患者的卡片和列表，并在会话代际、页面请求令牌和当前显式患者三者同时有效时提交结果；这条逻辑已由小程序页面测试覆盖。
- 普通资料页额外在页面栈重新可见时执行 `onShow` 会话重读；首次展示不重复请求，后续展示不依赖用户手动下拉来清除旧账号资料。

### 本地验证证据

| 范围 | 结果 |
| --- | --- |
| API 预约记录/门诊费用 service | 35 项通过，139 个断言 |
| 众阳预约/门诊费用 adapter | 32 项通过，70 个断言 |
| 领域 contract | 5 项通过，7 个断言 |
| 原生小程序 | 169 项通过，1359 个断言 |
| 运行包 | `runtime:verify` 通过；14 个页面齐全，`dist/` 不含测试脚本 |

这些结果证明当前 fail-closed 代码边界一致，不证明当前 release 已取得 Provider、HTTPS、页面和真机三层业务证据。
下一步必须用同一候选重新采集真实微信会话，再按“预约历史 → 爽约筛选 → 门诊费用待缴/已缴”的顺序逐域闭环；任何一域
出现患者归属、状态、金额、日期或 trace 不一致，都停止该域并回到 contract 审计。

## 1. 当前门禁状态

| 业务域 | 当前代码状态 | 当前能证明的事实 | 下一道真实证据 | 未满足时的处理 |
| --- | --- | --- | --- | --- |
| 运行层与未开放能力边界 | 已实现 | `b4a73c4` 新增 `closed-boundary` smoke；`9f21324` 记录当前公网生产模式复核：live/ready/ping 为 `200`、保护路由为 `401`、7 条关闭路径为 `404/not-found` | 每次服务端候选发布都重新执行 `/api/v2` smoke，并确认日志为 `environment=production` | 任一关闭路径返回 `401`、`2xx`、代理层非平台 `404` 或出现 Provider 事件，立即停止发布和业务验收 |
| 微信登录与会话 | 已实现 | code 形状校验、session TTL、owner 解析和安全日志通过本地门禁 | 真机登录、`/me`、会话失效恢复的 HTTP 与日志同链 | 停止后续患者业务，不把扫码成功当作登录成功 |
| 患者目录与显式切换 | 已实现 | owner-scoped 目录、临床映射、失效选择和异步代际保护已覆盖 | 当前候选下真实同步、多患者切换、切换后页面/请求归属 | 旧患者残留、映射不一致或过期快照立即停止当前域 |
| 普通资料 | 读写已实现 | 字段白名单、版本更新、`null` 清空和 409 语义已覆盖 | 首次读取/更新、双设备冲突、真机页面与低敏日志 | 409 不自动覆盖，重新读取后再操作 |
| 预约历史/爽约 | 只读已实现 | 在线渠道 3、状态白名单、90 日窗口和 `missed` 派生规则已覆盖 | 当前 release 的 Provider、HTTPS、真机三层证据 | 不把未知状态推断为爽约；不开放全部渠道 |
| 门诊费用目录 | 只读已实现 | 待缴/已缴、元转分、30 日中国标准时间窗口和资源上限已覆盖 | 非空金额样例、当前 release 的 Provider、真机三层证据 | 不调起支付，不把空列表当作费用链路完成 |
| 报告目录/详情 | 代码骨架存在，Provider gate 关闭 | 多 Provider trace 有界聚合、owner/患者/TTL 校验已覆盖 | 医院确认的目录、详情、附件和授权 contract | 保持 `dependency-not-configured` 或安全错误，不展示伪造数据 |
| 门诊病历 | 未注册 | 旧端仅确认过调用路径，未确认字段与空/失败语义 | EMR/HIS contract、脱敏样例、页面验收 | 不把报告目录冒充病历，不新增兼容转发 |
| 新增/绑定就诊人 | 入口关闭 | 风险和 PB-01 至 PB-16 缺口已登记 | 查档、建档、绑卡、幂等、撤销和授权 contract | 保持迁移提示，不接受身份证替卡号或查档失败后继续建档 |
| 健康知识 | API 未挂载 | schema、导入器、发布/撤回边界及正文换行一致性已实现，但没有审核内容 bundle | 脱敏导出、责任确认、staging 发布演练和患者页面验收 | 不导入旧正文，不用 fixture 冒充生产内容 |
| 支付/医保/HIS | 最后专项 | 规则和文档基础存在，真实状态机未开放 | 微信支付、医保授权/结算、6201/6202/6301 等全链路合同 | 不因只读费用成功而打开支付或回写 |

## 2. 执行顺序

```text
运行层 live/ready + auth-boundary + closed-boundary smoke
  ->
真机微信会话
  -> 患者目录同步
  -> 用户显式选择就诊人
  -> 我的挂号 / 爽约记录
  -> 门诊费用只读
  -> 普通资料读写
  -> 报告 Provider 合同确认后单独验收
  -> 病历、绑卡和内容域按各自 contract 排期
  -> 支付、医保、退款和 HIS 回写最后专项
```

每个已开放只读域都必须在同一候选版本下同时取得：

1. 页面结果：截图或可复核的真机页面状态；
2. 客户端 HTTP：脱敏路径、状态码和 `traceId/requestId`；
3. 服务端日志：同链 `requested`、明确业务成功、HTTP `2xx` 和低敏 Provider 诊断。

只有三层证据属于同一会话、同一患者、同一时间窗口时，才能把该域从“代码已实现/待验收”改为“真实已验收”。
`ready 200`、模拟器页面、单个 HTTP `200`、历史 release 日志或空列表都不能替代这三层证据。

## 3. 统一停止条件

- session、owner 或患者目录无法确认；
- 切换患者后仍出现上一位患者的卡片、列表、请求参数或日志关联；
- Provider 返回字段、状态、时间、金额或引用超出已冻结 contract；
- 业务成功事件缺失，或同一关联链出现 HTTP 失败；
- 日志出现 code、token、AppSecret、Provider Authorization、姓名、完整卡号、身份证号、手机号、HIS `patId` 或原始报文；
- 未开放入口出现支付、医保授权、退款、预约写入、HIS 写入或伪造成功；
- 需要修改旧 Python 时无法先证明 `8001` 进程、监听和回滚边界不会受到影响。

## 4. 关联文档

- 真机操作与三层证据：[`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md)
- 当前候选证据记录模板：[`miniprogram-real-device-evidence-template-6ce1272.md`](miniprogram-real-device-evidence-template-6ce1272.md)
- 只读业务不变量：[`readonly-business-chain-audit-2026-08-20.md`](readonly-business-chain-audit-2026-08-20.md)
- 当前候选来源：[`candidate-6ce1272-local-build-2026-08-21.md`](candidate-6ce1272-local-build-2026-08-21.md)
- 当前公网关闭边界与 smoke 证据：[`current-public-closed-boundary-2026-08-21.md`](current-public-closed-boundary-2026-08-21.md)
- 报告 Provider 门禁：[`report-readonly-contract-audit-2026-08-18.md`](report-readonly-contract-audit-2026-08-18.md)
- 病历准入草案：[`../migration/medical-record-directory-contract-draft.md`](../migration/medical-record-directory-contract-draft.md)
- 患者绑定准入草案：[`../migration/patient-binding-contract-draft.md`](../migration/patient-binding-contract-draft.md)
- 医保/支付最后专项：[`../migration/payment-contract.md`](../migration/payment-contract.md)
