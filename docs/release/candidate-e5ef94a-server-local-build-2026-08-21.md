# 新 API 候选 `e5ef94a` 本地构建与发布准备记录（2026-08-21）

> 本文只登记新 Elysia API 的本地候选，不代表已经上传、切换或验收线上服务。候选只包含门诊费用只读 adapter 的稳定身份边界修正；旧 Python `8001`、数据库 schema、Redis、Worker、支付/医保/HIS 和并行会话维护的众阳自动化均不在变更范围。

## 1. 固定来源与当前线上基线

| 项目 | 值 |
| --- | --- |
| 候选提交 | `e5ef94a2dd75c25ff3e5d5a37082ac96185c7ace` |
| 当前线上新 API | `5a314275e9bae43730eab5b32638a8baecda5869` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 服务 | `0.0.0.0:8001`，本轮未修改、未重启 |
| 目标 systemd unit | `hospital-platform-api-v2.service` |
| Worker | 保持 inactive，不启动 |
| 上传/切换状态 | 未上传，线上仍为 `5a31427` |

## 2. 业务变更

众阳门诊费用响应中的 `itemName` 只是展示文本，不能作为费用、就诊或单据的稳定身份。
`opaqueRecordId()` 现在只接受已经确认的单据、就诊或费用标识；如果 Provider 只返回展示名称、账单日期、金额和状态，adapter 会在映射阶段整批拒绝，避免生成后续无法定位原始费用的假引用。

本候选不改变 Provider 请求参数、金额单位、`paid/unpaid` 状态、患者 owner 映射或支付入口；它只收紧异常读模型的 fail-closed 边界。对应回归测试覆盖“仅展示名称不能生成 `recordId`”。

## 3. 本地产物校验

以下构建产物由本地 `pnpm check` 通过后生成，上传前必须再次按完整提交号和哈希核对：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `4FC001B8F290A50E92E6B94F047158AECE7B66D992CCF05C3C8C3F267990DE7C` |
| `apps/worker/dist/index.js` | `36E0B46DDCCE11CE65BCDCA83C742609339E689F4C0D9A915CAC7EF97699F3BF` |
| `apps/worker/dist/preflight.js` | `11CC08A3B1AC7F70CA4F1644AA2CD9601CF492BCC066149134C108C1443ECB0E` |
| `apps/worker/dist/provider-directory-smoke.js` | `1604B6A470B1A61DA8295050EBD9862E1C402DAFDF54DA40CC71C07CD4DEAA80` |
| `apps/worker/dist/api-runtime-smoke.js` | `193330C3280509BA3FB4762A4419E54D0E098B640AC34B619B685334D2906A4D` |
| `apps/worker/dist/p0-log-aggregate.js` | `280B175341C2794290AB61BF6175295922C79BD588972732F05CAEFA0BD54746B` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `AFA687B6E52021237F275E808466800433BD8D48A344C7C879F944E5A2A1EB9E` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `9FE022C7A10356B8144E50408E874640A250617B03470D99CE5DA0B9D912487E` |

验证事实：

- `pnpm check`：通过；架构、迁移、Provider intake、文档、release baseline、Biome、工具测试、9 个 workspace 类型/测试/构建均通过；
- adapter 全量测试：105 项通过，0 项失败；
- API 全量测试：188 项通过，0 项失败；
- 本次只读发布准备没有调用 Provider、没有执行 migration、没有写入 MySQL/Redis。

## 4. 上传前置与停止条件

按照 [`infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)，后续必须依次完成：

1. 上传到独立 `releases/e5ef94a2dd75c25ff3e5d5a37082ac96185c7ace` 目录；
2. 远端逐文件 SHA-256 与上表一致；
3. 使用真实 `shared/api.env` 执行 production preflight；
4. 在 `18082` 做隔离 runtime smoke；
5. 只原子切换 `current` 并只重启 `hospital-platform-api-v2.service`；
6. 切换后确认新 API production/readiness、公网 `/api/v2/health/ready` 和旧 `8001` 同时正常。

2026-08-21 本地尝试只读 SSH `ps@192.168.112.172` 返回 `Permission denied (publickey,password)`，因此第 1 步尚未执行，也没有修改服务器、旧服务、配置、数据库或 Redis。恢复授权公钥后再继续；不得在认证恢复前把候选状态写成已发布。

## 5. 回滚边界

若后续完成切换且新 API readiness、公网路径或业务读模型异常，只把 `current` 原子恢复到切换前实际读取的 release，并只重启 `hospital-platform-api-v2.service`；禁止停止/重启旧 Python、删除旧 release、清空 Redis 或回滚数据库 schema。
