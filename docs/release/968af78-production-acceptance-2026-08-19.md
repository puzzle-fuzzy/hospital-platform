# `968af78` 新 API 生产切换与档案关联验收

> 记录时间：2026-08-19 14:56–15:01 CST
> 状态：新 Elysia API 已从 `08c36a8` 原子切换到 `968af78`；旧 Python 服务继续共存。
> 本记录只证明新服务运行层、发布产物和档案关联代码已通过验收，不把 readiness 或基础路由通过误写成真实微信、HIS、真机或支付业务完成。

配套小程序候选为 `48ba22f`，完整构建来源为 `48ba22f16cb0f1d1098895772e660a3ed96761bb`，尚未上传线上。

## 1. 本次变更和保护边界

- 只修改新项目的 `patInfosFind` 档案关联逻辑：明确返回空的 `patCardVOList`，或卡片项全部没有可比卡号时，
  不再写入 `his-patient` 临床映射；新增定向回归测试和中文业务注释。
- 旧 Python API `0.0.0.0:8001` 未修改、未停止、未重启；没有执行数据库迁移、清理 Redis 或启动 Worker。
- 生产 `current` 从 `08c36a8` 原子切换到 `968af78`，只重启 `hospital-platform-api-v2.service`。
- 新 API 继续监听 `10.0.0.3:18081`，公网入口继续为 `https://test-hp.meiyi.pro/api/v2`。

## 2. 本地门禁

- `pnpm check` 全部通过：架构、迁移清单、Provider 文档、227 份 Markdown 链接、发布基线、Biome、工具测试、
  9 个包类型检查、9 个包测试和 9 个构建任务均通过。
- 众阳 adapter 定向测试为 `90 pass / 0 fail`；API 测试为 `163 pass / 0 fail`。
- 用户已有的 `apps/miniprogram/project.config.json` 未修改、未暂存、未提交。

## 3. 生产产物 SHA-256

候选目录为 `/home/ps/code/hospital-platform/releases/968af78`，上传后服务器校验结果如下：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `5C019D6FCBBC0F96B47B297D19959907BA3A7B0DEB1B1AF2DC31C95886EAF454` |
| `apps/worker/dist/index.js` | `7AB9C0F70EDD7E2EBF06E0B867640E6C3F95D967BD0F632C7C05DBBE891DE7A8` |
| `apps/worker/dist/preflight.js` | `A3A798FE97963750A029941BFBB22CBBEF844F43753CBB8860E0D169B8BA26F4` |
| `apps/worker/dist/provider-directory-smoke.js` | `950F6C81E4BF3BAE042F208088D5CFA2B003CD2B7B9BF2D0D807FC6602F2D561` |
| `apps/worker/dist/api-runtime-smoke.js` | `694E66DDEEBAA7BDDA3B1ABF5DB42D6B4723A4C328DCB8D702D7CCB8A20E037A` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008A3EA05133767C077246ECD5C5DE000CA5FEA0307A1920B36276DA` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `D9105036E23B1807A7A0503C589EA9BBDBA5938D9DFA9218DDD15021FA7F3771` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `F6B59EFC09AC165D032BCDE15BDB6397813A84D2267C9139BDC09B88F02B023F` |

## 4. 生产 preflight 与隔离 smoke

使用服务器真实 `shared/api.env` 执行同一 release 的 preflight，结果为：

- `environment=production`；
- MySQL、Redis、schema 均为 `ok`，schema marker 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；
- 支付、报告目录和报告详情继续为 `disabled`。

候选在 `127.0.0.1:18082` 以 production 模式启动，经过有界启动重试后 live、ready、system ping 和未登录认证边界
全部通过，随后进程正常回收且没有残留监听。启动等待期间的连接拒绝仅发生在候选尚未完成启动时，不是旧服务故障。

## 5. 切换后复核

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/current -> releases/968af78` |
| 新 API unit | `hospital-platform-api-v2.service=active` |
| 新 API 启动时间 | `2026-08-19 15:00:04 CST` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，监听快照与切换前一致 |
| 内网 live/ready/ping | `200` |
| 公网 `/api/v2/health/live` | `200` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均 `ok` |
| 公网未登录患者接口 | `401`，错误码 `unauthorized` |
| 运行模式 | `NODE_ENV=production`、`runtimeMode=production` |
| 报告 gate | `ZHONGYANG_REPORT_DIRECTORY_READY=false`、`ZHONGYANG_REPORT_DETAIL_READY=false` |

切换过程中只重启了新 API；不能据此宣称真实微信登录、患者同步、预约、报告、费用、HIS 或真机业务已经完成。

## 6. 下一步

固定使用 `968af78` 服务端和 `48ba22f` 小程序候选，继续取得人工扫码后的真实微信 session、患者目录同步、多患者切换、
预约只读和门诊费用只读证据。支付、医保、二维码、HIS 写入和预约写入继续保持关闭或最后专项验收。

若新 API 出现未解释的 readiness 或业务错误，只将 `current` 回滚到 `08c36a8` 并重启新 API；旧 Python `8001` 不参与回滚。
