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
| [`api-v2-public.md`](api-v2-public.md) | 当前 Elysia 公共 `/api/v2` 路由、请求规则、响应字段和稳定错误码 |
| [`migration/remaining-migration-inventory.md`](migration/remaining-migration-inventory.md) | 旧端 64 个页面、新端 9 个页面的差异、风险分级和新接口文档冻结模板 |
| [`logging.md`](logging.md) | Pino 事件、脱敏字段、requestId/traceId 和 journald 检索 |
| [`../README.md`](../README.md) | 项目状态、开发命令和公开 API 概览 |

## 发布与运行

| 文档 | 用途 |
| --- | --- |
| [`../infra/README.md`](../infra/README.md) | 本地 MySQL/Redis、migration、schema probe 和 runtime smoke |
| [`../infra/systemd/README.md`](../infra/systemd/README.md) | 新 API/worker 的 systemd 目录、env 权限和启动检查 |
| [`release/persistence-acceptance.md`](release/persistence-acceptance.md) | MySQL/Redis/schema 的分层验收 |
| [`runbooks/persistence-migration-recovery.md`](runbooks/persistence-migration-recovery.md) | migration 失败和恢复边界 |
| [`release/provider-directory-acceptance.md`](release/provider-directory-acceptance.md) | 众阳患者、预约和报告 provider 验收 |
| [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md) | 2026-08-16 生产新旧服务、MySQL/Redis、Worker、权限和公网 v2 的只读快照 |
| [`release/miniprogram-static-navigation-acceptance.md`](release/miniprogram-static-navigation-acceptance.md) | 原生小程序静态院内导航页面验收 |
| [`release/payment-acceptance.md`](release/payment-acceptance.md) | 微信支付、回调、查单和真机验收 |

## 契约与迁移

| 文档 | 用途 |
| --- | --- |
| [`provider-contract-v1.md`](provider-contract-v1.md) | 微信、众阳和支付 adapter 边界 |
| [`provider-document-intake.md`](provider-document-intake.md) | 新 provider 文档的接收、标准化、冻结和验收流程 |
| [`medical-insurance-contract-v1.md`](medical-insurance-contract-v1.md) | 医保金额、状态和回写契约 |
| [`appointment-write-contract-v1.md`](appointment-write-contract-v1.md) | 预约写入/锁号/取消的冻结边界 |
| [`migration/api-matrix.md`](migration/api-matrix.md) | 旧接口到新接口的迁移矩阵 |
| [`migration/legacy-api-endpoint-inventory.md`](migration/legacy-api-endpoint-inventory.md) | 旧 FastAPI 与旧小程序 provider endpoint 的逐项快照、状态和业务边界 |
| [`migration/data-map.md`](migration/data-map.md) | 旧数据和新表/领域字段的映射 |
| [`migration/legacy-inventory.md`](migration/legacy-inventory.md) | 旧项目能力清单和未迁移风险 |
| [`migration/legacy-page-matrix.md`](migration/legacy-page-matrix.md) | 64 个旧端页面的逐页状态、风险和下一步边界 |
| [`migration/medical-record-and-hospital-boundary.md`](migration/medical-record-and-hospital-boundary.md) | 门诊病历、住院、医院列表和院内导航的旧接口审计与 contract 边界 |
| [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) | 便民服务 13 个旧路由、旧表风险、新领域边界、幂等、日志和验收门禁 |
| [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) | 个人资料、绑卡、协议、签名、订阅、WebView、医院列表和采血预约的旧行为与安全边界 |
| [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md) | 旧端请求封装、WebSocket、Pinia 状态、复用组件、静态配置和资源的迁移边界 |
| [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md) | 旧 Redis、MongoDB、APScheduler、文件资源、AI/WebSocket、Admin/RBAC 与新服务替代状态 |

## 维护规则

1. 新增业务能力时，先更新 API contract、架构文档、日志事件和验收手册，再写实现。
2. 新增环境变量时，只在 `.env.example` 和对应运行手册记录变量名/用途，真实值通过 SSH 或密钥管理传输。
3. 新增日志事件时，必须说明可记录字段和禁止字段；Pino redact 只是兜底，不是记录敏感数据的许可。
4. 真实 provider、生产 schema、公网 Nginx 和真机验收必须分别保存证据，不能用单元测试代替。
5. 旧服务仍由原项目和 `8001` 管理；新服务只使用 `api-v2` systemd、`18081` 和 `/api/v2` 公网路由。
