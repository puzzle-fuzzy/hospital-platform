# SSH 恢复与新 API 发布门禁（2026-08-22）

## 目的与边界

本文只解决“恢复受控 SSH 后如何安全进入发布流程”，不替代 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)。
它不授权修改旧 Python 项目、不停止或重启旧服务、不修改旧端口 `8001`、不执行数据库 migration、不清理 Redis，也不打开支付、医保、
退款或 HIS worker。

当前已知目标为阿里云中转机 `8.130.127.184`；内网服务地址为 `192.168.112.172`。本轮两个地址均返回 SSH 公钥拒绝，
所以没有上传、读取日志、切换 release 或重启任何服务。恢复权限必须由服务器管理员通过阿里云控制台、既有带外终端或其它受控管理员通道完成。

## 1. 恢复公钥，不传私钥

本机只把公钥交给管理员，不能上传或复制 `.pem`、私钥文件、密码、数据库连接串、微信 `AppSecret` 或完整环境变量。
管理员在目标账号 `ps` 的带外终端中执行等价操作：

```bash
install -d -m 700 /home/ps/.ssh
printf '%s\n' '<从本机 .pub 文件复制的单行公钥>' >> /home/ps/.ssh/authorized_keys
chmod 600 /home/ps/.ssh/authorized_keys
chown -R ps:ps /home/ps/.ssh
```

必须由管理员先确认该公钥没有重复、来源可信，并遵守服务器既有 SSH 审计规则。不要把公钥追加命令输入到旧服务进程、旧 Python
工作目录或应用日志中；`authorized_keys` 只属于 SSH 账号配置，不是应用环境变量。

本机查看公钥时只读取 `.pub` 文件：

```powershell
Get-Content -Raw "$env:USERPROFILE\.ssh\remote-8-130-127-184.pem.pub"
```

如果当前没有对应 `.pub` 文件，应从同一私钥重新导出公钥或由管理员生成新的密钥对；不能把私钥内容当作公钥发送。

## 2. 恢复后第一轮只读检查

先使用 `BatchMode` 验证公钥登录，不输入密码，不执行应用修改：

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=8 `
  -i "$env:USERPROFILE\.ssh\remote-8-130-127-184.pem" `
  ps@8.130.127.184 "printf 'ssh-ok\n'; hostname; date -Is"
```

登录成功后，第一条远端检查必须只读取当前 release、服务状态和监听端口：

```bash
set -eu
cd /home/ps/code/hospital-platform
printf 'current=%s\n' "$(readlink -f current)"
systemctl is-active hospital-platform-api-v2.service
systemctl is-active hospital-platform-worker-v2.service || true
ss -ltnp | grep -E ':18081|:8001' || true
```

这里的预期是：新 API unit 为 `active`，worker 保持 `inactive`，新 API 和旧 Python 端口都存在。任何旧 `8001` 消失、旧 Python
进程异常或当前目录无法确认，都必须停止，不得继续上传或重启。

## 3. 发布前候选配对

服务端候选和小程序运行包必须分别记录完整 40 位 Git commit。服务端候选 `4f2d890d` 与当前小程序 `b0e0935` 不是同一个
运行输入，这并不错误，但在部署服务端前不能把本地小程序包拿去做真机业务验收。正确顺序是：

1. 固定服务端候选完整 commit，并在本地完成 `pnpm check`；若 release baseline 因未部署而停止，不得修改基线文档绕过。
2. 按 runbook 生成 API/worker bundle 和 SHA-256 清单；服务器 release 目录不执行 `bun install` 或临时构建。
3. 上传到新的 `releases/<sha>/`，不覆盖 `current`、旧 release 或 `shared` 环境文件。
4. 登录服务器后重新计算 bundle SHA-256，并逐项确认结果与本地清单一致。
5. 使用 `shared/api.env` 做生产 env preflight，在 `127.0.0.1:18082` 完成隔离 runtime smoke；这一步不接公网、不写业务数据、
   不启动 worker。

环境文件必须保持既有权限（`shared/api.env` 为 `600`），真实值只能从服务器既有受控配置读取，不能写入 Git、聊天、命令历史或日志。

## 4. 只切换新 API，旧服务不动

只有候选 preflight 和临时端口 smoke 全部通过，才能使用 runbook 中的同目录软链接原子替换，并且只执行：

```bash
ln -s "releases/<new-sha>" current.next
mv -Tf current.next current
sudo -n systemctl restart hospital-platform-api-v2.service
```

禁止执行下列动作：

- `systemctl stop/restart` 旧 Python unit；
- 修改旧项目目录、旧 Python 环境变量或旧日志路由；
- 使用 `rm -rf`、`FLUSHDB`、`FLUSHALL` 清理现场；
- 在发布目录安装 workspace 依赖或现场编译；
- 因为小程序真机报错而复制 `*.test.js` 到 `apps/miniprogram/dist/`。

## 5. 切换后与回滚门禁

切换后必须同时确认：新 API `live/ready/system-ping`、启动日志中的 `environment=production` / `runtimeMode=production`、
database/Redis/schema readiness，以及旧 Python `8001` 仍在监听且进程身份没有变化。公网 `/api/v2` 通过后，才开始新的微信真机扫码。

只要新 API 未 ready、公网路径异常、旧 `8001` 消失、worker 被意外启动或出现无法解释的业务错误，就立即按 runbook 将 `current` 指回
切换前从服务器读取的 `<old-sha>`，并只重启 `hospital-platform-api-v2.service`。回滚完成后再次核对新 API 与旧 `8001`，保留切换前后
版本、requestId 和低敏日志证据。

真机验收仍需把页面结果、客户端 HTTP requestId/Provider requestId 和服务端 Pino 低敏日志配对；运行层通过、SSH 登录成功或二维码生成，
都不能单独证明微信登录、患者切换、预约历史或门诊费用业务完成。
