# 报告目录与详情只读契约审计（2026-08-18）

> 当前候选：服务端 release `5a31427`；小程序运行包来源 `cdb27e5023a188ab36a340497cebe18f1e274013`（提交 `cdb27e50`）。

> 当前基线更新：服务端 `5a31427`；小程序候选 `cdb27e50`；完整运行包来源 `cdb27e5023a188ab36a340497cebe18f1e274013`。下文更早候选只作历史追溯。

本文记录当前原生小程序报告目录/详情链路的代码级审计结果、已补的安全边界、测试证据和未完成的真实验收项。
报告属于低风险只读域，但内容仍可能包含临床结果；“页面能打开”不能等同于报告数据已正确迁移。

## 0. 当前检查点（2026-08-19）

- 当前线上服务端 release 为 `5a31427`，配套小程序构建来源为
  `cdb27e5023a188ab36a340497cebe18f1e274013`（当前本地候选 `cdb27e50`，尚未上传线上）；本文件的 Provider 材料门禁不因 release 切换而放宽。

- `pnpm provider:audit` 通过，当前仓库登记了 3 份 Provider 接收记录、26 个 `documentId`；
  `docs/provider-intake/` 中没有报告目录专用的正式接收记录、脱敏响应样例或错误样例。
- `docs/provider-contract-v1.md` 只冻结了平台侧的候选 endpoint 和公开字段边界，不能代替报告 Provider 的版本、环境、权限、
  请求头/签名、分页、空结果、失败响应和资源授权证据；因此不能据此打开 `ZHONGYANG_REPORT_DIRECTORY_READY` 或
  `ZHONGYANG_REPORT_DETAIL_READY`。
- 当前线上报告请求仍按 `503 dependency-not-configured` fail-closed；本轮代码、Provider 配置、旧服务和生产数据均未修改。

本节是当前停止条件的优先事实；后续若新增报告材料，必须先按
[`../provider-document-intake.md`](../provider-document-intake.md) 登记，再更新本文的字段差异和验收证据。

## 1. 当前链路

当前服务端 release 为 `5a31427`，配套小程序构建来源为
`cdb27e5023a188ab36a340497cebe18f1e274013`（当前本地候选 `cdb27e50`，尚未上传线上）；本次只切换了新 API，报告 Provider gate 仍保持关闭。

```text
小程序报告目录
  -> 当前登录用户 + 当前选中内部 patientId
  -> API 报告 service 校验日期、患者归属和 his-patient 映射
  -> 众阳 adapter 查询 LIS/PACS/ECG
  -> 只输出安全摘要；仅 LIS 在服务端建立短期 opaque reportId

小程序报告详情
  -> 提交当前内部 patientId + opaque reportId
  -> API 按 owner + patient + TTL 查询短期引用
  -> 仅把 providerReportId 留在服务端调用 LIS 详情
  -> adapter 白名单映射检测项后返回患者端详情
```

关键边界如下：

- `patientId` 是平台内部 opaque 标识，Provider 患者号只在服务端映射和 adapter 调用帧中存在；
- 报告目录允许没有详情引用的安全摘要，不能把单条引用持久化失败扩大成整批目录失败；
- 未指定 `kind` 时必须同时读取 LIS、PACS、ECG，公共 contract 没有 `partial` 状态，因此任一来源失败都拒绝整批响应；
- 只有 LIS 当前具备已审计的详情字段 contract，影像/心电 provider 报告号在 adapter 边界丢弃；
- 短期详情引用最长 15 分钟，service 当前使用 10 分钟，并按同一批次的单次服务端时钟样本生成创建和过期时间；
- 报告详情不返回患者姓名、身份证、原始 provider JSON、文件 URL 或附件下载凭证。

实现位置：

- 领域不变量：`packages/domain/src/reports.ts`；
- 众阳目录和 LIS 详情 adapter：`packages/adapters/src/zhongyang-reports.ts`；
- owner、患者映射、TTL 引用和日志：`apps/api/src/modules/reports/service.ts`；
- 公共路由和 query schema：`apps/api/src/modules/reports/index.ts`；
- 小程序目录/详情页面：`apps/miniprogram/src/pages/report-directory`、`apps/miniprogram/src/pages/report-detail`。

## 2. 本次发现与修复

此前报告 adapter 的长度校验已经存在，但 Provider 的标题、结果、单位、参考范围和报告号仍可能包含换行、制表符、NUL
等控制字符。此类文本若进入小程序、日志或短期引用，会破坏排版、检索和请求边界；仅依赖 WXSS、JSON 序列化或 MySQL
列类型兜底是不够的。

本次已完成：

