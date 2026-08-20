# 当前运行层只读观察（2026-08-20 12:27 CST）

> 本记录只描述一次线上运行层和日志的只读观察，不代表微信真机、Provider、预约、门诊费用、报告、支付或医保业务验收完成。
> 本次没有修改旧 Python 项目、数据库、Redis、Nginx 配置，也没有重启任何服务。

## 观察范围

- 服务器：`192.168.112.172`
- 观察时间：`2026-08-20 12:27:43 CST`
- 访问方式：SSH 只读命令与公网 HTTPS 只读探针
- 旧项目：`Hospital-Backend`，只核对监听状态，不读取或改写业务数据
- 新项目：`hospital-platform`，只核对已部署服务状态，不进行业务写入

## 运行状态

| 检查项 | 结果 | 解释 |
| --- | --- | --- |
| `hospital-platform-api-v2.service` | `active` | 新 Bun/Elysia API 仍在运行 |
| `hospital-platform-worker-v2.service` | `inactive` | Worker 未启动，符合当前支付/补偿任务保持关闭的边界 |
| 新 API 监听 | `10.0.0.3:18081` | 新服务独立监听，不占用旧服务端口 |
| 旧 Python API 监听 | `0.0.0.0:8001` | 旧服务仍在运行，没有被新服务替换或停止 |
| 公网 `/api/v2/health/ready` | HTTP `200` | `database=ok`、`redis=ok`、`schema=ok` |
| 公网缓存策略 | `Cache-Control: no-store` | readiness 响应不会被中间缓存伪造 |

本次公网 readiness 的关联请求标识为：
`6f15109a-738e-4ca7-8c81-7291e975a2d2`。

## 业务日志观察

使用 `journalctl -u hospital-platform-api-v2.service --since '-30 min'` 只读取最近窗口，未发现新的：

- `auth.wechat.*`
- `patient.directory.*`
- `appointment.*`
- `outpatient.payment.*`
- `report.*`

“最近窗口没有业务事件”只能说明观察期间没有可见的业务请求，不能推导对应能力故障，也不能用历史窗口的事件数量替代当前 release 的真机验收。下一次验收必须在同一候选版本上由真实页面操作产生请求，并同时保存页面结果、HTTP `requestId/traceId` 和低敏业务日志。

## 与旧服务的边界结论

本次没有触碰旧服务的代码、环境变量、日志配置、进程或端口。旧 Python `8001` 继续监听，说明新服务的运行状态没有覆盖旧服务。涉及医保 6201/6202 的问题仍应先区分：

1. 真正的 `POST` 是否由旧小程序发出；
2. 请求是否到达旧 Python `8001`；
3. 业务流程是否在授权、人员信息或待结算明细阶段提前结束；
4. 当前观察的日志文件是否为 active 文件，而不是尚未生成的当日轮转文件。

禁止通过恢复完整医保请求体日志来“补证据”，因为其中可能包含身份证、卡号、授权凭证和患者姓名。应使用现有的 trace、状态码、固定错误类型和脱敏业务事件完成关联。

## 本地候选验证

本次同步完成了新项目的只读门禁核对：

- `pnpm typecheck`：9 个 workspace 全部通过；
- `pnpm test`：9 个 workspace 全部通过，API 当前测试 182 项通过；
- `pnpm architecture:audit`：66 条架构边界通过；
- `pnpm migration:audit`：14 个原生页面与 64 个旧页面台账通过；
- `pnpm provider:audit`：3 份接收记录、26 个文档标识通过；
- `pnpm docs:audit`：247 个文档无断链。

本地工作树中的 `apps/miniprogram/project.config.json` 修改和 `.codegraph/` 未被本次观察触碰、暂存或提交。

## 下一步准入顺序

1. 固定同一服务端 release 与小程序候选来源；
2. 在新小程序真机重新建立有效设备会话；
3. 先完成登录、患者同步、显式切换患者的页面/HTTP/日志三层证据；
4. 再逐一验证预约历史与门诊费用只读链路；
5. 在 Provider 文档、字段白名单、错误状态和真机证据齐全前，不开放二维码、患者绑定、预约写入、支付、医保或 HIS 回写。
