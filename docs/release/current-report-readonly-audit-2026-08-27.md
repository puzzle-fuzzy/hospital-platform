# 报告目录与受限详情当前逻辑审计（2026-08-27）

> 本文记录当前新端报告目录/详情的代码与运行边界，不是 Provider、生产业务或真机验收证明。
> 当前服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`（`1bc8b0a8`），本地 live 小程序运行输入为 `f1b8b61609e0560d3da3fe176f62ab3585b6ee98`（`f1b8b61`）。旧 Python `8001`、旧数据库、旧 Redis 和另一会话负责的众阳预约适配器不在本次审计范围内。

## 1. 结论

报告目录和检验报告受限详情已经具备代码级安全边界，但当前只能标记为“代码就绪、业务未验收”：

- `GET /api/v2/reports` 和 `GET /api/v2/reports/:reportId` 均先通过会话解析 owner，再进入报告 service；客户端只提交内部 `patientId`，不能提交 Provider 患者号作为查询事实。
- 报告目录默认聚合 LIS、PACS、ECG 三个来源；未指定 `kind` 时任一来源失败都会让整批失败，不把部分成功伪装成完整目录。
- 只有 LIS 已定义受限详情字段；PACS/ECG 只能保留目录摘要，不能把 Provider 报告号、文件 URL 或原始报告字段带到小程序。
- 报告详情引用是按 owner、patient、报告引用和 TTL 绑定的短期 opaque 引用，不是永久授权凭证；引用失效或范围不一致时，在访问 Provider 前结束。
- 生产 `ZHONGYANG_REPORT_DIRECTORY_READY`、`ZHONGYANG_REPORT_DETAIL_READY` 当前保持关闭，因此没有因本轮审计新增 Provider 请求，也没有打开临床报告能力。

这意味着当前“报告页可以进入”只代表安全页面落点存在；不能宣称已经读取真实 LIS/PACS/ECG 报告，也不能宣称详情、附件、分享或报告复诊已迁移。

## 2. 当前调用链

```text
微信会话
  -> API authentication
  -> owner + patientId 运行时校验
  -> owner-scoped 患者 Provider 映射（referenceKind=his-patient）
  -> 报告 adapter（LIS / PACS / ECG）
  -> 整批响应校验与脱敏投影
  -> LIS 详情引用按 owner + patient + TTL 持久化
  -> 小程序摘要或受限详情
