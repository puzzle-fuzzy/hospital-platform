# Hospital Platform 未完成事项

更新时间：2026-08-31

本文是当前重构仓库的唯一总 TODO 清单。统计基于本次运行的
`pnpm migration:readiness`、旧端 `G:\fuck\hospital` 源码对照和当前候选运行态；
“代码已具备”不等于“业务已上线”，必须同时满足 contract、服务端、日志、公网和真机证据。

## 一、当前总览

| 指标 | 当前结果 | 说明 |
| --- | ---: | --- |
| 旧端页面总数 | 64 | 逐页台账已经覆盖，不能再以新增入口代替迁移 |
| 已替换 | 8 | 有原生页面和安全边界，仍需真实环境证据 |
| 部分迁移 | 23 | 只读/静态子集已接入，详情、写入、实时或外部链路未完成 |
| 页面外壳 | 23 | 只有展示壳或关闭态，不能宣称业务完成 |
| 待支付/回写 | 7 | 金额、支付、医保、查单、退款或 HIS 回写未开放 |
| 待 Provider | 1 个旧页面 / 12 个 feature key | 缺正式 Provider/HIS contract、字段白名单或映射证据 |
| 待外部入口 | 1 个旧页面 / 6 个 feature key | 缺域名 allowlist、短期会话、回跳和退出规则 |
| 明确排除 | 1 | 旧端开发辅助页面，不进入生产小程序 |
| 新端状态入口 | 38 | 每个 feature key 都有明确落点和迁移批次 |
| 代码就绪业务域 | 5 | 就诊人、预约、报告、门诊费用只读、普通资料 |
| 真实证据就绪业务域 | 0 | 尚未形成 Provider + 服务端 + 公网 + 真机的完整证据 |

64 个旧页面状态合计为：`8 + 23 + 23 + 7 + 1 + 1 + 1 = 64`。

## 二、按旧端业务域统计

| 业务域 | 页面数 | 已替换 | 部分迁移 | 页面外壳 | 待支付/回写 | 待 Provider | 待外部 | 排除 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 首页 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| 就诊 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 互联网医院 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| 预约 | 10 | 2 | 5 | 1 | 2 | 0 | 0 | 0 |
| 患者 | 7 | 3 | 2 | 2 | 0 | 0 | 0 | 0 |
| 健康 | 34 | 0 | 9 | 19 | 5 | 1 | 0 | 0 |
| 用户 | 8 | 2 | 5 | 0 | 0 | 0 | 1 | 0 |
| **合计** | **64** | **8** | **23** | **23** | **7** | **1** | **1** | **1** |

> 说明：上表中的“已替换”按旧端逐页状态统计；`migration:readiness` 的新版状态摘要中，
> 部分页面会因为同一 feature 覆盖多个旧入口而显示为 `partial`，两者是不同维度，不能相加推断业务完成。

## 三、38 个未完成 feature key

### A. 待 Provider/HIS contract（12 个）

- [ ] `appointment-detail`：确认挂号详情的 Provider 来源、患者归属、状态枚举、敏感字段白名单和短期引用。
- [ ] `blood-appointment`：确认采血项目、号源、院区、预约写入、取消和最终状态查询；旧端空项目不能伪造号源。
- [ ] `doctor`：取得当前医生目录与患者关系的脱敏样例，明确失效和解绑语义。
- [ ] `doctor-directory`：确认医生目录的查询条件、排序、分页和展示字段。
- [ ] `electronic-consultation`：确认电子导诊单来源、患者上下文、读取权限、状态和短期资源引用。
- [ ] `patient-express`：确认真实物流来源、患者归属、物流状态字段和隐私展示范围。
- [ ] `inpatient-center`：确认住院 episode 的权威来源、患者映射、状态枚举和门诊/住院隔离。
- [ ] `medical-record`：补齐门诊就诊记录的正式请求、响应、空结果、拒绝、超时和字段白名单。
- [ ] `report-cloud-image`：确认影像资源服务、短期访问令牌、过期和撤回语义；禁止任意 URL/WebView。
- [ ] `report-detail`：补齐 LIS/PACS/ECG 详情与附件的 Provider contract，保留 owner、patient 和 TTL 校验。
- [ ] `report-peis`：确认体检报告 Provider 来源、患者范围、字段白名单和详情引用。
- [ ] `report-follow-up`：确认报告随访任务来源、状态、患者归属和写入权限。

