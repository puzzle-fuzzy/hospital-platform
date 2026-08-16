# 候选 `a8174f1` 生产环境临时端口 Smoke（2026-08-16）

> 本文只记录候选 release 的隔离运行证据，不代表已经切换生产，也不代表患者、provider、微信真机或支付业务已经验收。

## 1. 候选与构建方式

- 候选 commit：`a8174f1`，从公开仓库 `origin/main` 获取；
- 候选目录：`/home/ps/code/hospital-platform/releases/a8174f1`；
- 当前生产目录：验证期间始终为 `/home/ps/code/hospital-platform/releases/55fce6c`；
- API bundle：本地 `pnpm check` 生成后上传，服务器文件大小 `3,067,076` 字节，SHA-256 为
  `cc8159314a67e168686ae168ae3eb48ceb16bc9657d2b1fe1ed4956acb608b2d`；
- Worker bundle：本地构建后上传，服务器文件大小 `2,012,554` 字节，SHA-256 为
  `e7c0ccf9213188757d66bc4189ef959c0ec1f90320cd464eaa79998fb2742e62`。

服务器现有生产 release 的 `node_modules` 不包含 workspace `@hospital/*` 开发链接，直接在候选源码目录
执行 `bun build` 会失败。因此生产候选必须使用本地已通过代码门禁的 bundle，并在上传后校验 checksum；
不能把“服务器源码能否临时编译”当作发布流程的一部分，也不能在服务器上临时修改依赖来绕过这个边界。

## 2. 临时端口证据

使用服务器已有 `shared/api.env` 作为进程环境，只覆盖 `PORT=18082`；没有复制、打印或修改共享 env，
没有执行 migration，没有启动 worker，也没有访问真实患者、预约、报告或支付 provider。

候选进程启动日志确认：

- `runtimeMode=production`；
- `host=10.0.0.3`、`port=18082`；
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`；
- `persistenceRepositories=enabled`、`authRuntimeStatus=ready`；
- 患者目录、预约目录、预约记录和门诊费用为 `configured`；
- 微信支付为 `disabled`，报告目录和报告详情为 `disabled`。

| 请求 | 结果 | 关键证据 |
| --- | --- | --- |
| `GET http://10.0.0.3:18082/health/live` | HTTP 200 | body 为 `status=ok`，响应含 `Cache-Control: no-store` |
| `GET http://10.0.0.3:18082/health/ready` | HTTP 200 | body 为 `status=ready`，database/redis/schema 均为 `ok`，响应含 `Cache-Control: no-store` |

进程收到清理信号后，`18082` 已确认关闭；同时复核 `current` 仍为 `55fce6c`，新 API `18081` 和旧
Python `8001` 仍在监听。该过程没有重启 systemd、切换软链接、修改 Nginx 或影响旧服务。

## 3. 下一步门禁

1. 由管理员安装 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 中的窄权限
   systemd sudoers；
2. 在实际 Nginx 配置中应用健康探针 `no-store` 规则并执行 `nginx -t`；
3. 保存切换前 `current`、端口、旧服务和公网响应证据后，才允许原子切换新 API；
4. 切换后重新验证公网 `/api/v2`，再使用受控微信会话完成患者同步、就诊人切换、预约历史、报告和门诊
   费用只读验收；支付、医保、HIS 和写入路由继续关闭。

