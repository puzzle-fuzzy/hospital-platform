# 新 API 候选版本无损切换手册

本文只负责切换 `hospital-platform-api-v2.service` 使用的 `current` release，
不管理旧 Python 服务、不修改旧端口 `8001`、不执行数据库 migration，也不启动支付/医保/HIS worker。

## 1. 一次性配置窄权限

`current`、`releases` 和 `shared` 目录由 `ps` 自己管理，因此不需要为文件上传和软链接切换授予 root 权限。
管理员只需要使用 `visudo` 安装下面的最小 sudoers 规则：

```sudoers
Cmnd_Alias HOSPITAL_API_V2_RELEASE = \
    /usr/bin/systemctl restart hospital-platform-api-v2.service, \
    /usr/bin/systemctl is-active hospital-platform-api-v2.service, \
    /usr/bin/systemctl status hospital-platform-api-v2.service

ps ALL=(root) NOPASSWD: HOSPITAL_API_V2_RELEASE
```

安装后由管理员执行：

```bash
visudo -cf /etc/sudoers.d/hospital-platform-api-v2
chmod 0440 /etc/sudoers.d/hospital-platform-api-v2
```

不要授予 `systemctl *`、任意命令执行、旧 Python unit 的 stop/restart 权限，也不要把环境文件内容放入
sudoers、仓库、聊天记录或日志。当前主机尚未安装这条规则，`sudo -n -l` 仍会要求密码，因此不能把本手册
视为已完成授权。

## 2. 切换前检查

以下命令由 `ps` 执行。`<sha>` 必须是已经通过本地 `pnpm check` 和独立生产 env smoke 的候选 commit，
`<old-sha>` 必须从切换前的 `readlink -f current` 读取，不能手写猜测。

```bash
cd /home/ps/code/hospital-platform
old_sha="$(readlink -f current | sed 's#.*/##')"
new_sha="<sha>"
test -f "releases/${new_sha}/apps/api/dist/index.js"
test -f shared/api.env
test "$(stat -c '%a' shared/api.env)" = 600
```

切换前必须保存以下证据：

- `current` 指向的旧 release；
- 新旧 API 是否已经分别监听 `18081` 和 `8001`；
- 当前公网 `/api/v2/health/ready` 响应；
- 旧 Python 进程仍由原启动方式运行；
- 候选 release 的本地 `pnpm check`、临时端口 smoke 和日志文件。

## 3. 原子切换与新 API 重启

`current.next` 与 `current` 必须位于同一个文件系统；先创建临时软链接，再使用同目录 `mv -T` 替换，
避免 systemd 看到一个不存在或指向半成品的工作目录。

```bash
ln -s "releases/${new_sha}" current.next
mv -Tf current.next current
sudo -n systemctl restart hospital-platform-api-v2.service
```

这里只允许重启新 API unit。旧 Python 服务不需要也不允许重启；API unit 的 `WorkingDirectory` 会在新请求
到达前读取新的 `current`。

## 4. 切换后验收

```bash
sudo -n systemctl is-active hospital-platform-api-v2.service
readlink -f current
ss -ltnp | grep -E ':18081|:8001'
curl -fsS http://10.0.0.3:18081/health/ready
curl -fsS https://test-hp.meiyi.pro/api/v2/health/ready
```

启动日志必须确认 `environment=production`、`runtimeMode=production`、数据库/Redis/schema 探针均为 `ok`，
并核对 capability gate 没有被意外打开。随后按“真实微信登录 → 患者切换 → 预约只读 → 报告/门诊费用”的
顺序验收；支付、医保、HIS 和 worker 继续保持关闭。

## 5. 失败回滚

只要新 API 未 ready、公网路径异常、旧 `8001` 消失或出现未解释的业务错误，就立即把 `current` 指回
`<old-sha>` 并只重启新 API：

```bash
cd /home/ps/code/hospital-platform
ln -s "releases/${old_sha}" current.next
mv -Tf current.next current
sudo -n systemctl restart hospital-platform-api-v2.service
```

回滚后必须再次确认 `18081`、公网 `/api/v2/health/ready` 和旧 `8001`，并保留切换前后 requestId、日志和
版本指向。禁止使用 `rm -rf`、`FLUSHDB`、`FLUSHALL` 或删除旧 release 的方式“清理现场”。

## 6. 当前状态

2026-08-16：前一候选 `3a37e7e` 已在生产 env 和临时 `18082` 完成隔离 smoke，生产 `current` 仍为
`55fce6c`，`18081` 和旧 `8001` 均保持运行，候选端口已释放。仓库当前 `main=07dedcc`，其中包含
已通过代码门禁的候选实现、正确的公网 `/api/v2` Smoke 路径、门诊费用双状态只读验收和最新审计文档；
`07dedcc` 尚未在生产临时
端口重新 smoke，也未执行公网切换。该提交不改变 API 业务路由，但发布前仍需按本手册固定并验证完整 release。
由于窄权限尚未配置，尚不能执行本手册的公网切换步骤。前一候选证据见
[`query-error-contract-smoke-2026-08-16.md`](../../docs/release/query-error-contract-smoke-2026-08-16.md)。
