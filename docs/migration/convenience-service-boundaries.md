# 便民服务迁移边界与业务正确性审计

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app`，旧服务来源为
> `G:\\fuck\\hospital`。本文先冻结事实、风险和目标边界，不代表新 API 已注册，也不代表旧数据已经导入。
>
> 便民服务涉及患者反馈、临床问卷、随访、预问诊和医生关系。它们的共同特点是：数据既可能包含个人信息，
> 也可能被医护或管理端继续使用。因此不能以页面能打开、旧接口返回 200 或旧表已经存在作为迁移完成证据。

## 1. 旧服务真实路由快照

旧 FastAPI `module_convenience` 实际挂载 13 个叶子路由，均要求旧平台登录态：

| 业务 | 方法 | 旧路径 | 旧行为 |
| --- | --- | --- | --- |
| 表扬信 | `POST` | `/convenience/commendatory-letter/create` | 新增一条表扬信，不做幂等去重 |
| 表扬信 | `GET` | `/convenience/commendatory-letter/list` | 只查询当前用户，可按公开状态和赠送日期筛选 |
| 电子锦旗 | `POST` | `/convenience/silk-banner/create` | 新增一条电子锦旗，不做幂等去重 |
| 电子锦旗 | `GET` | `/convenience/silk-banner/list` | 只查询当前用户，可按患者和赠送日期筛选 |
| 风险评估 | `GET` | `/convenience/risk-assessment/list` | 按当前用户查询，可按 `pat_id`、`table_name` 筛选 |
| 风险评估 | `POST` | `/convenience/risk-assessment/create` | 同用户同 `pat_id` 已有记录时覆盖更新，否则新增 |
| 入院预问诊 | `GET` | `/convenience/admission-preconsultation/list` | 按当前用户查询，可按 `pat_id` 筛选 |
| 入院预问诊 | `POST` | `/convenience/admission-preconsultation/submit` | 同用户同 `pat_id` 已有记录时覆盖更新，否则新增 |
| 出院随访 | `GET` | `/convenience/discharge-follow-up/list` | 按当前用户查询，可按 `pat_id`、`table_name` 筛选 |
| 出院随访 | `POST` | `/convenience/discharge-follow-up/create` | 同用户同 `pat_id` 已有记录时覆盖更新，否则新增 |
| 我的医生 | `GET` | `/convenience/my-doctor/list` | 按当前用户分页查询医生关系 |
| 我的医生 | `POST` | `/convenience/my-doctor/create` | 同用户同医生已存在时返回“已关注”，否则新增 |
| 我的医生 | `GET` | `/convenience/my-doctor/delete?doctor_id=xxx` | 使用 GET 执行删除/取消关注 |

旧端还有一条不属于 `module_convenience` 的预问诊写入：
`POST /msun-hzzn-app-config/v1/saveBeforeVisitRecord`。它由旧小程序从预约记录中拼出
`medicalCardNumber`、`registerId`、`hospitalId` 后直连 provider 配置服务；这条链路必须和预约历史、
预约写入以及 provider 患者映射一起重新设计，不能与本地入院预问诊表混为同一个接口。

## 2. 旧表和旧页面实际数据

### 2.1 患者反馈：表扬信和电子锦旗

旧 `commendatory_letter`、`silk_banner` 共享以下字段：

| 字段 | 旧来源 | 迁移风险 |
| --- | --- | --- |
| `user_id` | 客户端请求体和表字段 | 客户端可伪造；新端必须从会话 owner 得到 |
| `patient_name` | 客户端请求体 | 客户端可伪造；必须由服务端患者读模型生成 |
| `patient_id` | 客户端请求体 | 旧值是本地/历史患者 ID，不能直接当新内部 `patientId` |
| `visit_record_id` | 客户端请求体 | 未证明归属和就诊事实；必须由服务端校验的 encounter/visit 引用替代 |
| `department_name`、`department_id` | 客户端请求体 | 名称和 ID 可以不匹配；必须来自服务端就诊/医生目录快照 |
| `medical_staff_name`、`medical_staff_id` | 客户端请求体 | 不能信任客户端指定医护人员；需要医生目录和就诊关系校验 |
| `content` | 客户端请求体 | 表扬信最多 1000 字，锦旗最多 10 个汉字；还缺内容安全、审核和撤回状态 |
| `donor_name`、`donate_date` | 客户端请求体 | 需要日期时区、修改/撤回规则和审计；不能只复制旧字符串 |
| `display_type` | 客户端请求体 | 旧端只存 0/1，没有公开审核、公开范围、脱敏和撤回状态 |

旧页面 `gift_health_praise.vue`、`gift_electronic_banner.vue` 会先用原始 `patId` 拉取就诊记录，
然后把患者姓名、科室、医护人员和就诊记录字段全部拼回提交参数。旧服务只校验 `auth.user.id == data.user_id`，
没有在这一层证明患者归属、就诊记录归属、科室/医生关系或请求体中的名称与 ID 一致。

### 2.2 临床问卷：风险评估、入院预问诊、出院随访

旧表的共同形态是 `user_id`、原始 `pat_id`、可自由输入的 `table_name` 和 JSON 字符串 `content`。
旧小程序把题目顺序当作数据协议：入院预问诊直接把答案数组按下标写入，风险评估按页面自行组装对象，
出院随访按表名和 JSON 内容写入。题目、选项、评分、版本、免责声明和临床读取权限都没有进入存储协议。

旧服务的覆盖逻辑尤其危险：风险评估、入院预问诊、出院随访都按 `(user_id, pat_id)` 找旧记录，
其中风险评估和出院随访虽然有 `table_name`，查找已有记录时仍不把它作为唯一键。一个患者提交不同问卷时，
后一次提交可能覆盖前一次提交。新服务不得复制这个行为，必须使用明确的 `questionnaireVersionId`、
`formInstanceId` 或 `followUpTaskId` 作为业务主键。

旧 `String(2000)` 字段也没有和请求体大小做一致限制；JSON 解析失败时，旧输出模型会把原字符串包装成单元素数组，
这会掩盖数据损坏。新服务遇到版本不匹配、结构校验失败或未知题目时必须拒绝写入并记录低敏错误事件。

### 2.3 我的医生

旧 `my_doctor` 表保存 `doctor_id`、姓名、职称、擅长、科室位置和头像 URL 的客户端快照。旧服务：

- 关注时只校验 `user_id` 与会话一致，不校验医生是否来自当前医院目录；
- 重复关注返回业务异常，不是幂等成功；并发请求没有唯一约束证据；
- 取消关注使用破坏性的 `GET`，不符合命令语义；
- 列表返回旧快照，不能证明医生当前仍在职、科室仍有效或头像 URL 仍安全。

新端应只保存内部 `doctorRef` 与关系状态；展示名称、职称、科室和头像由受控医生目录读模型提供。

## 3. 不能直接复制的业务逻辑

### 3.1 身份与患者上下文

新小程序请求不得提交或回显以下旧字段作为权威输入：`user_id`、原始 `pat_id`、provider 患者号、完整卡号、
患者姓名、医生/科室名称以及 provider 的就诊记录号。请求只携带内部 opaque `patientId` 或已经由服务端签发的
`encounterRef`；服务端按当前会话 owner 做三步校验：

1. 引用存在且属于当前微信账号；
2. 引用在对应业务场景仍有效，例如反馈必须对应真实就诊，出院随访必须对应已结束住院/随访任务；
3. provider 侧需要的患者号、就诊号、医生号和名称由服务端映射生成，绝不从客户端透传。

### 3.2 问卷内容必须版本化

问卷提交不是任意 JSON 保存。每次提交至少要绑定：

- `questionnaireId` 和不可变 `questionnaireVersion`；
- 患者内部 `patientId`；
- 对应的 `encounterRef`、`admissionRef` 或 `followUpTaskRef`；
- 结构化答案、客户端提交时间和服务端接收时间；
- 患者授权事实、免责声明版本和结果可见范围。

服务端必须根据已发布版本校验题目 key、类型、选项、必填项、长度和互斥关系。评分或风险分级如果存在，
必须在服务端使用版本化算法完成；不能相信客户端传来的“风险等级”“建议”或总分。未知版本只允许进入人工处理/迁移隔离，
不能降级按旧数组下标解释。

### 3.3 写入幂等和状态

所有 POST/命令接口都要接受服务端校验的 `Idempotency-Key`。幂等键必须绑定 owner、业务类型和业务资源，
重复请求只能返回相同的已持久化结果；不能因为网络重试产生两封表扬信、两条锦旗或两份临床问卷。

建议状态如下，最终枚举要以新 provider/院内业务确认结果冻结：

```text
draft -> submitted -> under_review -> accepted
                              |             |
                              v             v
                           rejected       withdrawn
