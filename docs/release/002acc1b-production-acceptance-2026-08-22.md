# `002acc1b` 生产候选验收记录（2026-08-22）

> 本记录只证明新 API 的发布链路、运行时依赖和 HTTP 边界正常，不把健康检查误报为微信、患者、预约、报告、门诊费用或支付业务成功。旧 Python 服务保持原样运行。

## 1. 发布范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10` |
| 发布前线上 release | `9f491cb5ac813acf89ed1f2f4afb361517e82324` |
| 小程序运行包来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff` |
| 新 API systemd unit | 仅重启 `hospital-platform-api-v2.service` |
| 旧 Python 服务 | 未修改、未停止、未重启；`8001` 持续监听 |
| Worker | `hospital-platform-worker-v2.service` 保持 `inactive` |
| 数据库/Redis | 未执行 migration、未清理、未写入业务数据 |
| 支付/医保/HIS | capability gate 保持关闭，未发起支付或医保请求 |

## 2. 发布前证据

### 2.1 本地门禁

最终提交执行 `pnpm check` 通过，包含架构、迁移台账、Provider 配置、文档断链、格式、Biome、工具、TypeScript、API 测试和 workspace 构建门禁：

- API 测试：`204 pass / 846 expects`；
- workspace 测试：`9/9`；
- 小程序构建：通过，14 个页面入口完整生成；
- 小程序运行包核验：`dist/services/single-flight.js` 存在，`single-flight.test.js` 不进入运行包；
- 文档审计：436 份文档，无断链；
- 服务器 release bundle：8 个必需脚本/入口均已上传并逐个 SHA-256 对齐本地构建产物。

### 2.2 真实 production env preflight

候选 release 使用服务器现有 `shared/api.env` 执行只读 preflight，结果为通过：

- runtime configuration：passed；
- 微信身份、众阳患者、预约目录、预约记录、门诊费用配置：configured；
- 微信支付、报告目录、报告详情：disabled（符合当前分阶段策略）；
- MySQL：`ok`；
- Redis：`ok`；
- schema：`verified`，版本为 `0016_patient_directory_sync_owner_index`。

该步骤没有执行 migration、Provider 业务请求、支付、医保或业务写入。

### 2.3 独立端口 runtime smoke

在 `127.0.0.1:18082` 以前台 SSH 会话启动候选，避免 SSH 断开时后台进程被回收；测试结束后发送 SIGINT，候选正常输出 `service.stopped`，`18082` 已释放。

内部候选结果：

| 检查 | 结果 |
| --- | --- |
| `/health/live` | `200` |
| `/health/ready` | 连续 `3/3` 为 `200` |
| `/api/v1/system/ping` | `200` |
| 未授权业务边界 | `401` |
| 关闭能力边界 | `404` |

启动日志同时确认 `environment=production`、`runtimeMode=production`、MySQL/Redis/schema 探针均为 `ok`，认证依赖状态为 `ready`。

## 3. 原子切换与切换后证据

2026-08-22 00:42 CST 左右，按 release runbook 在同一目录创建 `current.next`，再用 `mv -Tf` 原子替换 `current`：

```text
9f491cb5ac813acf89ed1f2f4afb361517e82324
        -> 002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10
```

随后仅重启 `hospital-platform-api-v2.service`，结果为 `active`。切换后确认：

- `current` 指向 `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`；
- `10.0.0.3:18081/health/ready` 返回 `database=ok`、`redis=ok`、`schema=ok`；
- `https://test-hp.meiyi.pro/api/v2/health/ready` 返回同样的 ready 结果；
- 新 API 使用新的 Bun PID 监听 `18081`；
- 旧 Gunicorn PID 集合仍为 `3687390、3687419、3687420、3687421、3687422`，`8001` 持续监听；
- `18082` 无残留监听；
- Worker 仍为 `inactive`。

## 4. 公网运行层烟囱测试

切换后从服务器通过真实公网入口 `https://test-hp.meiyi.pro/api/v2` 执行同一 runtime smoke：

- `health-live`：`200`；
- `health-ready`：连续 `3/3` 为 `200`；
- `system-ping`：`200`；
- 未授权认证边界：`401`；
- 关闭能力边界：`404`；
- smoke 进程退出码：`0`。

这证明反向代理已把新 `current` 的 API 正确转发到 `18081`，但不等于真实微信登录、就诊人切换、预约历史、报告或门诊费用业务已经完成验收。

## 5. 切换后低敏日志观察

切换后从 `2026-08-22 00:42 CST` 起读取新 API unit 的 journald JSON，并通过当前 release 的低敏聚合器处理：

- `parsedRecords=25`、`parseErrors=0`、`systemdWarningCount=0`；
- 事件只包含 `service.started`、`http.request.completed`、`http.request.failed`、`service.stop.requested` 和 `service.stopped`；
- `domainCounts` 只有 `infrastructure`，`providerRequestIdCount=0`；
- HTTP `200=7`、`401=8`、`404=7`，均与本次运行层 smoke 的健康、认证和关闭边界一致；
- 未出现微信登录、患者同步/切换、预约历史、爽约、报告、门诊费用或 Provider 业务事件。

因此当前服务端还没有收到可绑定到小程序真机候选的业务流量；该结果是“业务证据为空窗口”，不是业务失败，也不升级任何业务域验收等级。

## 6. 下一步与停止条件

下一步按业务风险顺序进行：

1. 小程序从当前源码重新普通编译，确认运行包来源为 `90fd783`，清除旧增量索引后再处理 `single-flight.test.js` 一类开发者工具缓存报错；
2. 用真机微信会话取得登录、就诊人列表、切换就诊人和首页二维码的请求/成功/页面证据；
3. 再取得预约目录、预约历史、报告目录/详情、门诊费用的只读业务证据，并核对低敏日志中的 requestId/traceId；
4. 支付、医保授权、退款和 HIS 写回继续最后专项，未取得真实协议和金额边界证据前不打开 gate。

任何出现新 API readiness 失败、公网路径异常、旧 `8001` 消失、Worker 意外启动或未解释业务错误，都必须按 release runbook 将 `current` 回滚到 `9f491cb5`，只重启新 API，不触碰旧服务。
