# 候选 `6db3217b` 生产前隔离验收（2026-08-24）

> 本记录只证明候选 release 已完成上传、真实生产配置 preflight 和隔离端口运行时 smoke；不代表已经切换线上 `current`，也不代表真实微信、患者、预约或费用业务验收完成。

## 候选来源

- Git 提交：`6db3217bd3c990b009571ffd85b7da55d9ea7338`
- 上一份运行时代码候选：`709b9ea0`；`709b9ea0..6db3217b` 之间只有文档变更，本次重新构建仍以完整提交固定发布来源。
- 构建命令：`pnpm build`
- 构建结果：Turbo 9/9 成功；API 和 Worker bundle 均重新生成，小程序运行包继续通过构建脚本发布。

## 本地门禁

- `pnpm typecheck`：9/9 成功。
- `pnpm lint`：Biome 检查 270 个文件通过。
- `pnpm format:check`：Biome 检查 269 个文件通过。
- `pnpm test`：API `210 pass / 1 fail / 869 expect()`；唯一失败是 `P0 acceptance documents share the current release baseline`。
- 上述唯一失败是预期的发布基线保护：服务器当前仍为旧 release `0e2a366e`，本候选中的 `request-authentication.ts` 尚未部署；未修改测试绕过该保护。

## 上传与 checksum

候选已上传到服务器：

```text
/home/ps/code/hospital-platform/releases/6db3217bd3c990b009571ffd85b7da55d9ea7338
```

远端 checksum 与本地产物一致：

```text
531a76823e93ddd57a8ef3b86651075df39b5f63ca84757780730ac2c1e07c90  apps/api/dist/index.js
a878a89f927ceb3f6994fa1ee305db6d0074aed296db06672a97d2aef69db368  apps/worker/dist/index.js
44bb4332b6db1a6f596f36a03c6431a6928bb08de8607c1a87ebcb3656085447  apps/worker/dist/preflight.js
1138c0f9fa06d398ef463954cf9fd8836e873e892ca54094cd146dc27570f28a  apps/worker/dist/provider-directory-smoke.js
82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295  apps/worker/dist/api-runtime-smoke.js
bacb3293d4f229299ddf035e89e010dc3dd3af2b9b592e477e91b58f88fb78ff  apps/worker/dist/redis-session-ttl-audit.js
280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746  apps/worker/dist/p0-log-aggregate.js
afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e  apps/worker/dist/p0-business-evidence-audit.js
```

## 真实生产 env preflight

使用服务器已有的 `shared/api.env`，未回显任何密钥、数据库 URL、Redis URL 或 Provider 原始响应。候选 preflight 通过：

- `runtime-configuration`：passed
- `wechat-identity`：configured
- 患者目录、预约目录、预约记录、门诊费用：configured
- 微信支付：disabled
- 报告目录、报告详情：disabled
- MySQL：`ok`
- Redis：`ok`
- schema：`verified`，当前期望 `0016_patient_directory_sync_owner_index`

## 隔离端口 smoke

候选 bundle 曾在 `127.0.0.1:18082` 以 `environment=production` 启动，使用相同的生产 env；运行时检查全部通过：

- `/health/live`：`200`
- `/health/ready`：连续 `3/3` 为 `200`
- `/api/v1/system/ping`：`200`
- 未登录认证边界：`401`
- 关闭能力边界：`404`
- 临时实例收到 `SIGTERM` 后正常退出，并记录 `service.stop.requested` / `service.stopped`。

## 无损边界

验收结束后：

- `current` 仍指向 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`。
- 新 API `10.0.0.3:18081` 仍在监听。
- 旧 Python Gunicorn `0.0.0.0:8001` 仍在监听，主进程及 4 个 worker PID 未变化。
- 临时端口 `18082` 已释放。
- 未执行数据库 migration、支付、医保、退款、HIS 写回或 Worker 启动。

## 当前阻塞

服务器当前 `ps` 会话执行以下只读检查时仍要求密码：

```bash
sudo -n systemctl is-active hospital-platform-api-v2.service
```

因此本轮没有切换 `current`，也没有重启任何 systemd 服务。必须先由服务器管理员恢复并验证仓库既有的窄权限 sudoers 规则，或者由管理员在 Xshell 中人工执行“只切换新 API 并只重启 `hospital-platform-api-v2.service`”的命令。旧 Python 服务不需要重启，也不应授予新 API 发布流程停止或重启旧服务的权限。