统一完成条件：

- [ ] 取得版本化请求/响应/错误/空结果/超时和脱敏样例，并登记 Provider request id 规则。
- [ ] 完成 adapter、owner-scoped service、API contract、前端状态机、Pino 低敏日志和异常测试。
- [ ] 通过 Provider TLS、服务端 trace、客户端 requestId、公网和真机同链验收。

### B. 待临床审核（8 个）

- [ ] `admission-preconsultation`：版本化入院预问诊题库、授权、幂等提交和医护读取规则。
- [ ] `discharge-followup`：确认出院事件、随访任务、答案版本、撤回和医护读取规则。
- [ ] `gift-banner`：确认电子锦旗内容审核、文件安全、脱敏公开和撤回规则。
- [ ] `health-encyclopedia`：处理源快照 133 项质量告警，取得独立审核 bundle 后再发布。
- [ ] `health-praise`：确认表扬信内容审核、文件安全、脱敏展示和幂等规则。
- [ ] `health-test`：取得题库版本、评分规则、适用人群、免责声明和危险值提示的临床审核。
- [ ] `pre-visit`：确认预约前问诊题库版本、预约关系、授权、幂等和医护读取规则。
- [ ] `risk-evaluation`：确认跌倒/疼痛/压力等量表、阈值、适用人群、结果授权和临床复核。

健康百科当前不能发布的具体原因：源快照虽已审计，但仍有重复名称、控制字符等质量告警；源状态为
`not-approved`，正式审核 bundle 不存在，staging 导入、发布/撤回演练和真机证据均未完成。

### C. 待患者绑定 contract（5 个）

- [ ] `patient-binding`：确认实名、查档、新增/绑卡、失败重试、幂等、撤回和 owner 关系。
- [ ] `patient-agreement`：确认协议版本、同意记录、撤回、重新同意和患者数据范围。
- [ ] `patient-address`：确认地址字段、敏感信息保护、owner 关系、修改幂等和删除语义。
- [ ] `patient-qr`：确认二维码内容、签名、TTL、扫码用途、服务端生成和失效策略；不能直接展示 HIS `patId`。
- [ ] `patient-signature`：确认签名材料、签名服务、证据保留、撤回和医护读取权限。

### D. 待外部入口/实时 contract（6 个）

- [ ] `companion`：确认陪诊主体、受众、短期会话、回跳、退出和历史数据归属。
- [ ] `consultation`：确认“我的问诊”独立于预约历史的外部服务主体和会话协议。
- [ ] `guide`：确认智能导诊的外部服务、数据范围、会话生命周期和退出语义。
- [ ] `patient-subscription`：确认微信订阅消息模板、用户授权、服务端保存、撤回和发送失败处理。
- [ ] `report-share`：确认报告分享对象、短期链接、访问次数/期限、撤回和审计。
- [ ] `smart-customer`：确认智能客服 HTTPS allowlist、短期 ticket、登录态隔离和回跳。

禁止事项：不能把旧端 WebView、任意 URL、前端 token、WebSocket query token 或预约记录结果
改名后当成问诊/客服/导诊已经迁移。

### E. 待支付、医保与 HIS 回写（7 个）

- [ ] `appointment-write`：锁号、预约登记、幂等键、费用前置、支付前置、取消和 HIS 回写。
- [ ] `cashier`：收银台短期引用、金额归属、支付失败、过期和回跳；禁止恢复旧端任意 WebView。
- [ ] `electronic-bill`：账单资源授权、金额单位、短期文件引用和下载权限。
- [ ] `inpatient-payment`：住院账单、支付状态机、查单、退款和 HIS 回写。
- [ ] `insurance`：医保授权、1101、6201、6202、6301、回调、查单、退款和 HIS 回写。
- [ ] `outpatient-payment-detail`：费用明细字段白名单、金额单位、患者归属和短期引用。
- [ ] `outpatient-payment-write`：支付订单、微信调起、医保混合支付、结算、退费和补偿。

支付域必须作为可回滚批次实现，至少具备订单状态机、幂等、回调查单、重试补偿、敏感字段保护和
HIS 最终一致性证据；不能因为门诊费用“只读列表”已经可见就提前打开支付。

