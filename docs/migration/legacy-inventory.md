# 旧项目迁移盘点

> 盘点时间：2026-08-15。来源仓库：`G:\\fuck\\hospital`。本文件只记录只读扫描到的代码和文档证据，不把旧项目当前行为自动视为正确行为。

## 1. 当前拓扑

| 区域 | 观察到的实现 | 重构处理 |
| --- | --- | --- |
| 主 API | `main.py` + `app/`，FastAPI、SQLAlchemy Async、Redis、MongoDB | 替换为 Bun/Elysia API；数据库和缓存先保留兼容边界 |
| 患者端 | `hospital-app/`，uni-app/Vue，主 API 与众阳/云健康直连请求并存 | 替换为原生小程序；所有外部系统请求收回服务端 |
| 医保 FSI | `app/api/v1/module_common/mbs_fsi/`，包含通用转发、1101、6201、6202、6203、6301、6401、6302 | 归入 `legacy-fsi` / `medical-insurance` adapter；不把原始 FSI 报文暴露给患者端 |
| 微信支付 | 微信自费、医保混合支付、通知、退款和关单接口位于 `module_common/mbs_fsi/` | 归入 `wechat-pay` adapter；回调单独处理并幂等落库 |
| HIS/众阳/云健康 | 小程序存在 `VITE_ZHONGYI_BASE_API` 直连；后端存在 YunHealth 结算回写 | 统一由 `hospital-his`、`zhongyang`、`yunhealth` adapter 编排 |
| 加密与遗留服务 | `external_library/*.jar`、`app/utils/java_util.py`、`app/utils/sign_util.py`、`insurance-service/` | Bun 先通过 sidecar/adapter 使用；完成协议向量和真实联调后再决定替换 |
| 后台与任务 | `/system`、`/monitor`、`/application`，含 RBAC、日志、监控和 APScheduler | 与患者端 API 分边界迁移；Worker 独立运行 |

## 2. 业务域分组

### 患者端优先域

- 微信小程序登录：`/system/auth/login/wechat`
- 用户与就诊人：`/system/user/*`，以及小程序通过众阳接口查询/创建患者档案
- 挂号、预约、报告：小程序 API 模块和众阳云健康接口
- 门诊待支付、挂号医保支付、微信自费/混合支付
- 健康知识、报告解读、自测、便民服务

### 平台管理域

- `/system/user`、`/system/role`、`/system/menu`、`/system/dept`
- `/monitor/cache`、`/monitor/online`、`/monitor/server`、`/monitor/resource`
- `/application/job`
- 操作日志、字典、参数和通知

### 外部系统域

- 医保 FSI：9001、1101、2201、2206A、2207A、s601、s602、s603、s605、6201、6202、6203、6301、6302、6401
- 云健康结算：2.27.2.32 回写与 2.6.65.5 完成结算
- 微信支付：JSAPI 下单、医保混合支付、查单、关单、退款和回调
- AI：Ollama、Dify RAG、报告解读、导诊与音频接口

## 3. 已确认的高风险事实

1. 旧配置包含微信、医保转发、FSI、云健康、AI、数据库、Redis 等大量外部凭证和地址；新项目不能复制默认密钥、私钥或客户端配置。
2. 旧小程序的 `httpZy.ts` 允许直接请求众阳/云健康地址，并把 Bearer token 带到外部请求；这是新架构必须收回服务端的边界。
3. 支付接口既有“门诊待支付列表”流程，也有“预约挂号医保支付”流程；两者不能用同一套入口字段混用。
4. `6201/6202`、微信回调、医保结果查询、云健康回写和 HIS 完成结算之间存在多个外部状态；支付调起成功不能作为最终成功。
5. 旧项目存在独立 `insurance-service` 和 Java JAR 加密资产；在没有协议测试向量和真实服务验收前，不能把它们当作可安全移植到 Bun 的普通工具函数。

## 4. 待验证与阻塞项

| 项目 | 当前证据 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 现有 MySQL 表与线上数据兼容性 | Alembic 迁移存在，尚未在新项目导入 schema | 待验证 | 提取完整表结构、索引、约束和敏感字段 |
| Redis key 与任务状态 | 旧项目依赖 Redis，业务 key 分散在服务和任务中 | 待验证 | 盘点 key、TTL、锁和重试语义 |
| FSI 加密是否可由 Bun 替代 | Java JAR、SM2/SM4/RSA 代码与独立服务并存 | 阻塞 | 先保留 sidecar，收集签名/加密向量 |
| 微信医保混合查单 | 旧文档标记部分查单接口尚未接入 | 待验证 | 明确 provider query、回调和最终状态来源 |
| 2.27.2.32/2.6.65.5 撤销分支 | 现有文档说明缺少完整撤销字段 | 阻塞 | 取得 2.27.2.10、2.6.65.15 等完整文档 |
| 生产公网和真机支付 | 当前仅能作为代码/契约证据 | 未验证 | 单独安排沙箱、真机、生产代理和真实支付验收 |

## 5. 迁移规则

- 先建目标契约和 adapter port，再迁移具体 provider 实现。
- 患者端 API 只返回业务视图模型，不返回原始 FSI envelope、签名字段或内部凭证。
- 数据迁移先保持 MySQL/Redis，不在同一阶段更换数据库和支付协议。
- 所有外部请求必须携带 trace id、幂等键和超时策略；敏感值只记录摘要。
- 每个迁移域都必须区分“代码已实现”“沙箱已验证”“真机/生产已验证”。

## 6. 2026-08-16 复盘结论

旧端共扫描到 64 个 Vue 页面；2026-08-16 盘点时新端有 14 个 TypeScript 页面源文件，当前 `app.json` 已注册 16 个页面。患者登录、患者目录、
医院列表单院区静态卡片、公众号通知说明、意见反馈帮助页、预约/报告/门诊费用只读骨架和院内静态地图已经形成，但以下能力仍不能标记为已迁移：患者新增绑定、二维码、预约写入/锁号/取消、
费用详情、真实支付、医保 FSI、HIS 回写、门诊病历、住院、健康百科、自测、风险评估、预问诊/随访、便民服务、
智能导诊、个人中心扩展入口和管理端。

逐页差异、优先级和接口文档获取后的冻结模板见
[`remaining-migration-inventory.md`](remaining-migration-inventory.md)。后续新 provider 文档到达前，
不再从旧小程序字段推导新的写入或支付 contract。
