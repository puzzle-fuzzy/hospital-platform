# `08c36a8` 新 API 生产切换与日志脱敏验收

> 记录时间：2026-08-19 14:40–14:43 CST
> 状态：新 Elysia API 已从 `65219e2` 原子切换到 `08c36a8`；旧 Python 服务继续共存。
> 本记录只证明运行层和发布边界，不把 readiness、Provider 配置或基础路由通过误写成真实微信、HIS、真机或支付验收。

配套小程序候选来源仍为 `482288496c6de90ff86fb2f2eb54db3b9ae0bae5`（提交 `4822884`，尚未上传线上）。

## 1. 本次切换范围

- 旧 Python API `0.0.0.0:8001` 未修改、未停止、未重启，继续提供旧服务。
- 只上传并切换新项目 release，随后只重启 `hospital-platform-api-v2.service`；没有重启 Worker，
  没有执行数据库迁移、清理 Redis 或修改旧 Python 项目。
- 生产 `current` 从 `65219e2` 原子切换到 `08c36a8`；候选先在独立端口完成 production preflight 和运行 smoke，
  readiness 失败时具备回滚到上一版新 API release 的条件。
- 新 API 继续监听 `10.0.0.3:18081`，公网入口继续为 `https://test-hp.meiyi.pro/api/v2`。

## 2. 本次代码变化：日志最终兜底脱敏

Pino 的最终 redaction 列表补齐了 HIS 档案链中容易被误记录的字段：`patId`、`thirdPatientId`、患者姓名、卡号、
身份证号、手机号、`patCardVOList` 和 `providerReferences`，同时覆盖对象嵌套和通配路径。定向观测测试验证这些字段
在嵌套 Provider 档案日志中都会变成 `[REDACTED]`。

这项变更不改变 `patInfosFind` 的业务映射，也不把临床 `patId` 返回给小程序；它只是防止异常日志、调试上下文或
Provider 响应误进入结构化日志。完整字段边界见 [`../logging.md`](../logging.md)。

## 3. 本地发布证据

- `pnpm check` 通过：架构 66 条规则、文档链接审计 227 份、9/9 类型检查、9/9 测试和 9/9 构建通过；
  API 163 项通过，观测脱敏测试 4/4，小程序构建生成 14 个页面脚本。
- 用户已有的 `apps/miniprogram/project.config.json` 未修改、未暂存、未提交。
- 本地构建来源仍由 `apps/miniprogram/dist/build-info.json` 锁定到完整 source revision
  `482288496c6de90ff86fb2f2eb54db3b9ae0bae5`。

## 4. 生产产物校验

候选目录为 `/home/ps/code/hospital-platform/releases/08c36a8`，以下构建产物 SHA-256 与本地上传内容一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `3FEF8D6EDC1D5310DB2BB0428B48362B2906D8BD4BE33699D88BADD430C9C7D0` |
| `apps/worker/dist/index.js` | `7AB9C0F70EDD7E2EBF06E0B867640E6C3F95D967BD0F632C7C05DBBE891DE7A8` |
| `apps/worker/dist/preflight.js` | `A3A798FE97963750A029941BFBB22CBBEF844F43753CBB8860E0D169B8BA26F4` |
| `apps/worker/dist/provider-directory-smoke.js` | `950F6C81E4BF3BAE042F208088D5CFA2B003CD2B7B9BF2D0D807FC6602F2D561` |
| `apps/worker/dist/api-runtime-smoke.js` | `694E66DDEEBAA7BDDA3B1ABF5DB42D6B4723A4C328DCB8D702D7CCB8A20E037A` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008A3EA05133767C077246ECD5C5DE000CA5FEA0307A1920B36276DA` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `D9105036E23B1807A7A0503C589EA9BBDBA5938D9DFA9218DDD15021FA7F3771` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `F6B59EFC09AC165D032BCDE15BDB6397813A84D2267C9139BDC09B88F02B023F` |

> 上表中的哈希必须保持无空格；录入时若发现空格，应以实际 `sha256sum` 输出为准重新核对。

## 5. 生产 preflight 与隔离 smoke

生产 preflight 通过，确认：

- `environment=production`；
- MySQL、Redis 和 schema 均为 `ok`，schema marker 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置为 `configured`；
- 报告目录/详情与支付仍为 `disabled`，没有借助配置通过把未完成业务伪装为已完成。

候选在 `10.0.0.3:18082` 完成隔离 smoke：health live、health ready、system ping 和未登录认证边界均通过；
随后清理临时进程和端口，没有留下 `18082` 残余监听。

## 6. 切换后只读复核

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/current -> releases/08c36a8` |
| 新 API unit | `hospital-platform-api-v2.service=active/running` |
| 新 API 启动时间 | `2026-08-19 14:42:49 CST` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，仍在监听 |
| 内网 live/ready/ping | `200` |
| 公网 `/api/v2/health/live` | `200` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均 `ok` |
| 公网未登录患者接口 | `401`，稳定错误码 `unauthorized` |
| 运行模式 | `NODE_ENV=production` |

因此可以确认新旧服务的运行层仍然共存，旧服务未被这次发布打断；不能据此宣称真实微信登录、患者同步、预约、
报告、费用、HIS 或真机验收已经完成。

## 7. `patInfosFind` 与二维码边界

旧端 `patInfosFind` 的 `data.patId` 是预约历史、报告和门诊费用共用的 HIS 临床档案引用；新端按字符串保存到
owner-scoped 的 `his-patient` 映射，不把它放进小程序响应。旧首页二维码实际读取的是 `medicalCardNo` 并请求
第三方图片服务，旧端注释中的“patId”与实际外发字段不一致，因此不能反推出医院扫码协议。

新端继续关闭二维码入口，直到医院确认扫码字段、签名、受众、短 TTL、防重放、撤销和扫码回执；支付、医保、HIS
写入和报告 Provider 也继续按 fail-closed 边界处理。

## 8. 下一步与回滚

下一步固定使用 `08c36a8` 服务端和 `4822884` 小程序候选，人工扫码后分层取得微信会话、患者目录同步、患者切换、
预约只读和门诊费用只读证据。真实业务失败时只回滚新 API 的 `current` 到 `65219e2` 并重启新 API，不能触碰旧 Python
服务；支付/医保仍放在最后专项验收。
