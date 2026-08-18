# `4cf9e66` 生产共存与候选验收记录

> 验收时间：2026-08-18 09:16-09:20 CST
>
> 目标：在不停止旧 Python 服务的前提下，将当前 Bun/Elysia API 切换到 `4cf9e66`，并固定可追溯的运行证据。
>
> 结论：运行层切换成功；真实微信业务、患者切换、预约历史、爽约记录和门诊费用仍未完成三层业务验收。

## 1. 切换范围与服务边界

- 本次 release/commit：`4cf9e66`，对应远程 `origin/main` 的已推送提交。
- 服务器当前 release：`/home/ps/code/hospital-platform/releases/4cf9e66`。
- 切换前 release：`/home/ps/code/hospital-platform/releases/0995f7c`。
- 新 Bun/Elysia API：systemd 单元 `hospital-platform-api-v2.service`，监听 `10.0.0.3:18081`。
- 旧 Python/Gunicorn API：继续监听 `0.0.0.0:8001`，本次未停止、未覆盖、未修改其进程。
- Worker：本次没有启动，避免在只读业务尚未取得真实证据前触发后台同步或写入任务。
- 数据库迁移：本次没有执行迁移；生产 schema 已通过现有 marker 检查，预期 marker 为
  `0016_patient_directory_sync_owner_index`。

## 2. 产物完整性

候选压缩包在本地与服务器之间传输后 SHA-256 一致：

`43df43f66ad86d2c87919663a543151552479af06d74da838e4c0bec8772f906`

服务器 release 目录中的 7 个产物与本地构建产物逐一比对一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `bd648844022eab84b536d2c4715b934e0a345c47dc304c6622884a8c2fc39584` |
| `apps/worker/dist/index.js` | `88dc3fb7a9292cdf3e7c9c7765857d4aba14f3045c78351e0387daab17c6188d` |
| `apps/worker/dist/preflight.js` | `e753b44d10ffd394354b2e4d6ff948794996d04e6157f36fed32165ae9377279` |
| `apps/worker/dist/provider-directory-smoke.js` | `e2a5fdc85d59b2bfb6e8ec99d3480bf27f7f33d84f324c8bb0b2d83810d90046` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `6405b1e971969bd524754372169a94d3d13b62b9c61e031fef4517590ff71a07` |

## 3. 切换前验收

### 3.1 生产环境预检

使用服务器既有生产环境变量执行候选 release preflight，结果为通过：

- 环境：`production`。
- MySQL：`ok`。
- Redis：`ok`。
- schema：`verified`，marker 为 `0016_patient_directory_sync_owner_index`。
- 微信身份配置：`configured`。
- 众阳患者目录、预约目录、预约记录、门诊费用：`configured`。
- 微信支付：`disabled`。
- 众阳报告目录、报告详情：`disabled`。

环境变量的值未写入日志或本文档；只记录配置状态，避免泄露 `WECHAT_APP_SECRET`、数据库密码和 Redis 凭据。

### 3.2 隔离运行时验收

候选 release 在不占用生产端口的临时进程中以 `NODE_ENV=production`、`127.0.0.1:18082` 启动，runtime smoke 通过：

- `/health/live`：HTTP 200。
- `/health/ready`：连续 3 次 HTTP 200，database/redis/schema 均为 `ok`。
- `/system/ping`：HTTP 200。
- 未登录业务边界：HTTP 401，说明鉴权边界仍然生效。
- 临时进程收到 SIGTERM 后正常退出，`18082` 已释放。

这一步只证明候选包能以生产配置启动并正确拒绝未授权请求，不代表真实微信会话或 Provider 业务已验收。

## 4. 原子切换与旧服务共存

切换使用新的 `current.next` 符号链接，再原子替换 `current`，随后只执行：

```text
systemctl restart hospital-platform-api-v2.service
```

切换后确认：

- `current -> releases/4cf9e66`。
- 新 Bun API 进程 active，仍监听 `10.0.0.3:18081`。
- 旧 Python 进程 PID 未改变，`0.0.0.0:8001` 仍在监听。
- 新服务启动时间为 2026-08-18 09:18:01 CST。
- 启动日志明确记录 `environment=production`、`runtimeMode=production`。
- 启动时 database/redis/schema probe 均为 `ok`，`authRuntimeStatus=ready`。
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置状态为 `configured`；支付和报告保持关闭。

## 5. 切换后健康检查

切换后从服务器内网地址访问：

- `/health/live`：HTTP 200，`success=true`、`status=ok`、`service=hospital-api`。
- `/health/ready`：HTTP 200，`success=true`、`status=ready`，database/redis/schema 均为 `ok`。
- 健康接口带 `Cache-Control: no-store`，避免代理缓存健康状态。
- journald 已出现对应的 `health.live`、`health.ready` 请求事件，且没有因本次切换停止旧 Python 服务的证据。

本节只确认新服务和基础依赖当前可用。阿里云转发/公网域名在本次切换后尚未以真实微信请求重新取得完整证据，因此不能把内网 readiness 等同于公网和真机验收。

## 6. 尚未接受的业务范围

以下项目仍明确保持“未验收”或“关闭”：

1. 有效微信 `code` 登录、Redis session TTL 和真机页面登录链路的当前 release 三层证据。
2. 就诊人刷新、owner 归属、多就诊人显式切换，以及切换后页面重新读取数据。
3. 我的挂号、爽约记录的真实 Provider 响应、公网请求和真机展示。
4. 门诊待缴/已缴的真实 Provider 响应、公网请求和真机展示。
5. 预约写入、预约取消、报告详情、费用详情等尚未完成证据闭环的接口。
6. 微信支付、医保授权、医保支付、结算回写、退款和 HIS 写入。

这些范围没有因为服务已启动、健康检查通过或历史日志存在而提前标记完成。

## 7. 下一步取证顺序

使用与 `4cf9e66` 匹配的小程序运行包，在有效微信会话中按以下顺序操作，每一步同时保留页面结果、HTTP 请求/响应摘要和低敏 journald trace：

```text
微信登录
  -> 刷新就诊人
  -> 显式切换到另一就诊人并返回首页
  -> 我的挂号
  -> 爽约记录
  -> 门诊待缴/已缴只读查询
  -> 再评估报告目录/详情
```

任一步出现 `unauthorized`、`persistence-temporarily-unavailable`、`external service rejected` 或字段不符合旧端语义，先暂停该业务迁移，定位真实 Provider 响应和 owner/session 边界，不通过兼容性兜底伪造成功结果。支付、医保和 HIS 写入继续放在只读业务稳定且证据完整之后。
