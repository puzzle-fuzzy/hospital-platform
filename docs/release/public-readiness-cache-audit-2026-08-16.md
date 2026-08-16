# 公网 readiness 与健康探针缓存复核（2026-08-16）

> 本文是只读复核证据，不代表候选代码已经切换生产，也不代表微信、众阳或真机业务已经验收。

## 1. 复核结论

本轮通过公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 观察到一次
`200 + not_ready(database/schema unavailable)`，随后再次请求连续返回：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}}
```

因此只能确认本轮存在一次瞬时的公网 readiness 差异，不能在没有 Nginx/网络层请求日志的情况下断言根因是缓存、上游切换或探针瞬时失败。后续发布判断必须保存完整响应头、`x-request-id` 和服务端对应日志。

### 18:20-18:21 CST 复测

通过 SSH 只读复核确认 `hospital-platform-api-v2.service=active`，生产 `current=55fce6c`，新 API
仍监听 `10.0.0.3:18081`，旧 Python 服务仍监听 `8001`；`sudo -n` 仍因需要密码而不可用，未执行
重启、切换或 Nginx reload。随后使用仓库当前 Smoke 访问公网 `/api/v2`：`system-ping` 返回 200，
但 `health-live` 和 `health-ready` 虽返回 200，仍因缺少 `Cache-Control: no-store` 被门禁拒绝。
这再次证明候选修复尚未形成线上证据，不能把公网 200 当作发布完成。

### 18:35 CST 更新后的公网 Smoke

使用当前仓库新增的认证边界检查访问公网 `/api/v2`：`system-ping` 和 `auth-boundary` 通过，后者的六个
合法输入保护路由均返回 HTTP 401；`health-live` 和 `health-ready` 仍因响应缺少
`Cache-Control: no-store` 被拒绝。因此当前公网已能证明基础路由和未登录保护边界，但仍不能通过发布
缓存门禁，也不能据此证明患者、provider 或真机业务已经迁移。

## 2. 当前服务边界

只读 SSH 复核得到：

- 新 API `hospital-platform-api-v2.service` 仍为 active，当前目录为生产 `current=55fce6c`。
- 新 API 监听 `10.0.0.3:18081`；直接访问 `127.0.0.1:18081` 被拒绝是预期的绑定地址差异，不应据此判断进程停止。
- 旧 Python 服务仍监听 `8001`；本轮没有重启、修改或切换旧服务。
- 新 API 内网 `10.0.0.3:18081/health/ready` 返回 database、Redis、schema 全部 `ok`。

## 3. 候选代码修复

候选代码已为 `/health/live` 和 `/health/ready` 设置 `Cache-Control: no-store`，并补充 API 测试，防止代理或 CDN 使用过期 readiness 结果。
Nginx 示例配置也在两个公网健康精确路由中隐藏上游 `Cache-Control` 并由边缘统一补充 `no-store`，避免重复或
错误的上游缓存指令造成歧义。
发布 runtime smoke 现在也会检查公网返回的两个健康接口是否保留该指令；即使 JSON 状态正确，响应头缺失也会阻止发布验收。

该修复尚未进入生产 `current=55fce6c`，所以公网响应是否带 `Cache-Control: no-store` 必须在取得窄权限 systemd 发布权限、完成候选切换后重新验收；当前不能把代码门禁写成线上证据。

## 4. 发布后验收步骤

1. 先在候选 release 的临时端口验证 `/health/live`、`/health/ready` 和 `Cache-Control: no-store`。
2. 在不停止旧 Python `8001` 的前提下切换新 API，保存切换前后 `current`、systemd 状态和端口监听证据。
3. 从公网连续请求 `/api/v2/health/ready`，保存 HTTP 状态、响应头、响应体和 `x-request-id`。
4. 用 `x-request-id` 在新 API 日志中确认请求落到新 release，随后再做微信开发者工具和真机只读业务验收。
