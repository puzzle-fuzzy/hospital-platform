# 项目文档导航

新会话开始前先阅读本页，再根据任务进入对应文档。文档中的“已实现”只代表代码/测试或部署证据，不自动代表
真实微信、医保、HIS、支付 provider 或真机已经验收。

## 首先阅读

| 文档 | 用途 |
| --- | --- |
| [`wechat-auth-login.md`](wechat-auth-login.md) | 微信授权登录的架构、配置、域名、日志、验收和回滚唯一入口 |
| [`architecture.md`](architecture.md) | 全局分层、依赖注入、fail-closed 和迁移边界 |
| [`roadmap-next-phase.md`](roadmap-next-phase.md) | 业务、工程、运行和验收的下一阶段统一路线图 |
| [`business-correctness.md`](business-correctness.md) | 患者上下文、映射、时间窗口、只读边界和错误处理不变量 |
| [`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md) | 患者目录同步的 durable operation ledger、租约代次、重放语义和生产验收门禁 |
| [`api-v2-public.md`](api-v2-public.md) | 当前 Elysia 公共 `/api/v2` 路由、请求规则、响应字段和稳定错误码 |
| [`migration/remaining-migration-inventory.md`](migration/remaining-migration-inventory.md) | 旧端 64 个页面、新端 14 个页面的差异、风险分级和新接口文档冻结模板 |
| [`logging.md`](logging.md) | Pino 事件、脱敏字段、requestId/traceId 和 journald 检索 |
| [`../README.md`](../README.md) | 项目状态、开发命令和公开 API 概览 |

## 发布与运行

| 文档 | 用途 |
| --- | --- |
| [`../infra/README.md`](../infra/README.md) | 本地 MySQL/Redis、migration、schema probe 和 runtime smoke |
| [`../infra/systemd/README.md`](../infra/systemd/README.md) | 新 API/worker 的 systemd 目录、env 权限和启动检查 |
| [`../infra/systemd/api-v2-release-runbook.md`](../infra/systemd/api-v2-release-runbook.md) | 新 API 候选 release 的原子切换、最小权限、验收和回滚 |
| [`release/persistence-acceptance.md`](release/persistence-acceptance.md) | MySQL/Redis/schema 的分层验收 |
| [`runbooks/persistence-migration-recovery.md`](runbooks/persistence-migration-recovery.md) | migration 失败和恢复边界 |
| [`release/provider-directory-acceptance.md`](release/provider-directory-acceptance.md) | 众阳患者、预约和报告 provider 验收 |
| [`release/user-profile-production-acceptance-2026-08-16.md`](release/user-profile-production-acceptance-2026-08-16.md) | 普通个人资料 0014 migration、生产 API、schema 和公网路由验收；真实微信资料读写仍待完成 |
| [`release/patient-sync-idempotency-production-acceptance-2026-08-16.md`](release/patient-sync-idempotency-production-acceptance-2026-08-16.md) | 患者同步 0015 schema、新代码隔离 smoke 和新旧服务共存证据；公网新 release 尚未切换 |
| [`release/public-readiness-cache-audit-2026-08-16.md`](release/public-readiness-cache-audit-2026-08-16.md) | 公网 readiness 瞬时差异、内网绑定地址和健康探针 no-store 候选修复证据 |
| [`release/candidate-b4dc33b-production-smoke-2026-08-16.md`](release/candidate-b4dc33b-production-smoke-2026-08-16.md) | `b4dc33b` 生产 env preflight、bundle checksum、临时端口 runtime smoke 和旧服务共存收尾证据 |
| [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md) | `3dc6f5f` 真实生产依赖 preflight、临时端口 runtime smoke、trace 关联修复和旧服务共存证据 |
| [`release/candidate-3129148-preproduction-smoke-2026-08-16.md`](release/candidate-3129148-preproduction-smoke-2026-08-16.md) | `3129148` Provider smoke 会话边界、真实依赖 preflight、临时端口 runtime smoke 和旧服务共存证据 |
| [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md) | `d177991` 候选 checksum、生产 env、原子切换、公网 `/api/v2` 和旧服务共存验收 |
| [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md) | 2026-08-16 生产新旧服务、MySQL/Redis、Worker、权限和公网 v2 的只读快照 |
| [`release/systemd-narrow-permission-acceptance-2026-08-16.md`](release/systemd-narrow-permission-acceptance-2026-08-16.md) | 新 API 最小 systemd NOPASSWD 规则的安装、校验和旧服务共存证据 |
| [`release/observability-error-contract-smoke-2026-08-16.md`](release/observability-error-contract-smoke-2026-08-16.md) | `f2c6d99` 候选 release 的 production env 隔离 smoke、中文错误契约和清理证据；不代表公网切换 |
| [`release/miniprogram-static-navigation-acceptance.md`](release/miniprogram-static-navigation-acceptance.md) | 原生小程序静态院内导航页面验收 |
| [`release/miniprogram-static-hospital-list-acceptance.md`](release/miniprogram-static-hospital-list-acceptance.md) | 原生小程序静态医院卡片、预约前置和路线未开放边界验收 |
| [`release/miniprogram-static-official-account-acceptance.md`](release/miniprogram-static-official-account-acceptance.md) | 原生小程序静态公众号说明页和关注事实边界验收 |
| [`release/miniprogram-static-feedback-acceptance.md`](release/miniprogram-static-feedback-acceptance.md) | 原生小程序反馈帮助、客服电话和真实提交边界验收 |
| [`release/payment-acceptance.md`](release/payment-acceptance.md) | 微信支付、回调、查单和真机验收 |

## 契约与迁移

| 文档 | 用途 |
| --- | --- |
| [`provider-contract-v1.md`](provider-contract-v1.md) | 微信、众阳和支付 adapter 边界 |
| [`provider-document-intake.md`](provider-document-intake.md) | 新 provider 文档的接收、标准化、冻结和验收流程 |
| [`provider-contract-template.md`](provider-contract-template.md) | 收到新文档后逐 endpoint 填写请求、响应、错误、状态、权限和验收证据的模板 |
| [`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md) | 本轮挂号登记、支付挂号和外部退款文档的 SHA-256、字段、状态、依赖缺口和冻结决策；当前为 `normalized` |
| [`provider-intake/2026-08-16-outpatient-settlement-insurance.md`](provider-intake/2026-08-16-outpatient-settlement-insurance.md) | 门诊结算、支付查单、关单、取消结算和医保回写材料的指纹、流程顺序和 SET-01 至 SET-08 实现缺口；当前为 `normalized` |
| [`medical-insurance-contract-v1.md`](medical-insurance-contract-v1.md) | 医保金额、状态和回写契约 |
| [`appointment-write-contract-v1.md`](appointment-write-contract-v1.md) | 预约写入/锁号/取消的冻结边界 |
| [`migration/payment-contract.md`](migration/payment-contract.md) | 门诊支付、挂号医保支付、微信预支付和 Provider 支付挂号状态的边界 |
| [`migration/api-matrix.md`](migration/api-matrix.md) | 旧接口到新接口的迁移矩阵 |
| [`migration/legacy-api-endpoint-inventory.md`](migration/legacy-api-endpoint-inventory.md) | 旧 FastAPI 与旧小程序 provider endpoint 的逐项快照、状态和业务边界 |
| [`migration/data-map.md`](migration/data-map.md) | 旧数据和新表/领域字段的映射 |
| [`migration/legacy-inventory.md`](migration/legacy-inventory.md) | 旧项目能力清单和未迁移风险 |
| [`migration/legacy-page-matrix.md`](migration/legacy-page-matrix.md) | 64 个旧端页面的逐页状态、风险和下一步边界 |
| [`migration/native-page-migration-status.md`](migration/native-page-migration-status.md) | 以 `app.json` 为事实源的 14 个原生页面业务状态、边界和下一步门禁 |
| [`migration/medical-record-and-hospital-boundary.md`](migration/medical-record-and-hospital-boundary.md) | 门诊病历、住院、医院列表和院内导航的旧接口审计与 contract 边界 |
| [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md) | 门诊就诊记录目录的旧字段差异、候选 contract、provider 确认问题和实现门禁 |
| [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) | 便民服务 13 个旧路由、旧表风险、新领域边界、幂等、日志和验收门禁 |
| [`migration/health-calculator-contract-draft.md`](migration/health-calculator-contract-draft.md) | BMI/血压旧端规则审计、临床确认项、版本化规则和迁移门禁 |
| [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) | 个人资料、绑卡、协议、签名、订阅、WebView、医院列表和采血预约的旧行为与安全边界 |
| [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md) | 患者查档、建档、绑卡、协议、幂等、超时恢复和 provider 待确认问题；当前写入路由保持关闭 |
| [`migration/user-profile-contract.md`](migration/user-profile-contract.md) | 普通个人资料的字段边界、版本并发、owner 隔离、头像/实名排除项和验收门禁 |
| [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md) | 旧端请求封装、WebSocket、Pinia 状态、复用组件、静态配置和资源的迁移边界 |
| [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md) | 旧 Redis、MongoDB、APScheduler、文件资源、AI/WebSocket、Admin/RBAC 与新服务替代状态 |

## 维护规则

1. 新增业务能力时，先更新 API contract、架构文档、日志事件和验收手册，再写实现。
2. 新增环境变量时，只在 `.env.example` 和对应运行手册记录变量名/用途，真实值通过 SSH 或密钥管理传输。
3. 新增日志事件时，必须说明可记录字段和禁止字段；Pino redact 只是兜底，不是记录敏感数据的许可。
4. 真实 provider、生产 schema、公网 Nginx 和真机验收必须分别保存证据，不能用单元测试代替。
5. 旧服务仍由原项目和 `8001` 管理；新服务只使用 `api-v2` systemd、`18081` 和 `/api/v2` 公网路由。
6. 新增或删除原生页面后必须运行 `pnpm migration:audit`；页面注册、TypeScript 源码、构建生成的 JavaScript 和迁移台账必须同步。