1. `requiredText` 在众阳报告 adapter 边界拒绝控制字符，并保持 fail-closed；不静默删除字符，避免改写临床文本；
2. `validateReportReference` 对 `reportId`、`patientId`、`providerReportId` 增加首尾空白和控制字符校验，防止未来内部任务绕过 adapter 后把不安全引用落库；
3. 增加 adapter 回归测试，覆盖报告标题包含换行时整批拒绝；
4. 增加 persistence 回归测试，覆盖短期详情引用中的 provider 报告号包含换行时拒绝落库；
5. 在领域代码中加入中文注释，说明拒绝原因和“不能静默修剪临床数据”的维护原则。
6. 跨 LIS/PACS/ECG 合并目录时，使用严格识别的日期格式倒序；无法识别的 Provider 时间放到末尾，避免字符串排序或运行时自动进位改变报告顺序。该修复不改写公开的原始展示时间。
7. 小程序报告详情在请求失败、引用过期或患者范围变化时清空检测项、报告时间和附件标记；错误态不仅隐藏 WXML，还在页面状态层 fail-closed，避免页面实例复用时残留上一轮临床读模型。
8. `ReportService` 增加第二道读模型校验：即使注入的目录/详情 gateway 绕过 adapter 类型约束，service 仍会逐字段验证、拒绝非法状态/重复 LIS 报告号，并重新投影白名单字段；Provider 患者字段、文件 URL、原始字段和未冻结扩展字段不会进入 API 响应。
9. service 层的读模型异常使用有限 `resultViolation` 写入 `report.directory.failed` / `report.detail.failed`，错误处理统一映射为 `provider-response-invalid`（502），不记录 Provider 原文，也不把异常降级为空目录或空检测项。
10. `ReportService` 对引用仓储的返回值增加 owner、患者、Provider、引用类型和 Provider 报告号的逐字段回验；仓储即使返回跨患者或跨报告来源的引用，也只能安全降级为无详情摘要，不会把错误 `reportId` 返回给小程序。
11. 小程序 API client 现在对报告目录和 LIS 详情响应做第二道 canonical 运行时校验：详情 `reportId` 必须匹配请求引用，
    目录/详情的枚举、文本、附件和列表总数不合法时整批 `provider-response-invalid`；详情页不再把缺失检测项降级成空数组。

## 3. 测试证据

本次针对性检查结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/adapters test` | 83 项通过，183 个断言 |
| `pnpm --filter @hospital/persistence test` | 75 项通过，549 个断言 |
| `pnpm --filter @hospital/miniprogram test` | 报告专属记录为 150 项通过、1195 个断言；当前整体候选为 154 项、1235 个断言 |
| `pnpm format:check` | 233 个文件通过 |
| 报告 service 定向测试 | 13 项通过，60 个断言 |
| API TypeScript 类型检查 | 通过 |

已有报告 service/API 测试还覆盖：

- 当前用户不能读取其他用户的报告引用；
- 患者没有 `his-patient` 映射时不访问 Provider；
- 日期窗口、未知报告来源和报告详情 gate 失败时返回稳定错误；
- 单条详情引用持久化失败时摘要仍保留且不返回 `reportId`；
- 详情引用过期、owner 不匹配或 patient 不匹配时不能调用 Provider；
- 引用仓储返回跨 owner、跨患者、跨 Provider 或跨报告号结果时，service 拒绝返回错误 `reportId`；
- Provider 原始患者字段、文件 URL 和非 LIS 报告号不会进入公共响应。

## 4. 尚未完成的证据

截至当前 release 观察，不能把以下项目标记为“真实完成”：

- 当前生产环境真实众阳 LIS/PACS/ECG 报告目录和 LIS 详情请求；
- 报告 gate 打开后的公网 HTTPS 请求、Provider requestId 与低敏日志三方关联；
- 微信真机会话下登录、切换就诊人后报告列表不会串患者；
- 影像详情、心电详情、体检报告、附件下载和短期资源授权；
- Provider 报告日期包含边界、空目录语义以及真实字段样例与旧端逐字段比对。
- 当前排序修复只覆盖 `yyyy-MM-dd`、`yyyy/MM/dd`、带时间文本和带时区 ISO 文本；新的 Provider 时间格式仍需拿到脱敏样例后再扩展，不能把未知文本当成有效医疗时间。
- 小程序详情失败态清理已有静态回归，但仍需在真实微信会话中验证患者切换、详情引用过期和页面栈复用时的视觉收敛。
- 本轮 service 二次校验提交为 `133e94e`，引用写入范围回验提交为 `62e1dac`，引用读取范围回验提交为 `56c73af`；
  这些提交只完成本地代码、定向测试和类型证据，历史上曾随 `687690e` 部署，但不能据此增加 Provider 或真机验收结论。

历史线上发布和运行观察见 [`687690e-production-acceptance-2026-08-18.md`](687690e-production-acceptance-2026-08-18.md)；
配套小程序构建来源为 `01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`。

2026-08-18 13:46 CST 的配对开发者工具会话曾请求报告目录，但当前 release 因 `adapter:zhongyang` 未配置返回
HTTP 503 / `dependency-not-configured`，页面展示“报告服务暂未配置完成”；本次没有进入 provider 查询，也没有发起
报告详情请求。这个结果证明报告 gate 仍然 fail-closed，不能把 503 或页面入口解释成目录迁移完成；当前报告域仍未取得
真实 provider 成功/空目录/失败样例或真机证据。

## 5. 下一步与停止条件

报告域下一步按以下顺序进行：

1. 在不打开支付/医保的前提下，先取得脱敏 Provider 报告样例和 endpoint 权限确认；
2. 使用当前 release 的真实微信会话，在报告 gate 明确配置后只验收目录，再验收 LIS 详情；
3. 同时核对页面患者标识、HTTP status/requestId、`report.directory.*` / `report.detail.*` 低敏事件和 Provider requestId；
4. 发现患者映射缺失、Provider 字段无法形成安全读模型、日志缺失或报告类型被静默漏掉时，立即停止报告域验收，回到 contract 修复；
5. 影像/心电/体检和文件资源不沿用 LIS 详情实现，必须分别取得字段、授权、TTL、审计和真机证据。

支付、医保、退款和 HIS 回写仍然保持在只读报告及门诊费用链路稳定之后处理。
