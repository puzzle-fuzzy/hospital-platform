# 3090-local SSH 连接恢复手册

当发布操作无法连接 `3090-local` 时，先恢复本地 SSH 转发，再重试原来的连接命令。本文不记录密码、密钥或环境变量值。

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
