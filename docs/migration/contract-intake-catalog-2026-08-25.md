# C/D/E 契约材料入口与实现顺序（2026-08-25）

> 本文是 C/D/E 三个未完成批次的执行入口，不是业务已开放声明。
> `pnpm migration:contract:audit` 只检查入口覆盖、材料清单和实现顺序是否完整；
> 当前三个批次均为 `awaiting-formal-contract`，`businessReady=false`。
> 旧 Python 服务、旧数据库、旧 Redis、线上旧进程和另一会话维护的众阳预约适配器不在本文修改范围内。

命令输出中的 `featureIntakeRows` 会把 24 个入口逐条展开，用于材料到达后的逐入口核对；
它只生成审计摘要，不会改变入口状态。

## 1. 统一放行链

每个 FeatureKey 都必须按下列顺序推进，不能跳过材料直接从状态页改成业务页：

```text
正式 contract 与责任人
  -> 脱敏成功/空/拒绝/超时样例
  -> owner/患者或外部受众映射
  -> 字段白名单与禁止字段
  -> adapter 错误归一化
  -> domain 不变量与幂等/撤回
  -> persistence（确有必要才增加）
  -> Elysia API
  -> 原生小程序状态机
  -> Pino 低敏日志
  -> 内网、公网、开发者工具、真机证据
```

任何一步缺失时，入口仍必须进入统一状态页；`HTTP 200`、成功空数组、fixture、
旧接口转发和“页面已经能打开”都不能作为放行证据。

## 2. 批次总览

| 批次 | gate 数 | 当前状态 | 主要责任人 | 下一份必须到达的材料 |
| --- | ---: | --- | --- | --- |
| C：临床只读契约 | 4 | `awaiting-formal-contract` | Provider/HIS 业务责任人 | 四条临床线分别提供版本、请求、响应、错误、患者映射和字段白名单 |
| D：患者与便民写入 | 12 | `awaiting-formal-contract` | 患者服务、临床内容、平台安全 | owner、版本化同意、幂等、最终查询、撤回、文件安全和医护读取规则 |
| E：外部入口与实时能力 | 8 | `awaiting-formal-contract` | 外部主体、平台安全、小程序运营 | allowlist、短期受众会话、回跳/退出、撤回、保留周期和脱敏审计 |

## 3. C：临床只读契约

| FeatureKey | 业务入口 | 不可复用的事实边界 |
| --- | --- | --- |
| `medical-record` | 门诊病历 | 不能用报告、预约或费用记录冒充病历；正文权限独立于目录权限 |
| `inpatient-center` | 住院信息 | episode 是独立事实；不能把门诊 `patientId` 推导为住院患者标识 |
| `doctor` | 我的医生 | 医生目录和患者关系分开；关系失效不能继续展示旧快照 |
| `electronic-consultation` | 电子导诊单 | 导诊单、实时队列和外部问诊会话必须分别确认来源和生命周期 |

必须提供：Provider 身份和版本、成功/合法空/拒绝/超时样例、owner/患者映射、字段
白名单、禁止字段、权限矩阵、保留周期以及低敏 requestId 关联。收到材料后仍按
`contract -> adapter -> domain -> API -> 页面 -> 日志 -> 证据` 顺序推进。

## 4. D：患者与便民写入

| FeatureKey | 业务入口 | 第一阶段正确目标 |
| --- | --- | --- |
| `patient-binding` | 新增/绑定就诊人 | 查档、建档、绑定拆成独立命令；异常不能降级为未找到 |
| `patient-agreement` | 就诊人协议 | 记录版本、同意主体、时间和撤回，不接受本地勾选代替同意 |
| `patient-address` | 联系地址 | owner 作用域、字段白名单、版本冲突和删除语义先冻结 |
| `patient-express` | 我的快递 | 旧端只有预留空列表；先冻结物流来源、患者归属、状态枚举和脱敏字段，不把它误当联系地址 |
| `patient-qr` | 就诊二维码 | 使用签名 opaque payload、受众、TTL、防重放和撤回；不外发 `patId`/卡号 |
| `patient-signature` | 就诊人签名 | 用途绑定、文件安全、授权、撤回和医护访问分开定义 |
| `admission-preconsultation` | 入院预问诊 | 版本化问卷、授权、幂等提交和医护读取规则 |
| `discharge-followup` | 出院随访 | 出院事件、任务版本、重复提交、撤回和覆盖规则 |
| `risk-evaluation` | 风险评估 | 规则版本、适用人群、临床审核和免责声明 |
| `health-test` | 健康自测 | 题库/阈值版本和临床审核；不能把旧 JSON 当医学事实 |
| `pre-visit` | 预约前预问诊 | 绑定具体预约、版本化问卷、授权和提交幂等 |
| `gift-banner` | 电子锦旗 | 内容审核、文件安全、公开脱敏、幂等和撤回 |
| `health-praise` | 表扬信 | 与锦旗类似，但不能把表扬信当医疗证明或诊疗事实 |

患者写入必须有可恢复命令状态。至少要区分 `requested`、`pending`、
`awaiting_confirmation`、`bound/submitted`、`duplicate` 和 `rejected`；写入超时或
响应不完整时先查询最终事实，不能自动重放可能产生副作用的命令。

## 5. E：外部入口与实时能力

| FeatureKey | 业务入口 | 必须先冻结 |
| --- | --- | --- |
| `guide` | 智能导诊 | 模型/知识版本、免责声明、风险分流、会话 owner 和审计 |
| `companion` | 陪诊 | 外部主体、患者授权、短期会话、保留、退出和撤回 |
| `smart-customer` | 智能客服 | 域名 allowlist、外部受众、短期会话、回跳、退出 |
| `consultation` | 外部问诊入口 | 外部主体、受众、短期 ticket、回跳、退出和撤回 |
| `patient-subscription` | 消息订阅 | 模板、业务事件、授权结果、发送结果和撤回 |
| `report-cloud-image` | 云影像/资源入口 | 资源 allowlist、短期授权、受众、过期和审计 |
| `report-share` | 报告分享 | 分享受众、脱敏、TTL、防重放、撤回和访问审计 |

外部会话只能由服务端签发，必须绑定当前平台用户、患者/业务对象和目标受众；
小程序不得携带平台 token 直接交给 WebView，也不能用本地开关代表第三方授权成功。
所有回跳、退出、域名拒绝、过期和撤回都必须有明确页面状态与低敏日志事件。

## 6. 自动门禁与完成判定

```bash
pnpm migration:contract:audit
pnpm migration:readiness
```

当前门禁要求：

- C/D/E 三个批次各有且只有一个材料入口；
- 24 个 FeatureKey 全部覆盖且不能重复归属；
- 每批次至少有正式材料、实现顺序和未确认禁止项；
- 结构审计通过时，三个批次仍不能被报告为 `businessReady`；
- 只有正式材料、adapter/domain/API、低敏日志和内网/公网/真机证据全部到齐，
  才能将对应入口从状态页替换为真实业务页面。

逐入口材料板至少包含：

- `featureKey`、批次和 `contractFamily`；
- 旧页面路径与 action 入口，避免遗漏没有独立页面的首页/列表动作；
- 公共材料、批次材料和入口专属材料合并后的去重列表；
- 当前必须禁止的能力、`businessReady=false` 和下一项材料说明。

因此“24 个入口全部列出”只代表迁移任务可执行和可追踪，不代表 24 个入口已经开放。

支付、医保、结算和 HIS 回写不在本文提前开放；它们继续作为 F 批次最后处理。