## 四、已接入但仍未完成真实验收的 5 个代码就绪域

- [ ] 就诊人目录：`POST /api/v2/patients/sync`、`GET /api/v2/patients`；完成真实微信会话、账号切换、同步失败和 owner 映射验收。
- [ ] 预约目录/历史：科室、排班、在线/全部历史、爽约派生；先修复 `gpsrmyy.meiyi.pro` 证书过期，再采集四方链路证据。
- [ ] 检查报告：目录与受限 LIS 详情；真实 Provider 详情、附件和患者引用仍未打开。
- [ ] 门诊费用只读列表：只验证查询读模型；支付、医保授权、结算、退费仍关闭。
- [ ] 普通个人资料：验证 GET/PUT、版本冲突和会话代际；头像、实名、手机号和患者身份保持独立。

当前预约 503 的特殊处理：

- [ ] 修复 `gpsrmyy.meiyi.pro` 的有效 HTTPS 证书并完成 `nginx -t`、reload 和无 `-k` 探测。
- [ ] 服务端日志必须能区分 `providerFailureStage=transport|http|response`，不能把平台 503 直接称为 Provider HTTP 503。
- [ ] 证书恢复后重新完成客户端 requestId、Elysia/Pino trace、Provider 低敏 requestId 和真机验收。

## 五、运行包、发布与运维门禁

- [ ] 重新生成当前源码对应的小程序候选包；当前 live/pending 运行态与最新源码不一致，pending 被识别为 stale。
- [ ] 执行 `pnpm runtime:verify`，确认运行包来自当前候选源码，页面脚本和 WXML/WXSS 同源。
- [ ] 通过 staging 后使用原子发布流程更新 live；发布失败必须保留旧 live 目录。
- [ ] 补齐 `docs/release/device-evidence-missing-current.json` 对应的真实设备证据，覆盖登录、患者切换、首页二维码、预约目录、我的挂号、门诊费用、报告和错误重试。
- [ ] 完成公网域名、TLS、Nginx、Elysia/Pino 日志、数据库、Redis 和微信真机的发布后检查。
- [ ] 保持旧 Python 服务、旧数据库表和旧医保链路不变；新服务不得绕过旧服务责任边界。
- [ ] 生产日志继续使用结构化 npm 日志包，禁止记录 Authorization、完整身份证、完整卡号、医保授权号和 Provider 原始敏感报文。

## 六、文档与质量门禁

- [ ] 每个 feature key 补齐 contract、数据来源、权限、失败语义、日志事件、测试和真实验收链接。
- [ ] 旧端接口对照新增请求方法、参数、响应、错误和“未迁移原因”，不能只写页面名称。
- [ ] 所有核心常量、患者边界、金额/状态机和跨会话逻辑继续使用中文注释。
- [ ] 通过 `pnpm architecture:audit`、`pnpm migration:readiness`、`pnpm provider:audit`、`pnpm clinical:contract:audit`、`pnpm readonly:audit`、`pnpm logging:audit`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。
- [ ] 真实证据齐全前，不把状态页、空数组、mock、静态测试或本地构建结果标记为“已完成”。

## 七、执行顺序

1. [ ] 先完成当前候选运行包和真实设备证据门禁，修复 Provider 域名证书，恢复已有只读链路的可观测性。
2. [ ] 收口就诊人、预约、报告、门诊费用和普通资料五个已具备代码的域，逐域完成公网/真机验收。
3. [ ] 处理健康百科源快照质量告警，取得临床审核 bundle，再做 staging 发布/撤回演练。
4. [ ] 按 Provider/HIS、临床、患者绑定、外部入口四条线分别补 contract，不跨域复用身份或患者号。
5. [ ] 最后实现支付、医保和 HIS 回写，按可回滚批次做全链路验收。

## 八、边界声明

- 本文件只描述新平台未完成事项，不授权修改旧项目。
- 旧端的错误兜底不能当作新端业务完成；新端的状态页也不能当作 Provider 已接通。
- 任何涉及真实支付、医保授权、患者绑定、临床结论、外部会话或 HIS 写入的功能，必须在正式 contract 和真实验收证据到齐后才能打开。
