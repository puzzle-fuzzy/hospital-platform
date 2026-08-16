# 新 API 候选版本无损切换手册

本文只负责切换 `hospital-platform-api-v2.service` 使用的 `current` release，
不管理旧 Python 服务、不修改旧端口 `8001`、不执行数据库 migration，也不启动支付/医保/HIS worker。

## 1. 一次性配置窄权限

`current`、`releases` 和 `shared` 目录由 `ps` 自己管理，因此不需要为文件上传和软链接切换授予 root 权限。
仓库已经提供可审计的规则文件 [`hospital-platform-api-v2.sudoers`](hospital-platform-api-v2.sudoers)。
管理员只需要使用 `visudo` 安装这个文件，内容如下：

```sudoers
# 文件内容见 infra/systemd/hospital-platform-api-v2.sudoers
```

安装后由管理员执行：

```bash
visudo -cf /etc/sudoers.d/hospital-platform-api-v2
chmod 0440 /etc/sudoers.d/hospital-platform-api-v2
# -l 需要管理员已有的 sudo 认证，用于人工检查 NOPASSWD 列表
sudo -S -l -U ps
```

验证时只检查 `NOPASSWD` 列表：`ps` 对上述三个新 API 命令显示 `NOPASSWD`，不能出现旧 Python
unit、worker 或任意通配符命令。账号原有的“输入密码后全权限 sudo”属于既有系统管理权限，不作为本规则
的发布权限；如果需要收紧该既有权限，必须由服务器管理员另行评估，不能在发布过程中顺手修改。

安装后的无密码 smoke：

```bash
sudo -n systemctl is-active hospital-platform-api-v2.service
# 必须返回 active
sudo -n systemctl is-active hospital-platform-worker-v2.service
# 必须因未被 NOPASSWD 授权而失败并要求密码；不得执行 worker
```

不要授予 `systemctl *`、任意命令执行、旧 Python unit 的 stop/restart 权限，也不要把环境文件内容放入
sudoers、仓库、聊天记录或日志。若 `visudo` 校验失败，必须删除未生效的临时文件并停止发布流程。

2026-08-16 已在目标主机安装并验证该规则；安装、校验和无密码 smoke 的证据见
[`docs/release/systemd-narrow-permission-acceptance-2026-08-16.md`](../../docs/release/systemd-narrow-permission-acceptance-2026-08-16.md)。

## 2. 切换前检查

以下命令由 `ps` 执行。`<sha>` 必须是已经通过本地 `pnpm check` 和独立生产 env smoke 的候选 commit，
`<old-sha>` 必须从切换前的 `readlink -f current` 读取，不能手写猜测。

```bash
cd /home/ps/code/hospital-platform
old_sha="$(readlink -f current | sed 's#.*/##')"
new_sha="<sha>"
test -f "releases/${new_sha}/apps/api/dist/index.js"
test -f "releases/${new_sha}/apps/worker/dist/index.js"
test -f "releases/${new_sha}/apps/worker/dist/preflight.js"
test -f "releases/${new_sha}/apps/worker/dist/provider-directory-smoke.js"
test -f "releases/${new_sha}/apps/worker/dist/api-runtime-smoke.js"
test -f shared/api.env
test "$(stat -c '%a' shared/api.env)" = 600
# release 中的 dist 必须来自已通过本地门禁的构建产物；先在本地保存 checksum，上传后再复核。
sha256sum \
    "releases/${new_sha}/apps/api/dist/index.js" \
    "releases/${new_sha}/apps/worker/dist/index.js" \
    "releases/${new_sha}/apps/worker/dist/preflight.js" \
    "releases/${new_sha}/apps/worker/dist/provider-directory-smoke.js" \
    "releases/${new_sha}/apps/worker/dist/api-runtime-smoke.js"
```

切换前必须保存以下证据：

- `current` 指向的旧 release；
- 新旧 API 是否已经分别监听 `18081` 和 `8001`；
- 当前公网 `/api/v2/health/ready` 响应；
- 旧 Python 进程仍由原启动方式运行；
- 候选 release 的本地 `pnpm check`、临时端口 smoke 和日志文件。

生产 release 的依赖目录可能没有 workspace `@hospital/*` 开发链接，不能在服务器 release 目录直接执行
`bun build` 或临时 `bun install` 作为发布步骤；必须使用本地构建 bundle，并通过 checksum 证明上传内容
与候选产物一致。worker release 除常驻 `index.js` 外，还必须包含独立的 `preflight.js`、
`provider-directory-smoke.js` 和 `api-runtime-smoke.js`，这样服务器可以在没有 workspace 链接时复现
发布前只读验收；这些脚本不会启动 worker，也不会执行 migration 或支付/医保/HIS 写入。候选临时 smoke
只验证运行时，不替代本地代码门禁。

候选 release 上传后，可在不切换 `current` 的情况下执行生产环境 preflight：

```bash
cd /home/ps/code/hospital-platform
set -a
. shared/api.env
set +a
/home/ps/.bun/bin/bun "releases/${new_sha}/apps/worker/dist/preflight.js"
```

