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
