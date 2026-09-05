# 3090-local SSH 连接恢复手册

当发布操作无法连接 `3090-local` 时，先尝试恢复本地 SSH 转发；如果本机转发仍不可用，使用
`meiyi-pro.pem` 经 WireGuard 直达 `10.0.0.3`。本文不记录密码、密钥内容或环境变量值。

## 0. PEM 直连兜底

当前 macOS 的 `3090-local` 依赖本机 `127.0.0.1:22023` 和 3090 上的 Unix socket；该 socket
没有监听进程时，即使本地端口曾经被 SSH 占用，连接也会在握手阶段被重置。此时不要继续反复重建
同一条失效转发，直接使用已配置的 `meiyi.pro` 跳板和 `meiyi-pro.pem`：

```bash
ssh -J meiyi.pro \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  -o IdentitiesOnly=yes \
  -i ~/.ssh/aliyun-3090 \
  ps@10.0.0.3 'printf "ssh_ok\\n"; hostname; date -Is'
```

其中 `meiyi.pro` 使用本机 SSH 配置中的 `~/.ssh/meiyi-pro.pem` 登录跳板机，
`~/.ssh/aliyun-3090` 是目标 `ps` 用户的身份密钥；命令不会把 PEM 内容写入项目、日志或服务端。
该兜底方式只解决运维连接，不修改 WireGuard、systemd、数据库或业务数据。

使用 PEM 连接后，服务端日志直接读取 journald：

```bash
ssh -J meiyi.pro -o BatchMode=yes -o ConnectTimeout=8 \
  -o IdentitiesOnly=yes -i ~/.ssh/aliyun-3090 ps@10.0.0.3 \
  'journalctl -u hospital-platform-api-v2.service -n 100 --no-pager'
```

如果 `journalctl` 被系统权限拒绝，再由服务器管理员执行对应的 `sudo journalctl`；不要为了排障
临时把完整环境文件、数据库连接串或 PEM 内容复制到聊天记录。

## 1. 先检查 `3090-local`

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 3090-local 'printf "ssh_ok\\n"; hostname; date'
```

如果返回 `Connection refused`、连接超时或本地 `22023` 没有监听，执行下一步。

## 2. 建立本地 SSH 转发

```bash
ssh -fN \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:22023:/tmp/hospital-3090-ssh.sock \
  3090
```

这个命令通过现有的 `3090` 主机别名，把本机 `127.0.0.1:22023` 转发到远端的 SSH Unix socket。它只恢复连接通道，不切换 release、不重启服务，也不修改数据库。

如果命令提示本地端口已被占用，先确认是否已有健康的转发：

```bash
lsof -nP -iTCP:22023 -sTCP:LISTEN
ssh -o BatchMode=yes -o ConnectTimeout=8 3090-local 'printf "ssh_ok\\n"; hostname; date'
```

已有转发可以正常连接时直接复用，不要重复建立；只有确认是失效的转发进程后，才按进程号结束它并重新执行第 2 步。

## 3. 重试连接

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 3090-local 'printf "ssh_ok\\n"; hostname; date'
```

连接成功后，再继续发布手册中的只读检查、候选 preflight 和原子切换步骤。若第 2 步或第 3 步仍失败，应停止发布并先恢复 `3090` 直连通道，不能在无法观察服务状态时切换 `current`。

## 4. 发布前最小确认

```bash
ssh 3090-local 'set -eu
cd /home/ps/code/hospital-platform
printf "current=%s\\n" "$(readlink -f current)"
printf "api_active="
sudo -n systemctl is-active hospital-platform-api-v2.service
printf "ready="
curl -fsS http://10.0.0.3:18081/health/ready
'
```

该确认通过后，才可以继续使用 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 的发布流程。
