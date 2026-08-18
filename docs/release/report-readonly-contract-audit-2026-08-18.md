# 报告目录与详情只读契约审计（2026-08-18）

本文记录当前原生小程序报告目录/详情链路的代码级审计结果、已补的安全边界、测试证据和未完成的真实验收项。
报告属于低风险只读域，但内容仍可能包含临床结果；“页面能打开”不能等同于报告数据已正确迁移。

## 1. 当前链路

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

## 3. 测试证据

本次针对性检查结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/adapters test` | 68 项通过，158 个断言 |
| `pnpm --filter @hospital/persistence test` | 70 项通过，535 个断言 |
| `pnpm format:check` | 221 个文件通过 |

已有报告 service/API 测试还覆盖：

- 当前用户不能读取其他用户的报告引用；
- 患者没有 `his-patient` 映射时不访问 Provider；
- 日期窗口、未知报告来源和报告详情 gate 失败时返回稳定错误；
- 单条详情引用持久化失败时摘要仍保留且不返回 `reportId`；
- 详情引用过期、owner 不匹配或 patient 不匹配时不能调用 Provider；
- Provider 原始患者字段、文件 URL 和非 LIS 报告号不会进入公共响应。

## 4. 尚未完成的证据

截至当前 release 观察，不能把以下项目标记为“真实完成”：

- 当前生产环境真实众阳 LIS/PACS/ECG 报告目录和 LIS 详情请求；
- 报告 gate 打开后的公网 HTTPS 请求、Provider requestId 与低敏日志三方关联；
- 微信真机会话下登录、切换就诊人后报告列表不会串患者；
- 影像详情、心电详情、体检报告、附件下载和短期资源授权；
- Provider 报告日期包含边界、空目录语义以及真实字段样例与旧端逐字段比对。
- 当前排序修复只覆盖 `yyyy-MM-dd`、`yyyy/MM/dd`、带时间文本和带时区 ISO 文本；新的 Provider 时间格式仍需拿到脱敏样例后再扩展，不能把未知文本当成有效医疗时间。

当前线上发布和运行观察见 [`1b94c46-production-acceptance-2026-08-18.md`](1b94c46-production-acceptance-2026-08-18.md)；
配套小程序构建来源为 `d4261e5a59e0a9bfe69534169504d8a118ebca7f`。

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
