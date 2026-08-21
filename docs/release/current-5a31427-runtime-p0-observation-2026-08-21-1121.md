# `5a31427` 运行层与 P0 业务窗口观察（2026-08-21 11:21 CST）

> 本记录只保存服务器运行状态和低敏日志聚合结果，不把健康检查、请求为空或 HTTP
> 状态码当作微信、患者、预约、门诊费用或真机业务完成证据。采集过程只读，没有重启
> 服务、修改配置、写 MySQL/Redis 或触碰旧 Python 项目。

## 1. 观察范围

| 项目 | 观察结果 |
| --- | --- |
| 新 API 当前 release | `/home/ps/code/hospital-platform/releases/5a31427` |
| `hospital-platform-api-v2.service` | `active` |
| `hospital-platform-worker.service` | `inactive`（当前按设计不启用） |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001`，与新 API 共存 |
| 小程序当前本地候选 | `c86a788`，完整来源 `c86a788c01760fd5a74ac8c2769871025297a4fc`，尚未上传线上 |

## 2. 最近 30 分钟日志聚合

服务器使用当前 release 自带的 P0 日志聚合器处理 `hospital-platform-api-v2.service`
的 journald JSON 输出，未读取或复制原始请求体、token、患者号码、身份证、金额或 Provider
响应正文。

| 指标 | 结果 |
| --- | ---: |
| 输入日志行 | 10 |
| 成功解析记录 | 9 |
| 解析错误 | 0 |
| 空白行 | 1 |
| `http.request.completed` | 2 |
| `http.request.failed` | 7 |
| HTTP 200 | 2 |
| HTTP 401 | 4 |
| HTTP 404 | 3 |
| Provider request id | 0 |
| `systemd` 警告 | 0 |
| 业务域事件 | 0（仅 `infrastructure`） |

### 结论

当前窗口只有公网运行层探针和鉴权/关闭边界探针，没有新的真机微信登录、患者目录、患者
同步、预约历史、预约排班或门诊费用请求。因此不能据此判断业务失败，也不能据此宣称
当前小程序候选已经完成真机验收；下一条有效证据必须来自使用 `c86a788` 重新构建包的
新二维码和同一时间窗口的页面、客户端 requestId、服务端低敏事件三层记录。

## 3. 下一步与停止条件

1. 关闭旧二维码和旧开发者工具增量缓存，使用 `apps/miniprogram/dist/` 重新普通编译并生成新二维码。
2. 真机扫码后先记录微信登录、`GET /me`、患者目录读取和同步，再验证显式切换患者、预约历史和门诊费用只读页。
3. 若真机操作后服务端仍只有 `infrastructure` 事件，应先检查开发者工具项目根、`miniprogramRoot`、公网 API 前缀和二维码来源，不通过猜测修改业务代码。
4. 预约写入、患者绑定、二维码、报告详情、支付、医保和 HIS 回写继续遵守各自 contract 缺口门禁。

## 4. 启动模式与依赖状态日志

通过 SSH 只读检索当前 API unit 的结构化 `service.started` 事件，最近一次记录为
`2026-08-21 03:54:12 CST`（原始日志时间为 UTC）。日志明确包含以下字段：

| 字段 | 结果 |
| --- | --- |
| `runtimeMode` | `production` |
| `host` / `port` | `10.0.0.3` / `18081` |
| `persistenceDatabaseProbe` | `ok` |
| `persistenceRedisProbe` | `ok` |
| `persistenceSchemaProbe` | `ok` |
| `persistenceRepositories` | `enabled` |
| `authRuntimeStatus` | `ready` |
| `authIdentityGateway` / `authSessionStore` | `injected` / `injected` |
| 微信身份 / 患者目录 / 预约目录 / 预约记录 / 门诊费用 | `configured` |
| 微信支付 / 报告目录 / 报告详情 | `disabled` |

因此，启动日志能够直接区分开发/生产模式、依赖 readiness 和业务 gate；后续真机请求
若没有进入 `auth.*` 或患者业务事件，应先检查候选二维码和公网请求路径，不把启动成功
误判为微信业务成功，也不因页面需要而打开支付或报告 gate。
