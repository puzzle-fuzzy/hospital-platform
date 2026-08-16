# 查询错误契约候选版本隔离 Smoke

日期：2026-08-16  
候选 commit：`3a37e7e`  统一查询错误契约文案  
目标：验证预约排班、预约记录、报告查询的稳定中文错误契约不会因真实生产环境启动而失效，同时确认候选版本不会影响旧服务和当前新 API。

## 1. 本地门禁

候选版本通过以下门禁：

- 架构边界审计：19/19；
- Biome format/lint：通过；
- 9 个 workspace 类型检查：通过；
- 9 个 workspace 测试任务：通过；
- 9 个 workspace 构建任务：通过；
- API 测试：60/60；
- 原生小程序验收测试：37/37。

本次关键回归覆盖 `appointment-query-invalid`、`appointment-record-query-invalid` 和
`report-query-invalid`。服务端不会再把日期范围上限等内部英文校验细节作为公共 `message` 返回；
小程序也按错误码保留中文兜底文案。

## 2. 服务器隔离验证

服务器：`192.168.112.172`  
候选 release：`/home/ps/code/hospital-platform/releases/3a37e7e`  
候选端口：`10.0.0.3:18082`  
生产 env：使用服务器已有的 `shared/api.env`，未复制、打印或写入仓库。

上传后的 API bundle SHA-256：

```text
96112c3e500538c63bc84a9c0c4b042f7d0ccb577f2ad9e4e75a20ecefa4d506
```

### 启动日志证据

候选进程由 Bun 在临时端口启动，启动日志确认：

- `environment=production`；
- `runtimeMode=production`；
- `persistenceDatabaseProbe=ok`；
- `persistenceRedisProbe=ok`；
- `persistenceSchemaProbe=ok`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置状态符合当前 gate；
- 微信支付、报告目录和报告详情仍保持 `disabled`。

### HTTP 与日志证据

- `GET http://10.0.0.3:18082/health/ready`：HTTP 200，返回 database/redis/schema 均为 `ok`；
- 未携带会话访问 `GET /api/v1/me`：HTTP 401，返回 `unauthorized` 和中文安全文案；
- Pino 请求日志包含 `requestId`、`traceId`、HTTP 方法、路径、状态码和耗时；
- 日志没有输出 Authorization、openid、session_key 或 provider 原始报文。

## 3. 共存与清理证据

隔离验证期间及结束后确认：

- 新 API 原生产端口 `18081` 仍监听；
- 旧 Python 服务端口 `8001` 仍监听；
- `current` 仍指向 `/home/ps/code/hospital-platform/releases/55fce6c`；
- 临时端口 `18082` 已释放；
- 候选日志和临时健康检查文件已清理；
- 未执行 `systemctl restart`，未切换公网 `current`，未重启旧服务。

## 4. 验收结论与未完成项

本候选已通过“本地代码门禁 + 生产 env 隔离进程 smoke”，可以作为后续窄权限切换的候选版本。
这不等于已经完成公网切换、微信真机登录、众阳真实业务只读、支付或医保验收。

当前服务器 `sudo -n -l` 仍需要密码，尚未取得手册要求的窄权限 systemd 能力。因此下一步仍必须由管理员
按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 配置最小授权，随后才能在不触碰旧
Python 服务的前提下切换新 API，并按 ready、公网、旧端口、真机业务的顺序验收。
