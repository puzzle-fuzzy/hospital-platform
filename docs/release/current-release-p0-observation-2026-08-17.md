# 当前 release P0 只读增量观察（2026-08-17 20:51 CST）

> 本文只记录本次通过受控 SSH 和公网入口完成的只读观察，不读取环境变量、密钥、Redis 原始 key、数据库患者正文或 Provider 原始报文，也不执行重启、切换、migration、业务写入、支付或医保操作。

## 1. 观察边界

| 项目 | 结果 |
| --- | --- |
| SSH 主机 | `192.168.112.172` |
| 当前 release | `/home/ps/code/hospital-platform/releases/bf67b9673708a6e5188880eba9a6d29b8e78f0c5` |
| 服务启动时间 | `2026-08-17 20:30:25 CST` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001`，仍在监听 |
| 观察截止 | `2026-08-17 20:51:46 CST` |

本次只读取当前 release 的低敏 journald 聚合结果。时间窗口从当前服务启动时间附近开始，避免把切换前 release
的业务日志归因给 `bf67b96`。

## 2. 公网运行边界

从工作区对公网入口 `https://test-hp.meiyi.pro/api/v2` 发起三次无认证 GET：

| 路径 | HTTP | `Cache-Control` | `x-request-id` |
| --- | ---: | --- | --- |
| `/health/live` | 200 | `no-store` | 存在 |
| `/health/ready` | 200 | `no-store` | 存在 |
| `/system/ping` | 200 | 未返回 | 存在 |

这只证明当前公网路由、响应头和运行探针正常；不能推出微信会话、患者切换、Provider 字段或页面展示已经验收。

## 3. 当前 release 低敏日志聚合

服务器使用当前 release 自带的 `apps/worker/dist/p0-log-aggregate.js` 处理 journald JSONL，结果如下：

```text
inputLines=74
parsedRecords=68
parseErrors=0
ignoredBlankLines=1
ignoredControlLines=5
traceIdCount=44
providerRequestIdCount=3
```

主要事件计数：

| 事件 | 次数 | 解释 |
| --- | ---: | --- |
| `service.started` | 1 | 当前 API 以当前 release 启动 |
| `patient.directory.requested` | 3 | 进入患者同步请求 |
| `patient.directory.operation.started` | 3 | 同步操作取得租约并开始执行 |
| `patient.directory.synced` | 3 | 当前窗口出现 3 次患者目录同步成功链 |
| `patient.directory.read.requested/read.loaded` | 6/6 | 患者读模型读取请求和成功加载各 6 次 |
| `http.request.completed` | 32 | 包含运行探针及业务 HTTP 成功请求 |
| `http.request.failed` | 12 | 当前窗口均为 `401 unauthorized` |
| `appointment.records.*` | 0 | 没有新的预约历史业务事件 |
| `outpatient.payment.*` | 0 | 没有新的门诊费用业务事件 |
| `auth.wechat.*` | 0 | 当前窗口没有新的微信登录业务事件 |

`parseErrors=0` 只证明聚合输入可解析，不证明业务数据正确。`patientCount`、患者身份、金额、provider 患者号和
原始 Provider 响应均没有带出 SSH 会话。

## 4. 结论

本轮可以确认：

1. 新旧服务继续共存，旧 Python `8001` 未被停止或切换。
2. 当前 `bf67b96` 的 production 服务正常运行，公网 `live/ready/system-ping` 和 `no-store` 运行边界通过。
3. 当前 release 的患者同步和读模型日志链路可聚合、无解析错误。

本轮不能确认：

1. Redis 会话实际 TTL、过期后的重新登录和 401 恢复；
2. 第二位患者、多患者切换、inactive/recovery 和跨页面患者隔离；
3. “我的挂号”、爽约记录、门诊待缴/已缴费用的页面字段、Provider 状态和金额；
4. 普通资料首次 PUT、409 冲突、真机视觉和真机网络；
5. 报告 Provider、病历、绑定、新增就诊人、二维码、预约写入、微信支付、医保、退款和 HIS 回写。

尤其是本次没有出现 `appointment.records.*` 和 `outpatient.payment.*`，所以不能把这两个域标记为“线上已验收”；
后续必须由最新小程序运行包在有效微信会话中主动触发，再以页面、HTTP 和低敏日志三层结果交叉核对。

## 5. 下一步操作门禁

请使用已经执行 `pnpm --filter @hospital/miniprogram build` 的 `apps/miniprogram` 目录，在微信开发者工具或真机中按以下顺序操作：

1. 登录并进入“选择就诊人”，点击一次“刷新就诊人”；
2. 进入“我的挂号”，记录页面是否加载，以及当前请求的 request id；
3. 返回首页/我的，进入“门诊缴费”，依次点击“待缴费”和“已缴费”；
4. 只记录页面状态、HTTP 状态、request id、traceId 和 Provider request id 数量，不记录 token、openid、完整证件号、
   provider 患者号或金额与身份的可关联组合；
5. 如果出现 `persistence-temporarily-unavailable`、患者上下文错配、未知状态或错误金额，立即停止该业务域，不重试
   支付或修改 Provider 配置。

只有用户操作产生当前 release 的对应业务事件后，才能继续做预约历史/门诊费用的字段级验收；在这之前不新增预约写入、
支付、医保或 HIS 代码。
