# v2 systemd 部署模板

这两个 unit 只管理重构后的 Bun 服务，不接管旧的 `Hospital-Backend` Python 进程。

部署目录约定：

```text
/home/ps/code/hospital-platform/current
/home/ps/code/hospital-platform/releases/<git-sha>
/home/ps/code/hospital-platform/shared/api.env
/home/ps/code/hospital-platform/shared/worker.env
```

环境文件必须通过受控 SSH 传输，权限设置为 `0600`，不能提交到 Git。

微信登录启用前，`api.env` 必须完成 `WECHAT_IDENTITY_READY`、AppID/AppSecret、MySQL、Redis 和 schema
的分阶段验收；详细步骤见 [`docs/wechat-auth-login.md`](../../docs/wechat-auth-login.md)。没有真实凭据时保持
fail-closed，不允许为了验证页面而写入假的 AppID、openid 或 token。

启动 API 前必须先验证：

```bash
sudo systemd-analyze verify /etc/systemd/system/hospital-platform-api-v2.service
sudo systemctl daemon-reload
sudo systemctl enable --now hospital-platform-api-v2.service
```

worker 只有在数据库、schema、支付凭证和加密密钥全部通过 fail-closed gate 后才允许启动：

```bash
sudo systemd-analyze verify /etc/systemd/system/hospital-platform-worker-v2.service
sudo systemctl enable --now hospital-platform-worker-v2.service
```

查看启动模式和健康日志：

```bash
journalctl -u hospital-platform-api-v2.service -n 100 --no-pager
journalctl -u hospital-platform-worker-v2.service -n 100 --no-pager
```

API 启动日志必须包含 `runtimeMode`、`authRuntimeStatus`、`authIdentityGateway`、`authSessionStore` 和
`persistenceSchemaProbe`；业务登录日志使用 `auth.wechat.login.*` 事件，禁止通过原始请求体排障。

生产 API 的 `REDIS_URL` 必须使用新服务专用 Redis 用户和独立 DB，不得复用旧 Python 服务的全权限账号。
当前生产已验证 `hospital_v2`/DB3，只允许 `PING`、`SELECT`、`GET`、`SET`，并由 ACL 强制限制到
`hospital:session:*`；新 API 代码中的 key 前缀只是第二道保护，不能替代 Redis ACL。`worker.env` 不得
因为 API 会话隔离完成而自动切换，worker 仍需单独通过支付、schema、lease、日志和回滚 gate。

2026-08-16 的生产只读快照见 [`docs/release/production-coexistence-readonly-audit-2026-08-16.md`](../../docs/release/production-coexistence-readonly-audit-2026-08-16.md)。
该快照先确认新旧服务共用 Redis DB1，随后记录了新 API 会话隔离和只重启新 API 的结果；新 worker 仍为
disabled/inactive，旧 Python 服务仍由手工进程运行，因此不能把新 API 的 active 或公网 health 200 解释为全量迁移完成。

候选 release 的原子切换、最小 sudoers 权限、切换后验收和只重启新 API 的回滚步骤见
[`api-v2-release-runbook.md`](api-v2-release-runbook.md)。目标服务器仍按该手册保护新 API 发布范围；当前
`current=84fac75c` 已完成候选 smoke、生产切换和公网验收。后续每次发布仍必须重新固定 commit、完成候选
smoke 和公网验收，不能复用旧 release 证据。当前切换证据见
[`../../docs/release/84fac75c-production-acceptance-2026-08-22.md`](../../docs/release/84fac75c-production-acceptance-2026-08-22.md)。
