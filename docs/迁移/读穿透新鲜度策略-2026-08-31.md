# 只读域来源权威与新鲜度策略

更新时间：2026-08-31

本文把患者目录、预约、报告、门诊费用和普通资料当前代码已经实现的来源与时效边界集中记录下来。它是迁移和发布的工程策略，不是 Provider 已联调或真机已验收的证明；真实 Provider、公网、日志和真机证据仍以 `TODO.md` 对应条目为准。

## 1. 统一规则

1. 页面只消费服务端公开读模型，不自行拼接 Provider 字段、患者号、卡号或身份证。
2. “实时读取成功”“服务端已持久化观察快照”“短期详情引用有效”是三种不同事实，不能相互推导。
3. 读取失败、超时、权限拒绝和响应校验失败不能降级为空列表；只有服务端明确返回合法空结果时才展示空态。
4. 过期数据不能用于预约写入、支付、医保、退款或 HIS 回写。写入能力必须另有独立 contract 和实时复核。
5. 页面刷新发生会话代际或患者上下文变化时，旧响应不能覆盖新状态；客户端的页面级请求门禁不改变服务端来源权威。

## 2. 当前域策略

| 域 | 当前权威来源 | 当前新鲜度语义 | Provider/快照故障时 | 禁止推导 |
| --- | --- | --- | --- | --- |
| 就诊人目录 | `PatientService.list` 返回 `hp_patients` 的 owner-scoped 最近一次完整同步快照；Provider 只在显式 `/patients/sync` 中刷新 | `directory_last_seen_at` 记录观察时间；同步事务按 `observedAt` 防止旧响应覆盖新快照。目录 GET 本身不是实时 Provider 读取 | 同步失败不能把已有目录改成空目录；当前安全策略保留最近已确认读模型，但不新增或静默切换患者 | 不能把目录 `thirdPatientId`、档案 `patId` 或卡号当作小程序 `patientId`、二维码内容或临床授权 |
| 预约科室/排班 | 每次目录请求的众阳只读响应；成功响应先经过 service/domain 白名单校验 | 排班观察快照写入 `hp_appointment_schedule_snapshots`，TTL 为 60 秒，只作为未来写入前的观察事实；快照失败不阻断当前只读展示 | Provider 失败返回稳定错误，不伪造科室/号源空态；快照写入失败只记录独立日志，不能把只读成功升级为写入可用 | 不能用旧快照替代实时号源，不能凭“快照已落库”开放锁号、预约或取消 |
| 预约历史/爽约 | 每次 `/appointments/records` 查询的众阳只读响应，按服务端固定中国标准时间窗口过滤和校验 | 当前没有把预约历史当作本地缓存事实；“在线/全部/爽约”是同一次合法读模型上的展示筛选，爽约只接受服务端归一化状态 | Provider 失败、窗口非法或响应不完整都保持错误状态，不显示“未查询到记录”；合法 `items=[]` 才是空态 | 不能把预约历史改名为问诊、今日摘要改名为实时叫号，不能由客户端改变预约状态 |
| 检验报告目录/详情 | 报告目录每次由众阳只读查询；详情必须通过 owner/patient 绑定的 `reportId` 短期引用 | 目录响应只在本次请求中有效；实验室详情引用默认最多 10 分钟，服务端验证过期、owner、patient、provider 和 kind | Provider 失败不回退上一批报告；单条详情引用持久化失败可以保留已验证的目录摘要，但隐藏详情入口 | 不能把报告引用当永久文件 URL，不能把目录结果扩大到 PACS/ECG/PEIS 或报告分享 |
| 门诊费用只读 | 每次 `/payments/outpatient/records` 查询的众阳响应，服务端固定最近 30 个中国标准时间日窗口 | 当前不使用本地费用快照；金额、状态和账单时间必须通过 service/domain 响应校验 | Provider 失败、金额/时间窗口异常或患者映射失败都返回稳定错误，不降级成“暂无费用” | 不能从只读账单创建支付订单、医保授权、收银台或退费事实 |
| 普通资料 | `hp_user_profiles` 中 owner-scoped canonical 资料；微信昵称/头像授权是单独的增强资料来源 | `version` 用于 PUT 乐观并发控制；普通资料不会因为切换 Tab 重复读取，微信资料仓库由 App 全局共享 | 普通资料失败只影响资料增强展示，不清空已经验证的会话 owner；会话明确失效时才清理旧账号快照 | 不能把微信资料、实名资料、手机号、头像和患者身份合并成同一个 contract |

## 3. 代码对应关系

- 患者目录：`apps/api/src/modules/patients/service.ts`；快照和 `directory_last_seen_at` 由 `packages/persistence/src/mysql-repositories.ts` 维护。
- 预约目录/历史：`apps/api/src/modules/appointments/service.ts`；排班快照 TTL 与 Provider 请求分开记录。
- 报告：`apps/api/src/modules/reports/service.ts`；目录请求与 `reportId` 短期引用是独立能力。
- 门诊费用：`apps/api/src/modules/outpatient-payments/index.ts`；查询窗口、金额和账单日期在服务层校验。
- 普通资料：`apps/api/src/modules/profile/service.ts` 与小程序 `services/global-user-profile.ts`；资料仓库不承担患者目录或临床身份。

## 4. 发布前证据

本策略完成只表示来源和时效规则已经在代码与文档中统一，仍需分别补齐：

1. Provider 脱敏成功、合法空、拒绝、超时和响应异常样例；
2. 公网请求、API `requestId`、服务端 `traceId` 与 Provider 请求号的低敏关联；
3. 真机患者切换、日期窗口、费用/报告空态和重试结果；
4. 任何写入、支付、医保、退款或 HIS 回写的独立 contract 和实时复核。
