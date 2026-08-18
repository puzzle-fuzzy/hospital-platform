# 迁移差距审计与下一阶段冻结计划（2026-08-17）

本文是当前迁移目标的差距审计，不把“页面已注册”“接口返回 200”“生产 readiness 正常”
误写成业务迁移完成。新会话应先阅读本文，再进入具体业务 contract。

## 1. 审计基准与证据等级

| 等级 | 证据 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| A | contract、domain、adapter、测试、页面构建 | 代码边界和本地不变量存在 | Provider 可用、生产数据正确、真机可用 |
| B | 生产 preflight、schema probe、readiness、启动日志 | 运行依赖和 release 具备启动条件 | 业务 Provider 返回正确、页面业务完成 |
| C | 受控 Provider 请求、providerRequestId、低敏结果 | Provider 字段和状态在当前环境可用 | 公网代理和真机页面一定走同一链路 |
| D | 公网 HTTPS 请求和反向代理日志 | 公网路由、鉴权和响应边界正确 | Provider 业务结果一定正确 |
| E | 微信开发者工具/真机页面与服务端 trace 对齐 | 页面、网络和服务端链路一致 | 写入、支付或 HIS 最终状态自动成功 |

任何业务域只有在适用的 A～E 证据齐全后，才能标记为“真实已验收”。写入、支付、医保和 HIS
还必须额外具备最终状态、幂等、补偿和回滚证据。

## 2. 当前事实

- 当前线上 release 为 `1b94c46`，已完成 production preflight、隔离 runtime smoke 和只重启新 API 的无损切换；旧 Python `8001` 继续运行。2026-08-18 15:25 CST 的 `4ae2a31` 属于上一轮历史切换记录。
  本次切换只包含微信身份边界修复和候选运行包，不增加预约写入、支付、医保、报告或 HIS 能力；真实微信/患者/只读业务证据仍待。
- 旧端扫描基线为 64 个页面，原生小程序当前注册 14 个 TypeScript 页面；旧 FastAPI 与旧小程序
  的接口快照仍由 `legacy-api-endpoint-inventory.md` 维护。
- 2026-08-17 复核旧仓库时发现 `module_common` 从原台账的 34 个漂移到 38 个挂载路由，旧服务
  总挂载数从 191 漂移到 195；同时发现 4 条挂号插件支付/退款入口和第 3 个微信支付调起页面。
  这些事实已补入旧端清单并通过 `pnpm migration:audit`，状态仍为“最后处理”，没有因此开放新端
  支付、医保、退款或 HIS 回写接口。
 - 当前线上新 API release 为 `1b94c46`，监听 `18081`；配套小程序构建来源为
   `77588b566d98facfac7b1d952e41d8db875278d4`；旧 Python 服务继续监听 `8001`，旧服务、
  旧 Redis namespace 和旧端口不能因为新端验收而停止。
- `41c9c18` 已取得预约科室 62 条、排班 1 条的真实只读结果，并确认
  `snapshotPersistenceStatus=persisted`。这只为未来写入评估提供近期观察事实，仍不是锁号或预约授权。
- 上一 release `c63dba9` 切换后受控日志窗口曾通过微信登录 `4/4`、患者目录读取 `20/20`、患者同步 `10/10` 的请求/成功门禁；
  Redis 实际 TTL、第二位患者、多患者切换和完整真机链路仍未完成。
- 预约写入、锁号、取消、支付、医保、退款和 HIS 回写继续关闭；Worker 不因只读验收而启动。
- 2026-08-17 公网只读复核再次确认 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping`
  均返回 200，ready 的 database/redis/schema 均为 `ok`；`/api/v2/medical-records` 仍返回 404。
  这只证明公网运行和关闭边界，不证明会话、Provider 业务、真机或新旧服务共存；完整 requestId 与限制见
  [`../release/current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md)。
