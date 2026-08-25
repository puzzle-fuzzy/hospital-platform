# 批次 B 读模型迁移矩阵（2026-08-25）

> 本页是“广度优先”阶段的业务域交接表。它把已有入口、当前安全落点和下一项真实输入放在一起，
> 不把状态页、测试桩、空列表或旧端请求线索当成业务完成。未满足放行条件时，入口继续使用固定
> `FeatureKey` 状态页，服务端不注册猜测性的兼容路由。

旧端 64 个页面的逐页落点见
[`../release/breadth-first-page-coverage-2026-08-25.md`](../release/breadth-first-page-coverage-2026-08-25.md)。
本页继续按业务域管理后续 contract，不把 64 个入口都能打开误写为 64 个业务已经完成。
病历、住院、医生关系和问诊的材料入口统一见
[`../provider-intake/clinical-read-models-2026-08-25.md`](../provider-intake/clinical-read-models-2026-08-25.md)。

## 当前总览

| 业务域 | 旧端入口 | 新端当前落点 | 当前状态 | 下一项可执行输入 |
| --- | --- | --- | --- | --- |
| 门诊病历 | `electronic_record.vue`、门诊病历入口 | 首页/“我的”固定 `medical-record` 状态页 | 待 provider contract | `out-visit-records` 正式请求/响应、患者映射、字段白名单、成功/空/拒绝/暂时失败样例 |
| 我的问诊 | `my_consultation.vue` | “我的”固定 `consultation` 状态页 | 待外部入口 contract | 问诊会话索引、患者归属、内容保留、脱敏和外部主体确认 |
| 电子导诊单 | `electronic_consultation.vue` | 首页/“我的”固定 `electronic-consultation` 状态页 | 待 provider contract | 导诊单来源、读取/提交权限、执行状态字段和撤回语义 |
| 我的医生 | `doctor.vue` | “我的”固定 `doctor` 状态页；旧库有 21 条历史关系但新端未导入 | 旧存量已盘点，待 provider contract | owner/医生目录映射、展示白名单、关系失效规则和历史数据策略 |
| 住院信息 | `inpatient_center.vue` | 首页固定 `inpatient-center` 状态页 | 待 provider contract | 独立住院 episode/患者标识、在院状态、权限和脱敏字段 |
| 住院预缴 | `inpatient_payment.vue` | 首页固定 `inpatient-payment` 状态页 | 待支付与回写 contract | 住院账单、金额单位、订单状态机、查单和 HIS 回写 |
| 健康百科 | `health_encyclopedia.vue`、详情/搜索页 | 原生目录、症状查疾病结果、疾病/药品详情页已接入；服务端 `/knowledge/health/*` 已挂载并在无发布 bundle 时 fail-closed | 页面/路由已迁移，内容待临床审核 | 处理重复/孤儿关系、定义 `knowledge_tips` 映射、脱敏内容 bundle、来源/版本、审核责任、发布/撤回和搜索字段 |
| 健康自测/风险自评 | `health_test.vue`、风险问卷和计算器 | 首页固定 `health-test`/`risk-evaluation` 状态页；旧库有 7 条风险评估历史记录但新端未导入 | 旧存量已盘点，待临床审核 | 旧答案脱敏、不可变题库版本、评分规则、适用人群、免责声明和结果撤回策略 |
| 就诊实时动态 | `consult.vue`、旧 WebSocket/队列查询 | “就诊”主 Tab已完成患者栏、未来/历史预约摘要和三标签；当天实时内容保持关闭 | 待外部入口 contract | 事件 schema、连接认证、患者订阅、游标补偿、队列关联和真机断线证据 |
| 互联网医院/客服 | `hospital.vue`、旧 web-view | “互联网医院”主 Tab或固定 `smart-customer` 状态页 | 待外部入口 contract | audience、HTTPS allowlist、短期引用、回跳/退出和外部主体授权 |

## 统一放行顺序

每个业务域都必须独立完成以下链路，不能因为同属“健康”或同属一个旧页面就复用另一域的字段：

```text
provider/HIS 文档登记
  -> 版本化 contract 与字段白名单
  -> adapter 脱敏和成功/空/拒绝/暂时失败 fixture
  -> owner-scoped domain/service
  -> persistence（只有需要缓存或引用时）
  -> API、Pino 低敏事件和错误码
  -> 小程序页面状态机、重试和旧响应淘汰
  -> 内网/公网/真机三层证据
```

## 本轮明确不打开的域

- 门诊病历不复用报告目录、预约历史或旧 `patId`；
- 住院信息不复用门诊 `patientId`，住院费用不复用门诊费用窗口；
- 健康百科、自测、BMI/血压不在缺少临床审核时导入旧正文、旧题库或旧阈值；
- 就诊实时动态不复制旧 WebSocket，不把预约历史冒充今日就诊；
- 互联网医院、智能客服不恢复旧 `web-view`、万能 ticket 或任意外部 URL；
- 住院预缴、门诊缴费、医保、微信支付、退款和 HIS 写回仍然留在批次 D。

## 当前代码与文档入口

- 门诊病历：[`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)
- 门诊/住院边界：[`medical-record-and-hospital-boundary.md`](medical-record-and-hospital-boundary.md)
- 临床只读域并行准入：[`../provider-intake/clinical-read-models-2026-08-25.md`](../provider-intake/clinical-read-models-2026-08-25.md)
- 就诊与互联网医院：[`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md)
- 健康内容与自测：[`health-content-and-self-test-audit-2026-08-24.md`](health-content-and-self-test-audit-2026-08-24.md)
- 知识内容导入：[`health-knowledge-import-runbook.md`](health-knowledge-import-runbook.md)
- 统一迁移入口：[`../../apps/miniprogram/src/services/feature-navigation.ts`](../../apps/miniprogram/src/services/feature-navigation.ts)

本矩阵的下一次更新条件不是“页面又能打开”，而是某个业务域获得正式 contract、脱敏样例和可复核
的服务端/小程序验收输入。满足条件后只推进该域的闭环，其他域继续保持当前关闭状态。