```

关键边界如下：

| 层 | 已核对的事实 | 不能越过的边界 |
| --- | --- | --- |
| API | 路由只接受内部 `patientId`；请求先认证 | 不接受客户端 owner、Provider 患者号或原始报告号 |
| Service | 重新校验 owner、患者映射、日期窗口、Provider trace 和读模型 | 不因 HTTP schema 已通过就信任注入的 gateway/repository |
| Adapter | LIS/PACS/ECG 分路请求，并使用各自已登记的时间字段 | 不用登记时间、采样时间或其它字段猜测报告时间 |
| Domain | 目录最多 512 条，LIS 明细最多 1024 项，字段白名单完整投影 | 不截断坏数据，不把患者姓名、身份证、Provider URL 带出 |
| Persistence | 详情引用按 owner、patient、reportId 和有效期查询 | reportId 不能单独授权，也不能跨患者复用 |
| 小程序 | 报告列表首批展示 10 条，后续只扩展已取得的本地窗口；详情点击先回查当前 `viewKey`，再校验患者和会话代际 | 切换患者/账号/会话代际后不回写旧报告；失效 WXML 事件静默丢弃，不误跳转到关闭态 |

## 3. 业务逻辑审计

### 3.1 患者与 owner 作用域

报告 service 先用当前会话 owner 查询 `zhongyang + his-patient` 映射，再把 Provider 患者号限制在一次 adapter 调用帧内。仓储返回值仍会经过运行时结构校验；缺失、跨患者或异常映射统一收敛为患者不可用，不访问 Provider。

报告详情再次按 `ownerUserId + patientId + reportId` 查询短期引用，并验证返回引用的 Provider、来源、患者、报告号和时间窗口。客户端页面的当前患者检查只是展示层保护，不能代替服务端授权。

### 3.2 目录聚合与失败语义

未指定报告来源时，adapter 并发读取 LIS、PACS、ECG，再按可解析报告时间倒序排列。任何一个来源返回业务失败、无法映射、缺少明确成功包络或请求号异常，都会拒绝整批结果；这样不会因某一路暂时失败而把不完整列表显示成“没有报告”。

指定 `kind` 时只请求对应来源，并由 service 二次确认每一条结果都与筛选来源一致。返回的报告时间必须是可解析的真实日期，并且落在请求的包含式自然日窗口内；窗口外数据不能被静默过滤。

### 3.3 临床字段与详情引用

目录层只返回标题、报告时间、状态和附件标志等最小摘要。LIS 目录若存在合法 Provider 报告号，service 才生成十分钟有效的内部短期引用；引用仓储失败时保留摘要但隐藏详情入口，不把数据库抖动误报为“没有报告”。

详情层仅允许已冻结的 LIS 检测项：名称、结果、单位、参考范围和有限状态枚举。详情时间必须和目录使用同一套可审计格式；检测项过量、字段非法、时间不可解析或 Provider 响应越过白名单时整批拒绝，不展示部分临床结果。

### 3.4 页面状态与患者切换

报告目录页面在加载前清空旧报告，再按“认证 → 当前就诊人 → 报告目录”顺序提交状态。请求等待期间若账号、会话代际或当前就诊人发生变化，旧响应失去回写资格。详情页同样在请求前和响应后检查当前患者，不能通过旧页面栈或手工深链打开另一位患者的合法引用。

列表的“加载更多”只改变已经取得的目录窗口，不会冒充 Provider 分页；页面首批固定 10 条，避免报告数量较大时一次性渲染全部内容。

## 4. 日志审计

报告 service 使用固定事件名：

- `report.directory.requested`
- `report.directory.synced`
- `report.directory.failed`
- `report.detail.requested`
- `report.detail.synced`
- `report.detail.failed`
- `report.detail_reference.failed`

成功和失败事件均保留平台 `traceId`，并记录 Provider、operation、低敏请求号、患者内部 opaque ID、条目数量和有限的 `resultViolation`。日志不写 Provider 患者号、Provider 报告号、姓名、身份证、原始响应、文件 URL 或授权 token。

## 5. 回归证据

本轮只读回归覆盖三个层次：

| 测试文件 | 结果 | 覆盖重点 |
| --- | ---: | --- |
| `packages/domain/src/reports.test.ts` | 6 pass | 时间窗口、资源上限、详情字段和引用 TTL |
| `packages/adapters/src/zhongyang-reports.test.ts` | 21 pass | 三来源请求、字段映射、包络失败、重复号、输入门禁和整批失败 |
| `apps/api/src/modules/reports/service.test.ts` | 24 pass | owner/患者隔离、短期引用、日志、来源筛选、异常读模型和并发上限 |
| 合计 | **51 pass / 0 fail / 166 expect()** | 代码级报告边界 |

这些测试是本地 gateway fixture 和 service contract 证据，不能替代真实 Provider 请求、服务器日志、公网 HTTPS、微信真机页面或临床内容审核。

## 6. 当前未完成与准入条件

当前不修改代码、不打开 gate，原因是以下事实仍缺失：

1. LIS、PACS、ECG 的正式请求/响应/空结果/拒绝/超时 contract 和字段责任人尚未确认。
2. 报告详情、附件、云影像、报告分享和报告复诊的资源授权、受众、TTL、撤回和审计规则尚未确认。
3. 当前报告 gate 为 `disabled`，尚无同一服务端 release、同一小程序运行包、页面、客户端 requestId、服务端 Pino 和 Provider requestId 的真实同链证据。

正确的下一步是先取得脱敏 Provider contract，再在 staging 单独打开报告目录 gate，完成成功、合法空结果、鉴权失败、超时和患者切换验收；详情 gate 必须在目录证据稳定后单独放行。支付、医保、报告写回和旧 FSI 转发不属于本域，继续保持关闭或原样运行。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `f1b8b61609e0560d3da3fe176f62ab3585b6ee98`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