- 当前切换后 SSH 核对确认新 Bun API 监听 `10.0.0.3:18081`、旧 Python API 监听 `0.0.0.0:8001`，
  `hospital-platform-api-v2.service` 为 active/running，服务器 current 指向 `1b94c46`，Worker 仍 inactive。这补强运行层共存证据，
  但不能替代业务和真机证据；当前 release 的完整记录见
  [`../release/1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md)。
- 进程 TCP 连接和两侧配置的脱敏比对确认 Bun API 与旧 Python 共用远端 MySQL
  `8.130.127.184:3306/hospital-dev`，新 API 使用 Redis DB3、旧 Python 使用 Redis DB1；新服务只使用
  `hp_*` 表，旧服务继续使用 legacy 表。该事实不代表 MongoDB、旧 Redis namespace、旧任务或管理端能力已迁移。
- 2026-08-17 00:52:49-00:52:59 CST 公网 readiness 连续 6/6 为 `ready` 且三项依赖为 `ok`；该窗口约 10 秒，
  仅作为恢复后的短观察，不足以替代长稳定窗口或远端 MySQL 错误证据。
- 同次 journald 复核发现 database/schema 探针多次 unavailable/recovered，且微信登录曾因
  `PersistenceUnavailableError` 返回 503；一次后续成功同步仍只有 1 位患者。该运行稳定性问题在未定位前阻断
  P0 真实业务验收；事件、脱敏证据和下一步见
  [`../release/current-production-observability-audit-2026-08-17.md`](../release/current-production-observability-audit-2026-08-17.md)。
- `527d163` 已完成真实生产 preflight、临时端口候选 smoke、原子切换和公网 runtime smoke；公网 readiness 连续 6/6、no-store、system ping 和未登录 401 均通过。该版本只增强持久化瞬态故障的安全诊断字段，不增加写入重试。`ca5a372` 切换后曾出现一次真实微信登录 503，约 3 秒后重试成功；由于当时没有底层安全错误码，根因仍待下一次样本或平台日志交叉确认。该稳定性证据已解除“候选运行前置未验证”阻断，但不解除真实微信、多患者、Provider 或真机业务门禁，详见 [`../release/527d163-production-acceptance-2026-08-17.md`](../release/527d163-production-acceptance-2026-08-17.md)。

### 2.1 本轮业务审计修正

- “我的”页首次 `onShow` 原先用 `loading` 推断是否已经展示；快速完成的首个请求会触发重复读取。
  现在统一使用页面实例内的 `hasShown`：首个 `onShow` 只消费 `onLoad` 请求，返回患者选择页或资料页后才重新读取，
  并增加原生生命周期静态回归门禁。
- 患者上下文新增一条 fail-closed 规则：空目录只清空当前页面的展示数据，不能删除
  `selected_patient_id`。这样 provider 暂时空响应或账号暂时没有绑定患者时，目录恢复后仍会
  识别历史选择为 `stale`，不会静默默认到另一位患者。
- 明确的清理入口仍只有会话失效、退出登录或用户主动清除上下文；患者选择页点击新患者时
  才写入新的 opaque `patientId`。该边界已加入原生 acceptance 测试和业务正确性文档。
- 门诊费用读模型的 `recordId` 不再依赖 Provider 返回数组下标；当前 adapter 使用服务端内部稳定
  单据/就诊/项目标识组合生成哈希，并对缺少稳定标识或重复 ID 的响应 fail-closed，避免后续详情、支付
  编排因排序或状态变化错绑费用记录。
- 预约历史状态不再把旧接口已确认的 5/6/7 折叠为 `unknown`，现在分别映射为 `stopped`（停诊）、
  `substituted`（替诊）和 `registered`（已登记）；未知数字仍保持 `unknown`，爽约页仍只筛选明确的
  `missed`。
- 原生“我的挂号”查询窗口已修正为当前中国标准时间日前后各 90 天，避免未来预约静默消失；爽约页
  独立使用过去 90 天窗口，避免把未来日期混入爽约派生逻辑。
- 预约排班日期边界仍保留一个待收敛的 v2 过渡点：服务端当前校验真实日期和 31 天跨度，但排班请求的
  startDate/endDate 仍由调用方提交；原生端使用中国标准时间未来 7 天。Provider 的 endDate 包含规则和
  公共调用方范围确认前，不擅自改成完全服务端生成，也不扩大日期范围或开放写入。
- 预约历史 adapter 现在会拒绝同一响应中的重复 `appointmentInfoId`；没有预约号的记录仍只作为摘要
  返回，不用数组下标或日期字段伪造后续业务引用。
- `d71ecd4` 与 `3609944` 又收紧了 Provider 读模型的公开边界：门诊费用科室/医生/账单日期分别限制为
  128/128/64 字符，LIS 详情单位限制为 64 字符，避免异常文本在 Elysia 响应校验阶段才变成不可定位的错误。
- `7a03df7` 对照 2.6.33 输出表后移除了门诊费用 `waitPayAmount`、`registerDept`、`registerDoctor` 的 fallback；
  当前只使用已确认的 `amount`、`billDeptName`、`billDocName`、`billDate`，只有旧端候选金额而没有 `amount` 时整批
  fail-closed，避免把未确认金额带入公共读模型或未来支付编排。
- 本轮继续对照 2.6.33 响应中的 `tradeStatus` 收紧门诊费用读模型：请求 `unpaid` 只接受返回值 `1`，请求 `paid`
  只接受返回值 `3`；字段缺失、无法识别或状态错配时整批 fail-closed。此前服务端直接使用查询 tab 贴状态标签，
  可能把异常返回伪装成正确的待缴/已缴记录；该修正只保护只读事实，不打开支付、医保或结算。
- 本轮继续收紧预约排班号源边界：`usableSourceNum` 是当前唯一接受的可用号源字段；旧端不同接口中的
  `usableNum`/`remainingNumber` 不再作为 fallback，字段缺失时拒绝整批排班响应，避免显示错误号源或把只读结果误作锁号依据。
- 本轮补齐 Provider 文本和排班快照引用的安全边界：预约/费用展示字段与 `scheduleId`、provider 排班引用、
  request id 均拒绝控制字符和首尾空白，相关失败在 adapter/domain/persistence 层保持 fail-closed；这只保护
  只读事实和未来写入前快照，不打开预约写入、支付、医保或 HIS。

## 3. 剩余内容分层

### 3.1 先完成已有代码的真实只读验收（P0）

这些能力已经有新端代码，但还不能称为业务迁移完成：

| 能力 | 当前代码边界 | 缺失证据/风险 | 下一动作 |
| --- | --- | --- | --- |
| 患者会话与目录 | 微信登录、`/me`、患者同步、独立选择页 | Redis 实际 TTL、多患者切换、inactive/恢复、页面栈竞态 | 用受控账号补 TTL 与多患者样例；不把页面默认第一人当作切换成功 |
| 预约历史/爽约 | 只读摘要和 `missed` 派生筛选；状态保留停诊/替诊/已登记；我的挂号前后各 90 天、爽约过去 90 天 | 当前账号真实 Provider、公网和真机证据 | 先确认 `his-patient` 映射，再按只读四层证据验收 |
| 门诊费用列表 | 只读待缴/已缴列表，服务端固定最近 30 个中国标准时间日 | 真实 Provider、公网/真机、空列表和状态切换证据 | 分别验证 `unpaid`/`paid`；缺失金额必须失败，显式 0 元才允许进入读模型 |
| 普通个人资料 | 仅昵称、性别、年龄、邮箱和 `version` 乐观锁 | 真实账号 GET/PUT、409 冲突、真机展示 | 先 GET；PUT/409 使用受控测试资料，不能触碰实名/头像/微信身份 |
| 报告目录 | 目录 adapter、日期窗口和 opaque 详情引用骨架 | 报告 gate 仍关闭，真实 LIS/PACS/ECG 结果未验收 | 等 Provider 文档/脱敏样例后再开详情 gate |
| 预约目录 | 科室/排班只读和短期快照 | 多次稳定观察、公网/真机完整对齐 | 继续观察，不进入锁号或预约写入 |

### 3.2 等待新 Provider 文档后再进入 contract（P1）

以下不是“少写几个页面”，而是会改变身份映射、数据模型或权限的独立业务域：

- 门诊费用详情、电子票据和短期资源下载；
- 门诊病历目录、病历正文、结构化病历；
- 住院 episode、住院病历、住院日费用和住院支付；
- 报告详情、PACS/ECG/体检报告附件和资源授权；
- 患者新增、建档、绑卡、协议、签名和撤销；
- 医院/院区动态目录、楼层定位、实时导航和路线；
- 二维码扫码协议、关注状态、订阅消息和外部 WebView/互联网医院票据；
- 采血预约、电子导诊单和预约后预问诊。

这些域在文档、字段白名单、失败/超时/重复样例未确认前，保持 `normalized` 或 `待 provider contract`，
不新增公共 API、不新增小程序伪成功页面、不复制旧端万能转发。

### 3.3 等待临床/内容治理后迁移（P2）

- 健康百科、疾病/药品详情、健康自测、BMI/血压计算；
- 风险评估、入院预问诊、出院随访；
- 锦旗、表扬信、文件上传和公开展示；
- 我的医生关系、AI 导诊、陪诊历史、客服会话和音频。

这些能力需要题库/内容版本、临床审核、免责声明、结果保留、患者授权和医护侧权限，不能从旧 JSON、
旧表或旧页面文案直接推导医学结论。

### 3.4 最后处理的高风险命令（P3）

- 号源锁定、执行预约、挂号登记、取消和退号；
- 门诊结算、微信支付、医保授权、6201/6202/6301/6203/6401、支付查单和关单；
- 退款、医保撤销、HIS 状态回写和失败补偿；
- Admin/RBAC、监控、任务管理、文件资源和 Worker 生产循环。

这些能力必须先有状态机、金额守恒、最终权威状态、幂等 key、租约/锁、outbox、补偿、回滚和真实联调。
“支付调起成功”“HTTP 200”“Provider 返回处理中”都不能显示为最终成功。

## 4. 本轮已发现并修复的正确性问题

爽约页原先在预约历史 Provider 请求完成前先写入患者卡片；患者切换期间旧结果会被守卫丢弃，但旧患者卡片
仍可能短暂保留，造成患者上下文与列表不属于同一快照。现在患者卡片只和同一轮已经通过最新请求及当前选择
校验的 `missed` 记录一起提交；页面开始新请求时仍先清空上一轮卡片和列表，并新增原生静态回归门禁。
同一提交原则现已扩展到报告目录和门诊费用：患者卡片不再早于对应只读读模型提交，失败、过期或跨患者
结果不会留下未被业务结果证明的患者上下文。

门诊费用 adapter 原先把 Provider 缺失金额映射为 `amountFen=0`。这会混淆“零元费用”和“金额未知”，
也会给后续支付编排留下错误读模型。现在的规则是：

```text
明确 amount=0       -> 允许，转换为 0 分
amount 缺失/空字符串 -> ProviderRequestError，整个响应 fail-closed
金额格式/精度非法    -> ProviderRequestError，禁止返回部分成功
```

同时，2.6.33 未确认的旧端候选字段不再作为 fallback：`waitPayAmount` 不能覆盖 `amount`，
`registerDept`/`registerDoctor` 不能覆盖 `billDeptName`/`billDocName`。这些规则已补充中文核心注释和 adapter
回归测试；当前只读接口仍不会触发支付。

## 5. 新文档到达后的固定处理流程

用户后续提供新的文档获取方式后，不直接开始写代码，先按以下顺序落盘：

1. 记录来源、确认人、版本、适用环境、接收时间和稳定 `documentId`；
2. 对可保存的脱敏副本或结构化导出计算 SHA-256，原始密钥、完整患者数据和证书不进入 Git；
3. 按 endpoint 分卡片记录 method/path、调用方向、鉴权、患者映射、请求字段、响应白名单、空结果、分页、
   错误码、重试、超时查单、状态机、幂等和资源 TTL；
4. 保存成功、空结果、业务失败、权限失败、超时、重复请求和未知状态的脱敏 fixture；
5. 先更新 contract、迁移矩阵、日志事件和验收手册，状态从 `received` 升级为 `normalized`；
6. 只有 Provider/院方确认关键业务事实后，才能进入 `confirmed`，随后按
   `contract → domain → adapter → persistence → API → 小程序 → 日志 → 验收` 实现；
7. 任何字段仍待确认时，不进入公共 response、小程序、日志或数据库 schema。

统一入口仍是 [`provider-document-intake.md`](../provider-document-intake.md) 和
[`provider-contract-template.md`](../provider-contract-template.md)。新的获取方式只改变“接收材料”的入口，
不改变上述冻结门禁。

## 6. 下一阶段顺序

1. 完成当前 release 的患者 TTL、多患者切换/失效恢复和预约历史只读证据；
2. 继续门诊费用列表只读验收，并验证 `unpaid`/`paid`、空列表、缺失金额和大列表展示；
3. 完成普通资料真实 GET、受控 PUT、旧版本 409 和真机页面验收；
4. 按新文档到达情况选择一个 P1 域，优先门诊费用详情或门诊病历目录，但不跨域混合字段；
5. 只读域全部具备 provider、公网和页面证据后，重新评审预约写入；支付/医保/退款/HIS 仍最后处理。

## 7. 防止方向偏移的检查表

- 页面能打开 ≠ 业务已迁移；
- API 200 ≠ Provider 业务成功；
- 预约快照 `persisted` ≠ 锁号/预约成功；
- 支付调起 ≠ 支付最终成功；
- 旧端字段存在 ≠ 新公共 contract 可以接收；
- 单患者真实成功 ≠ 多患者归属和失效恢复正确；
- 旧 Python 仍可用 ≠ 新 Elysia 可以复制旧实现；
- 文档已接收 ≠ 文档事实已确认；
- 测试通过 ≠ 公网、微信开发者工具和真机验收完成。
