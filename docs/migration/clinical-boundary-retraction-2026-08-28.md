# 未确认临床入口边界收口记录（2026-08-28）

状态：已实现，待真机确认入口文案

## 1. 本轮结论

本轮对照旧项目源码后确认：

- 旧端 `pagesB/health/electronic_record.vue` 只能证明存在门诊就诊记录调用线索，不能证明新端已经拥有可直接复用的 Provider contract；
- 旧端 `pagesB/user/my_consultation.vue` 实际调用的是独立的 `GET /intelligent/treatment_companion/history`，它不是预约历史，也不是电子导诊单；
- 旧端的统一 HTTP 拦截器只负责把异常弹窗显示为“服务器错误”，没有解决上游超时、重试、熔断、Provider 状态分类或请求可观测性；
- 因此，门诊病历和我的问诊都不能用预约、报告或费用读模型拼出一个“看起来可用”的页面。

旧端源码的具体证据和指纹见：

- [`clinical-readonly-source-audit-2026-08-26.md`](clinical-readonly-source-audit-2026-08-26.md)
- [`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)
- [`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md)

## 2. 新端本轮调整

### 2.1 API 边界

- 移除新 API 中尚未取得正式 contract 的门诊病历路由注册；
- OpenAPI 和公共 API 文档不再把 `/api/v2/medical-records` 列为当前可用接口；
- 移除该路由对应的 API service、错误处理分支和请求日志读模型分支；
- Provider/domain 的候选类型和适配器材料仍作为隔离草案保留，但没有通过 API 组合根暴露，后续必须先经过 contract intake。

这意味着病历入口当前是明确的 404/状态页边界，不是 503，也不是空列表。这样可以区分“功能尚未准入”和“已经准入但外部服务暂时失败”。

### 2.2 小程序边界

- 从 `app.json` 取消注册未确认的问诊和门诊病历业务页面，防止直接路径绕过入口准入；
- 删除会调用未确认 API 的页面代码和客户端请求函数；
- 首页和“我的”仍保留原版入口名称、图标和 action，但统一进入 `feature-status`；
- 状态页文案明确说明迁移中，不显示 Provider 名称、内部错误码、数据库或技术拓扑；
- “我的挂号”和“爽约记录”继续使用已确认的预约历史读模型，不与问诊或病历共用事实来源。

### 2.3 可观测性边界

预约历史 503 的新端日志仍使用以下低敏字段定位真实原因：

- `event=appointment.records.failed`
- `providerOperation=appointment-records`
- `providerStatusCode`
- `providerRequestId`
- `providerRetryable`
- `traceId`

日志不记录 Authorization、请求体、响应体、患者姓名、身份证号或 Provider 原始报文。HTTP 503 只能说明错误被分类为可重试失败，最终原因必须以同一 `traceId` 的服务端日志为准，不能仅凭小程序错误文案推断。

## 3. 未修改范围

本轮只修改新项目和新项目文档：

- 未修改 `G:\\fuck\\hospital` 旧项目源码；
- 未修改旧 Python 服务、旧数据库、旧 Redis、旧 Nginx 转发；
- 未打开微信支付、医保、预约写入、临床病历、外部问诊或电子导诊单能力；
- 未把本地测试、健康检查或代码审计写成 Provider/公网/真机业务验收。

## 4. 重新开放条件

门诊病历重新进入实现评估前，至少需要同一 Provider 版本的请求、成功、合法空、未授权、越权、超时和字段异常样例，并确认：

1. 当前用户与 Provider 患者引用的映射规则；
2. 目录、正文、诊断、附件的独立权限和字段白名单；
3. 日期窗口、分页、时区和唯一引用规则；
4. 短期资源授权、过期、撤销和日志禁止字段；
5. API、真机和公网 HTTPS 的分层验收结果。

“我的问诊”还需要独立的外部入口 contract，包括外部主体、受众、短期会话、回跳、退出、撤销、内容保留和失败回退；不能直接复用预约历史。

