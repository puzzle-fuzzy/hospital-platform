# 项目文档导航

新会话开始前先阅读本页，再根据任务进入对应文档。文档中的“已实现”只代表代码/测试或部署证据，不自动代表
真实微信、医保、HIS、支付 provider 或真机已经验收。

## 首先阅读

| 文档 | 用途 |
| --- | --- |
| [`wechat-auth-login.md`](wechat-auth-login.md) | 微信授权登录的架构、配置、域名、日志、验收和回滚唯一入口 |
| [`architecture.md`](architecture.md) | 全局分层、依赖注入、fail-closed 和迁移边界 |
| [`roadmap-next-phase.md`](roadmap-next-phase.md) | 业务、工程、运行和验收的下一阶段统一路线图；当前生产 `0b6f38f` |
| [`business-correctness.md`](business-correctness.md) | 患者上下文、映射、时间窗口、只读边界和错误处理不变量 |
| [`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md) | 患者目录同步的 durable operation ledger、租约代次、重放语义和生产验收门禁 |
| [`api-v2-public.md`](api-v2-public.md) | 当前 Elysia 公共 `/api/v2` 路由、请求规则、响应字段和稳定错误码 |
| [`migration/remaining-migration-inventory.md`](migration/remaining-migration-inventory.md) | 旧端 64 个页面、新端 14 个页面的差异、风险分级和新接口文档冻结模板 |
| [`migration/current-execution-checkpoint-2026-08-17.md`](migration/current-execution-checkpoint-2026-08-17.md) | 当前 `0b6f38f` 线上事实、剩余迁移分层、P0/P1/P2/P3 顺序和偏移检查表 |
| [`migration/migration-gap-audit-2026-08-17.md`](migration/migration-gap-audit-2026-08-17.md) | 当前迁移差距、证据等级、未迁移分层、新文档接收门禁和下一阶段顺序 |
| [`release/p0-readonly-business-acceptance-runbook-2026-08-17.md`](release/p0-readonly-business-acceptance-runbook-2026-08-17.md) | 当前 `0b6f38f` 微信会话、患者上下文、预约历史、爽约和门诊费用的真机/日志验收步骤与业务不变量 |
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
| [`release/readiness-stability-gate.md`](release/readiness-stability-gate.md) | runtime/provider smoke 的连续 readiness 稳定性门禁与证据规则 |
| [`release/41c9c18-production-acceptance-2026-08-16.md`](release/41c9c18-production-acceptance-2026-08-16.md) | 历史 `41c9c18` 生产切换、预约科室/排班只读和快照持久化验收证据 |
| [`release/user-profile-production-acceptance-2026-08-16.md`](release/user-profile-production-acceptance-2026-08-16.md) | 普通个人资料 0014 migration、生产 API、schema 和公网路由验收；真实微信资料读写仍待完成 |
| [`release/patient-sync-idempotency-production-acceptance-2026-08-16.md`](release/patient-sync-idempotency-production-acceptance-2026-08-16.md) | 0015 生产证据与 0016 发布前历史边界；真实并发/多患者同步仍待验收 |
| [`release/patient-sync-0016-readiness-audit-2026-08-17.md`](release/patient-sync-0016-readiness-audit-2026-08-17.md) | 0016 发布前代码、schema gate、线上 marker/index 只读结果和非事务性 DDL 发布/止损顺序；发布后结果见当前 release 验收文档 |
| [`release/0b6f38f-production-acceptance-2026-08-17.md`](release/0b6f38f-production-acceptance-2026-08-17.md) | 当前 `0b6f38f` 原子切换、候选 checksum、真实 env preflight、公网 6/6 readiness 和新旧服务共存证据 |
| [`release/6d58c9c-production-acceptance-2026-08-17.md`](release/6d58c9c-production-acceptance-2026-08-17.md) | `6d58c9c` 生产切换、0016 migration、候选运行边界和未完成真机业务证据 |
| [`release/5c4e7cf-production-acceptance-2026-08-17.md`](release/5c4e7cf-production-acceptance-2026-08-17.md) | `5c4e7cf` MySQL 只读连接恢复、候选 checksum、生产切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/bab0ce2-production-acceptance-2026-08-17.md`](release/bab0ce2-production-acceptance-2026-08-17.md) | `bab0ce2` 探针日志增强、候选 checksum、真实生产 preflight、原子切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/ca5a372-production-acceptance-2026-08-17.md`](release/ca5a372-production-acceptance-2026-08-17.md) | `ca5a372` 认证顺序修复、候选 checksum、生产 preflight、公网认证边界和旧服务共存证据 |
| [`release/527d163-production-acceptance-2026-08-17.md`](release/527d163-production-acceptance-2026-08-17.md) | `527d163` 持久化瞬态故障安全日志增强、候选 checksum、生产 preflight、公网 6/6 readiness 和旧服务共存证据 |
| [`release/131fb5a-production-acceptance-2026-08-17.md`](release/131fb5a-production-acceptance-2026-08-17.md) | `131fb5a` 持久化错误码标准化、候选隔离 smoke、原子切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/public-readiness-cache-audit-2026-08-16.md`](release/public-readiness-cache-audit-2026-08-16.md) | 公网 readiness 瞬时差异、内网绑定地址和健康探针 no-store 候选修复证据 |
| [`release/candidate-b4dc33b-production-smoke-2026-08-16.md`](release/candidate-b4dc33b-production-smoke-2026-08-16.md) | `b4dc33b` 生产 env preflight、bundle checksum、临时端口 runtime smoke 和旧服务共存收尾证据 |
| [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md) | `3dc6f5f` 真实生产依赖 preflight、临时端口 runtime smoke、trace 关联修复和旧服务共存证据 |
| [`release/candidate-3129148-preproduction-smoke-2026-08-16.md`](release/candidate-3129148-preproduction-smoke-2026-08-16.md) | `3129148` Provider smoke 会话边界、真实依赖 preflight、临时端口 runtime smoke 和旧服务共存证据 |
| [`release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md) | `d8f14f1` 患者归属门禁、真实依赖 preflight、临时端口 runtime smoke 和旧服务共存证据 |
| [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md) | `d177991` 候选 checksum、生产 env、原子切换、公网 `/api/v2` 和旧服务共存验收 |
| [`release/current-d177991-observability-acceptance-2026-08-16.md`](release/current-d177991-observability-acceptance-2026-08-16.md) | `d177991` 切换窗口的历史业务日志边界、MySQL/Schema 瞬态故障和后续验收门禁 |
| [`release/candidate-a11f117-preproduction-smoke-2026-08-16.md`](release/candidate-a11f117-preproduction-smoke-2026-08-16.md) | `a11f117` 持久化只读探针有界重试、真实生产 env preflight、临时 API smoke 和现网隔离证据 |
| [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md) | `a11f117` 实际生产切换、内外网 health、启动日志、新旧服务共存和业务验收限制 |
| [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md) | 2026-08-16 生产新旧服务、MySQL/Redis、Worker、权限和公网 v2 的只读快照 |
| [`release/current-public-readonly-smoke-2026-08-17.md`](release/current-public-readonly-smoke-2026-08-17.md) | 2026-08-17 公网 live/ready/ping 和病历关闭边界的只读复核；不包含会话、Provider 或真机验收 |
| [`release/current-public-readiness-stability-2026-08-17.md`](release/current-public-readiness-stability-2026-08-17.md) | `ed250ec` smoke 源码对公网 `/api/v2` 的 6 次 readiness 连续采样证据；不代表该提交已部署 |
| [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md) | `3ab0a6c` 切换后、15:00 发布前服务器生产模式、双服务共存、依赖 readiness 和预约/门诊费用业务事件缺失的历史只读观察 |
| [`release/production-coexistence-readonly-audit-2026-08-17.md`](release/production-coexistence-readonly-audit-2026-08-17.md) | 2026-08-17 SSH 只读核对新 Bun `18081`、旧 Python `8001`、systemd 状态和 release 指针；不包含业务验收 |
| [`release/current-production-observability-audit-2026-08-17.md`](release/current-production-observability-audit-2026-08-17.md) | 2026-08-17 当前 API 启动 capability、MySQL/schema 探针抖动、微信登录失败/恢复和患者同步日志复核 |
| [`release/current-live-readonly-audit-2026-08-17.md`](release/current-live-readonly-audit-2026-08-17.md) | 2026-08-17 当前 release、内外网 ready、旧新服务共存和低敏业务日志关键词的只读核对 |
| [`release/candidate-3ab0a6c-preproduction-smoke-2026-08-17.md`](release/candidate-3ab0a6c-preproduction-smoke-2026-08-17.md) | `3ab0a6c` 患者目录空快照安全边界、真实生产 env preflight、隔离端口 runtime smoke 和旧服务共存证据 |
| [`release/3ab0a6c-production-acceptance-2026-08-17.md`](release/3ab0a6c-production-acceptance-2026-08-17.md) | `3ab0a6c` 原子切换、内外网运行时、6/6 readiness、旧服务共存和业务未验收边界 |
| [`release/daee96d-production-acceptance-2026-08-17.md`](release/daee96d-production-acceptance-2026-08-17.md) | `daee96d` 候选 checksum、真实生产 preflight、原子切换、公网 6/6 readiness、旧服务共存与业务未验收边界 |
| [`release/systemd-narrow-permission-acceptance-2026-08-16.md`](release/systemd-narrow-permission-acceptance-2026-08-16.md) | 新 API 最小 systemd NOPASSWD 规则的安装、校验和旧服务共存证据 |
| [`release/observability-error-contract-smoke-2026-08-16.md`](release/observability-error-contract-smoke-2026-08-16.md) | `f2c6d99` 候选 release 的 production env 隔离 smoke、中文错误契约和清理证据；不代表公网切换 |
| [`release/miniprogram-static-navigation-acceptance.md`](release/miniprogram-static-navigation-acceptance.md) | 原生小程序静态院内导航页面验收 |
| [`release/miniprogram-static-hospital-list-acceptance.md`](release/miniprogram-static-hospital-list-acceptance.md) | 原生小程序静态医院卡片、预约前置和路线未开放边界验收 |
| [`release/miniprogram-static-official-account-acceptance.md`](release/miniprogram-static-official-account-acceptance.md) | 原生小程序静态公众号说明页和关注事实边界验收 |
| [`release/miniprogram-static-feedback-acceptance.md`](release/miniprogram-static-feedback-acceptance.md) | 原生小程序反馈帮助、客服电话和真实提交边界验收 |
| [`release/miniprogram-devtools-runtime-acceptance-2026-08-16.md`](release/miniprogram-devtools-runtime-acceptance-2026-08-16.md) | 原生小程序 `dist/` 模块缺失、开发者工具配置修复和模拟器复核证据 |
| [`release/miniprogram-runtime-package-verification-2026-08-17.md`](release/miniprogram-runtime-package-verification-2026-08-17.md) | 报告目录/就诊人页面 JS 缺失问题的构建后运行包验证和未覆盖边界 |
| [`release/payment-acceptance.md`](release/payment-acceptance.md) | 微信支付、回调、查单和真机验收 |

## 契约与迁移

| 文档 | 用途 |
| --- | --- |
| [`provider-contract-v1.md`](provider-contract-v1.md) | 微信、众阳和支付 adapter 边界 |
| [`provider-document-intake.md`](provider-document-intake.md) | 新 provider 文档的接收、标准化、冻结和验收流程 |
| [`provider-contract-template.md`](provider-contract-template.md) | 收到新文档后逐 endpoint 填写请求、响应、错误、状态、权限和验收证据的模板 |
| [`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md) | 本轮挂号登记、支付挂号和外部退款文档的 SHA-256、字段、状态、依赖缺口和冻结决策；当前为 `normalized` |
| [`provider-intake/2026-08-16-outpatient-settlement-insurance.md`](provider-intake/2026-08-16-outpatient-settlement-insurance.md) | 门诊结算、支付查单、关单、取消结算和医保回写材料的指纹、流程顺序和 SET-01 至 SET-08 实现缺口；当前为 `normalized` |
| [`provider-intake/2026-08-17-legacy-document-discovery.md`](provider-intake/2026-08-17-legacy-document-discovery.md) | 旧项目文档目录中此前未登记的门诊待支付、基础目录、门诊结算、医保规范和微信医保材料；含内部组件文档排除说明；当前为 `normalized` |
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
| [`migration/directory-contract-diff-2026-08-17.md`](migration/directory-contract-diff-2026-08-17.md) | 2.1.9 科室基础目录与 2.1.13 院内用户资料和当前预约/患者域的差异、敏感字段和实现门禁 |
| [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) | 便民服务 13 个旧路由、旧表风险、新领域边界、幂等、日志和验收门禁 |
| [`migration/health-calculator-contract-draft.md`](migration/health-calculator-contract-draft.md) | BMI/血压旧端规则审计、临床确认项、版本化规则和迁移门禁 |
| [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) | 个人资料、绑卡、协议、签名、订阅、WebView、医院列表和采血预约的旧行为与安全边界 |
| [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md) | 患者查档、建档、绑卡、协议、幂等、超时恢复和 provider 待确认问题；当前写入路由保持关闭 |
| [`migration/user-profile-contract.md`](migration/user-profile-contract.md) | 普通个人资料的字段边界、版本并发、owner 隔离、头像/实名排除项和验收门禁 |
| [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md) | 旧端请求封装、WebSocket、Pinia 状态、复用组件、静态配置和资源的迁移边界 |
| [`migration/static-and-closed-feature-parity.md`](migration/static-and-closed-feature-parity.md) | 静态页面、旧端假保存和未注册能力的真值分类，避免把未来能力误记成旧业务迁移缺口 |
| [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md) | 旧 Redis、MongoDB、APScheduler、文件资源、AI/WebSocket、Admin/RBAC 与新服务替代状态 |

## 维护规则

1. 新增业务能力时，先更新 API contract、架构文档、日志事件和验收手册，再写实现。
2. 新增环境变量时，只在 `.env.example` 和对应运行手册记录变量名/用途，真实值通过 SSH 或密钥管理传输。
3. 新增日志事件时，必须说明可记录字段和禁止字段；Pino redact 只是兜底，不是记录敏感数据的许可。
4. 真实 provider、生产 schema、公网 Nginx 和真机验收必须分别保存证据，不能用单元测试代替。
5. 旧服务仍由原项目和 `8001` 管理；新服务只使用 `api-v2` systemd、`18081` 和 `/api/v2` 公网路由。
6. 新增或删除原生页面后必须运行 `pnpm migration:audit`；页面注册、TypeScript 源码、构建生成的 JavaScript 和迁移台账必须同步。
7. 新增或移动 Markdown 文档后必须运行 `pnpm docs:audit`；本地链接必须指向仓库内现有文件，外部链接不由该门禁代替联网验收。