```

问卷还需要区分 `submitted`、`reviewed`、`superseded`，不能用“同患者覆盖旧行”代替历史事实。旧数据导入时，
没有版本或无法解析的记录只能标记为 `legacy_unresolved`，不能直接展示为当前问卷结果。

## 4. 新端目标模块边界

便民能力应拆成四个独立领域，不能继续使用一个 `/convenience/*` 万能模块：

| 新领域 | 主要读写 | 必须依赖 | 当前状态 |
| --- | --- | --- | --- |
| `patient-feedback` | 表扬信、电子锦旗提交/查询/撤回 | 患者、就诊记录、医生目录、内容审核 | 未注册，等待审核与公开规则 |
| `clinical-questionnaires` | 风险评估、入院预问诊、出院随访 | 问卷版本、患者授权、就诊/住院/随访任务、临床读取权限 | 未注册，等待临床 contract |
| `doctor-relations` | 我的医生查询、关注、取消关注 | 受控医生目录、owner 关系、幂等和审计 | 未注册，等待医生目录 contract |
| `pre-visit` | 预约后的门诊预问诊 | 预约记录、挂号映射、医院/科室 contract、敏感信息权限 | 未注册，必须晚于预约历史和预约写入边界 |

建议的新 API 只表达业务意图，例如“提交某次就诊的表扬信”“读取当前患者的随访任务”，不暴露旧表名、
provider 路径或任意 `table_name`。具体路径、请求字段和响应枚举必须等新的 provider 文档/院内确认资料到达后再冻结。

## 5. 迁移顺序与门禁

1. **先冻结 contract 和旧数据映射**：补齐问卷版本、患者/就诊映射、审核状态、撤回语义和隐私保留期限；建立脱敏 golden fixture。
2. **先做医生关系只读**：取得受控医生目录后，只实现 owner-scoped 列表，确认医生快照与目录来源；再做关注/取消关注命令。
3. **再做患者反馈**：先完成文本长度、内容安全、审核队列、公开展示脱敏和撤回，再开放提交；不迁移旧客户端提交的名称/ID快照。
4. **再做风险评估和问卷**：临床审核题目、评分和免责声明后，先实现版本化只读题库，再实现提交和历史版本查询。
5. **最后做预问诊与出院随访**：它们依赖预约/住院/出院事实，必须等对应资源 contract 和医护侧读取权限稳定后实现。
6. **旧数据单独导入**：先导入 `legacy_unresolved` 隔离区，完成 user/patient/encounter 映射和人工抽样后，才允许转换为新领域事实。

每一阶段都必须同时具备 `contracts`、`domain`、`persistence`、`api`、小程序页面、测试、日志和验收手册；
只完成页面或只接通旧接口，不得标记为迁移完成。

## 6. 日志与审计要求

以下事件名是新领域的预定义规范，当前没有对应运行时代码；实现时必须复用组合根注入的 Pino logger，
不得在业务模块中创建第二套日志器：

| 事件 | 记录字段 | 禁止字段 |
| --- | --- | --- |
| `convenience.feedback.requested` | `traceId`、内部 `patientId`、反馈类型、幂等键是否存在 | 内容正文、患者姓名、provider ID |
| `convenience.feedback.succeeded` | 内部反馈 ID、审核状态、owner 维度、`traceId` | 正文、完整就诊卡号、医护个人信息 |
| `convenience.feedback.failed` | 错误类型、是否可重试、内部资源 ID、`traceId` | provider 原始报文、请求 body |
| `convenience.questionnaire.requested` | 问卷类型、版本、内部 `patientId`、任务引用类型 | 答案正文、身份证、原始 `pat_id` |
| `convenience.questionnaire.succeeded` | 内部提交 ID、版本、结果状态、审核状态、`traceId` | 答案内容、风险建议原文 |
| `convenience.questionnaire.failed` | 错误类型、版本、是否可重试、`traceId` | 问卷答案和 provider 原始错误 |
| `convenience.doctor_relation.requested` | 操作名、内部医生引用、owner 维度、幂等键是否存在 | 医生电话、头像 URL 原文、provider 医生号 |
| `convenience.doctor_relation.succeeded` | 内部关系 ID、关系状态、操作名、`traceId` | 医生个人联系方式 |
| `convenience.doctor_relation.failed` | 错误类型、操作名、是否可重试、`traceId` | 请求体和 provider 原始报文 |
| `convenience.idempotency.replayed` | 业务类型、内部资源 ID、幂等结果状态、`traceId` | 幂等键原文 |

日志只能帮助定位链路，不能替代问卷、审核、撤回和医生关系的持久化事实。医疗正文和答案必须进入受控数据表，
由独立的医护/管理端权限读取；不能因为 Pino 有 redact 就把敏感正文写进日志。

## 7. 验收清单

- 未登录、登录失效、非 owner 的患者/就诊/医生引用都稳定返回统一错误码；不泄露资源是否存在的额外信息。
- 同一命令重复提交、并发提交、超时后重试都不会产生重复业务事实；重复请求能返回原结果或明确的处理中状态。
- 不同问卷版本、不同随访任务和同一患者多个就诊互不覆盖；历史提交可追溯，撤回不物理删除审计事实。
- 小程序不出现 provider 域名、provider 患者号、原始医生/科室 ID、完整卡号或医疗正文日志。
- 内容公开必须经过审核、脱敏和撤回测试；`display_type=1` 不能直接等同于公开成功。
- 医护侧只能读取有授权/任务关系的问卷和随访，患者端不能访问医护审核备注和内部风险建议。
- 代码测试、真实 MySQL/Redis、staging provider、内网 API、公网 HTTPS、微信开发者工具和真机证据分别保存。

在新的 provider 文档和临床确认资料到达前，本领域保持“未注册、旧服务继续承担、生产 gate 关闭”。