该命令只读取 MySQL、Redis、schema 和配置 gate；这里必须使用 API 的生产 env，因为候选 API 的持久化
连接和 schema gate 在 `shared/api.env`，`shared/worker.env` 只用于尚未启用的 Worker。支付 gate 保持关闭
是当前合法状态，preflight 通过不等于允许启动 worker；Worker 自己仍必须使用严格的支付配置检查并保持
disabled/inactive。需要真实患者只读证据时，再在受控环境注入临时平台 access token 和内部
`patientId`，执行 `provider-directory-smoke.js`，不得把 token 写入 release、shell 历史或日志。

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

2026-08-16：前一候选 `3a37e7e` 和候选 `a8174f1` 已在生产 env 和临时 `18082` 完成隔离 smoke；历史候选
`86cae9a` 进一步完成 live/ready no-store、system ping 和六个受保护路由的 401 认证边界验收。之后
`main` 先后新增 `0dc39aa`（原生页面迁移台账和静态门禁）及 `09c88b1`（发布文档时序校正），这些提交尚未
构建、上传或部署，不能沿用 `86cae9a` 的候选产物作为当前 HEAD。生产 `current` 仍为 `55fce6c`，`18081` 和旧 `8001` 均保持运行，
候选端口已释放；发布前仍必须重新执行 `git rev-parse HEAD` 固定当前候选，并按本手册复核完整 release。详细证据见
[`candidate-86cae9a-production-smoke-2026-08-16.md`](../../docs/release/candidate-86cae9a-production-smoke-2026-08-16.md)。
上述段落是窄权限配置前的历史记录；当前规则已安装并验证，最新候选切换证据见
[`query-error-contract-smoke-2026-08-16.md`](../../docs/release/query-error-contract-smoke-2026-08-16.md)。

2026-08-16 19:05-19:07 CST：候选 `e660ccb` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
使用 `shared/api.env` 的真实生产 env preflight 通过，候选 API 在 `18082` 完成 production mode、
MySQL/Redis/schema、no-store、`/api/v1/system/ping` 和未登录 `401` smoke，随后已停止临时进程。
`current=55fce6c`、新 API `18081` 和旧 Python `8001` 全程未改变。完整证据见
[`../../docs/release/candidate-e660ccb-production-smoke-2026-08-16.md`](../../docs/release/candidate-e660ccb-production-smoke-2026-08-16.md)。

2026-08-16 20:08-20:11 CST：候选 `b4dc33b` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
使用 `shared/api.env` 的真实生产 env preflight 通过，候选 API 在 `18082` 和 loopback `18083` 完成
production mode、MySQL/Redis/schema、no-store、system ping 和未登录认证边界 smoke，随后已停止临时进程。
`current=55fce6c`、新 API `18081` 和旧 Python `8001` 全程未改变。完整证据见
[`../../docs/release/candidate-b4dc33b-production-smoke-2026-08-16.md`](../../docs/release/candidate-b4dc33b-production-smoke-2026-08-16.md)。

2026-08-16 20:37-20:42 CST：候选 `d177991` 已完成 checksum、真实生产 env preflight、`18082/18083`
隔离 runtime smoke，并按本手册原子切换 `current` 后只重启新 API。公网 `/api/v2` 的 live、ready、system-ping
和未登录认证边界全部通过，旧 Python `8001` 与 Worker 状态未改变。完整证据见
[`../../docs/release/candidate-d177991-production-acceptance-2026-08-16.md`](../../docs/release/candidate-d177991-production-acceptance-2026-08-16.md)。

2026-08-16 20:58-21:00 CST：候选 `93373d9` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，公网 runtime smoke 首次观察到 database/schema 探针瞬态不可用后恢复，随后复测
live、ready、system ping 和未登录认证边界全部通过。`current=d177991`、新 API `18081`、旧 Python `8001`
和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-93373d9-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-93373d9-preproduction-smoke-2026-08-16.md)。

2026-08-16 21:05-21:07 CST：候选 `411cd31` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，并在 `127.0.0.1:18084` 完成 production mode、真实 MySQL/Redis/schema、live/ready
和 SIGTERM 停止验收。`current=d177991`、新 API `18081`、旧 Python `8001` 和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-411cd31-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-411cd31-preproduction-smoke-2026-08-16.md)。

2026-08-16 21:16-21:18 CST：候选 `3dc6f5f` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，并在 `127.0.0.1:18085` 完成 production mode、真实 MySQL/Redis/schema、
live/ready、system-ping、未登录认证边界和 SIGTERM 停止验收。候选 runtime smoke 已补齐失败请求 traceId
关联；`current=d177991`、新 API `18081`、旧 Python `8001` 和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md)。

2026-08-16 21:25-21:27 CST：候选 `3129148` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，并在 `127.0.0.1:18086` 完成 production mode、真实 MySQL/Redis/schema、
live/ready、system-ping、未登录认证边界和 SIGTERM 停止验收。Provider smoke 新增 `session` 会话边界，
但候选未切换公网；`current=d177991`、新 API `18081`、旧 Python `8001` 和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-3129148-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-3129148-preproduction-smoke-2026-08-16.md)。
