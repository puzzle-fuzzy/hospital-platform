# 当前 release P0 增量复核（2026-08-17 21:29 CST）

> 本文只记录当前 `bf67b96` release 的受控 SSH 和公网只读观察，不读取环境变量、密钥、Redis 原始 key、数据库患者正文或 Provider 原始报文，也不执行重启、切换、migration、业务写入、支付或医保操作。

## 1. 观察边界

| 项目 | 结果 |
| --- | --- |
| SSH 主机 | `192.168.112.172` |
| 当前 release | `/home/ps/code/hospital-platform/releases/bf67b9673708a6e5188880eba9a6d29b8e78f0c5` |
| 新 API | `10.0.0.3:18081`，systemd `active`，MainPID `2492096` |
| 旧 Python API | `0.0.0.0:8001`，仍在监听 |
| 当前 release 启动时间 | `2026-08-17 20:30:25 CST` |
| 观察截止 | `2026-08-17 21:29:41 CST` |

所有业务计数都从当前 API 的 `service.started` 之后开始统计，避免把切换前版本的请求归因给 `bf67b96`。

## 2. 公网运行边界

从服务器对公网入口 `https://test-hp.meiyi.pro/api/v2/health/ready` 发起一次未认证 GET：

| 项目 | 结果 |
| --- | --- |
| HTTP | `200` |
| `Cache-Control` | `no-store` |
| `database` | `ok` |
| `redis` | `ok` |
| `schema` | `ok` |
| `x-request-id` | 已返回，未在本文重复保存完整值 |

这只证明公网运行时和依赖探针正常，不能证明微信会话、患者切换、Provider 字段或任何页面业务已经验收。

## 3. 当前 release 日志聚合

服务器直接使用当前 release 自带的 `apps/worker/dist/p0-log-aggregate.js` 读取 journald JSONL，未输出原始日志：

```text
inputLines=163
parsedRecords=157
parseErrors=0
ignoredBlankLines=1
ignoredControlLines=5
traceIdCount=89
providerRequestIdCount=10
httpStatusCounts={"200":70,"401":19}
```

主要事件计数：

| 事件 | 次数 | 解释 |
| --- | ---: | --- |
| `service.started` | 1 | 当前 API 以 `bf67b96` 启动 |
| `auth.wechat.login.requested/succeeded` | 1/1 | 当前 release 有一次真实微信登录业务事件 |
| `patient.directory.requested` | 9 | 进入患者同步请求 |
| `patient.directory.operation.started` | 9 | 同步操作取得租约并开始执行 |
| `patient.directory.synced` | 9 | 当前窗口出现 9 次患者目录同步成功链 |
| `patient.directory.read.requested/read.loaded` | 18/18 | 患者读模型读取和成功加载各 18 次 |
| `http.request.completed/failed` | 70/19 | 失败计数对应 `401 unauthorized`，不是 Provider 业务失败 |
| `appointment.*` | 0 | 没有预约目录、排班或预约历史业务事件 |
| `outpatient.payment.*` | 0 | 没有门诊费用业务事件 |
| `report.*` | 0 | 没有报告目录或详情业务事件 |
| `user.profile.*` | 0 | 没有普通资料业务事件 |

`parseErrors=0` 只证明日志输入可解析；它不证明业务字段、患者数量、金额、Provider 状态或页面展示正确。当前日志聚合不包含 token、openid、完整患者身份、Provider 患者号或原始 Provider 报文。

## 4. 结论与下一步

本轮可以确认：

1. 新 API `18081` 和旧 Python `8001` 继续共存，没有因观察动作停止旧服务。
2. 当前 release 处于 production 运行模式，公网 ready 的 MySQL、Redis、schema 探针均为 `ok`。
3. 当前 release 的微信登录、患者同步、患者读模型和低敏日志链路存在真实运行证据。

本轮不能确认：

1. “我的挂号”、爽约记录、门诊待缴/已缴费用和报告页面是否完成 Provider 查询；
2. 多患者切换、失效/恢复、Redis TTL 和跨页面患者上下文隔离；
3. 页面字段、状态、金额与服务端响应是否在真机上完全一致。

因此下一步必须使用由当前源码构建的 `apps/miniprogram/dist/`，在有效微信会话中按“患者选择 → 我的挂号 → 爽约记录 → 门诊待缴费/已缴费 → 报告目录”的顺序主动操作，再交叉核对页面、HTTP 和低敏日志。没有对应事件前，不修改 Provider 映射、不打开预约写入、支付、医保或 HIS 回写。

详细操作和停止条件见 [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](p0-readonly-business-acceptance-runbook-2026-08-17.md)。
