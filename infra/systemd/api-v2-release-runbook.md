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
test -f "releases/${new_sha}/apps/worker/dist/p0-log-aggregate.js"
test -f "releases/${new_sha}/apps/worker/dist/p0-business-evidence-audit.js"
test -f "releases/${new_sha}/apps/worker/dist/redis-session-ttl-audit.js"
test -f shared/api.env
test "$(stat -c '%a' shared/api.env)" = 600
# release 中的 dist 和脱敏日志聚合 artifact 必须来自已通过本地门禁的构建产物；先在本地保存 checksum，上传后再复核。
sha256sum \
    "releases/${new_sha}/apps/api/dist/index.js" \
    "releases/${new_sha}/apps/worker/dist/index.js" \
    "releases/${new_sha}/apps/worker/dist/preflight.js" \
    "releases/${new_sha}/apps/worker/dist/provider-directory-smoke.js" \
    "releases/${new_sha}/apps/worker/dist/api-runtime-smoke.js" \
    "releases/${new_sha}/apps/worker/dist/p0-log-aggregate.js" \
    "releases/${new_sha}/apps/worker/dist/p0-business-evidence-audit.js" \
    "releases/${new_sha}/apps/worker/dist/redis-session-ttl-audit.js"
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
`provider-directory-smoke.js`、`api-runtime-smoke.js` 和 `p0-log-aggregate.js`，这样服务器可以在没有
workspace 链接时复现发布前只读验收，并在受控 journald 窗口执行不回显原文的日志聚合；这些脚本不会启动
worker，也不会执行 migration 或支付/医保/HIS 写入。还必须包含 `p0-business-evidence-audit.js`，用于对安全
聚合结果执行“请求事件 + 明确成功事件”的业务门禁。`p0-log-aggregate.js` 只消费 stdin 的 journald JSONL；生产查询
优先使用 `journalctl -o json`，工具会安全拆出 `MESSAGE` 中的 Pino JSON，旧的 `-o cat` 输入仍兼容。
还必须包含 `redis-session-ttl-audit.js`，用于在独立只读维护 ACL 下统计
`hospital:session:*` 的 TTL；它不属于 API 请求路径，不接收 token、患者标识或 Provider 原始报文作为参数，
也不会修改 Redis。候选临时 smoke 只验证运行时，不替代本地代码门禁。

候选 release 上传后，可在不切换 `current` 的情况下执行生产环境 preflight：

```bash
cd /home/ps/code/hospital-platform
set -a
. shared/api.env
set +a
/home/ps/.bun/bin/bun "releases/${new_sha}/apps/worker/dist/preflight.js"
```

日志聚合必须使用同一候选 release 的 bundle，不要在服务器 release 目录执行 `bun install` 或引用缺失的
workspace 源码：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '2026-08-17 00:00:00' --until '2026-08-17 23:59:59' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun "releases/${new_sha}/apps/worker/dist/p0-log-aggregate.js"
```

若要执行某一业务域门禁，必须先让聚合工具输出纯 JSON，再交给同一 release 的证据工具；不能把人类提示行
直接当作 JSON 输入：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '2026-08-17 00:00:00' --until '2026-08-17 23:59:59' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun "releases/${new_sha}/apps/worker/dist/p0-log-aggregate.js" \
  --json > /tmp/p0-summary.json
/home/ps/.bun/bin/bun \
  "releases/${new_sha}/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentRecords
```

命令只输出安全计数和缺失项；`parseErrors` 不为 `0`、`systemdWarningCount` 不为 `0` 或请求/成功事件不完整时，证据门禁失败。该门禁不替代
页面、HTTP 和 trace 交叉核对，也不会修改线上状态。

会话 TTL 需要单独的只读维护凭证，不能给 API 常驻账号扩展 `SCAN` 权限：

```bash
# 通过密钥管理或受控进程环境注入，不要把真实 URL 写入 shell 历史、日志或聊天记录。
/home/ps/.bun/bin/bun \
  "releases/${new_sha}/apps/worker/dist/redis-session-ttl-audit.js"
```

命令优先读取 `REDIS_SESSION_AUDIT_URL`，未提供时才回退 `REDIS_URL`；退出码 `0` 只代表完整、非空且每个
会话 key 都有非负 TTL，权限拒绝、空结果、截断或 TTL 异常均不会被当作通过。

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

2026-08-20 13:42–13:44 CST：候选 `0e360d3` 已完成本地全仓门禁、真实生产 env preflight、
`127.0.0.1:18082` 隔离 runtime smoke，并从 `398be8e` 原子切换到当前 `current`，只重启
`hospital-platform-api-v2.service`。切换后内网/公网 readiness、生产模式启动日志、公网 runtime smoke 和 journald
低敏聚合均通过；旧 Python `8001` 的 Gunicorn master/worker PID 与启动时间未变化。完整证据见
[`../../docs/release/0e360d3-production-acceptance-2026-08-20.md`](../../docs/release/0e360d3-production-acceptance-2026-08-20.md)。

2026-08-19 16:30–16:37 CST：候选 `398be8e` 已完成八个 bundle SHA-256 对照、真实生产 env preflight、
`127.0.0.1:18082` 隔离 runtime smoke，并从 `968af78` 原子切换到当前 `current`，只重启
`hospital-platform-api-v2.service`。切换后公网 `/api/v2` live、ready 连续 6/6、system-ping 和未登录认证边界均通过，
ready 的 database/redis/schema 为 `ok`；新 API `18081` 与旧 Python `8001` 同时监听。切换窗口日志聚合为
`parseErrors=0`、`systemdWarningCount=0`，仅包含基础设施和健康检查事件，没有把本次运行层 smoke 误记为真实患者、
预约或费用业务证据。完整记录见
[`../../docs/release/398be8e-production-acceptance-2026-08-19.md`](../../docs/release/398be8e-production-acceptance-2026-08-19.md)。

2026-08-19 00:48–00:50 CST：候选 `b7c9451` 已从 `c26e696` 原子切换到当前 `current`，只重启
`hospital-platform-api-v2.service`。第一次 `sudo -n` 因服务器要求密码被保护分支回滚，随后使用标准
`sudo -S` 完成同一范围的重启；回滚分支确认没有影响旧 Python。切换后新 API 的 production 启动字段、内外网
live/ready/system-ping、未登录 `401`、`no-store` 和 `18081`/`8001` 共存均通过，Worker inactive，
`18082` 无残留。当前 release 使用带 `correlation` 的 P0 聚合和业务证据 bundle；完整记录见
[`../../docs/release/b7c9451-production-acceptance-2026-08-19.md`](../../docs/release/b7c9451-production-acceptance-2026-08-19.md)。

2026-08-18 15:23-15:25 CST：候选 `4ae2a31` 已完成八个 bundle SHA-256 对照、真实生产 env preflight、
`127.0.0.1:18082` 隔离 runtime smoke 和正常 SIGTERM 回收，随后从 `9acdaf2` 原子切换到
`4ae2a31`，只重启新 API。切换后内网/公网 live、ready、system-ping 均通过，ready 的 database/redis/schema 为 `ok`；
旧 Python `8001` 的监听和 PID 集合保持不变，Worker 未启动。切换窗口日志聚合为 `parseErrors=0`、
`systemdWarningCount=0`，只有基础设施和健康请求，没有真实业务事件。完整记录见
[`../../docs/release/4ae2a31-production-acceptance-2026-08-18.md`](../../docs/release/4ae2a31-production-acceptance-2026-08-18.md)。

2026-08-18 11:40 CST 左右：候选 `9ca3a89` 已上传到独立 release 目录，8 个 bundle SHA-256 与本地构建产物一致，
使用真实 `shared/api.env` 的生产 preflight 通过，并在 `127.0.0.1:18082` 完成 production runtime smoke（live 200、
ready 3/3、system-ping 200、未登录认证 401）后正常 SIGTERM 回收。候选未切换 `current`，当前仍为 `c63dba9`；
新 API `18081` 与旧 Python `8001` 均保持监听，两个生产服务均未重启。新增 Redis TTL 审计命令使用现有常驻 API Redis ACL
时按设计返回 `redis-session-scan-unavailable`、退出码 2；没有修改 ACL、Redis、数据库或业务数据。独立维护 ACL 尚未注入，
因此会话 TTL 仍未验证。完整证据见 [`../../docs/release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md`](../../docs/release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md)。

2026-08-18 11:07-11:09 CST：候选 `c63dba9` 已完成 7 个 artifact checksum、真实生产 env preflight、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收，随后从 `e5bafd3` 原子切换到
`c63dba9`，只重启新 API。切换后内网 live/ready/system-ping、公网 live/ready/system-ping 和连续 6/6
公网 readiness 均通过，ready 的 database/redis/schema 为 `ok`，日志聚合 `parseErrors=0`、
`systemdWarningCount=0`。新 API `18081` 与旧 Python `8001` 保持共存，Worker 仍 inactive；本次只补齐
普通资料更新的 `user.profile.update.requested` 日志链路；切换后受控窗口的微信登录 `4/4`、患者目录读取 `20/20`、
患者同步 `10/10` 请求/成功门禁通过，但预约历史和门诊费用仍缺少请求/成功事件，也没有执行 migration、支付、医保、
退款或 HIS 写入。完整记录见
[`../../docs/release/c63dba9-production-acceptance-2026-08-18.md`](../../docs/release/c63dba9-production-acceptance-2026-08-18.md)。

2026-08-18 01:26-01:32 CST：候选 `52e9624` 已完成 7 个 artifact checksum、真实生产 env preflight、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收，随后从 `b3c9a99` 原子切换到
`52e9624`，只重启新 API。切换后内网与公网 ready 通过，新 API `18081` 与旧 Python `8001` 保持共存，
Worker 未启动。当前窗口日志只有运行时与未登录认证事件，不能替代真实微信、患者、预约历史或门诊费用业务证据；
完整记录见 [`52e9624-production-acceptance-2026-08-18.md`](../../docs/release/52e9624-production-acceptance-2026-08-18.md)。

2026-08-16：前一候选 `3a37e7e` 和候选 `a8174f1` 已在生产 env 和临时 `18082` 完成隔离 smoke；历史候选
`86cae9a` 进一步完成 live/ready no-store、system ping 和六个受保护路由的 401 认证边界验收。之后
`main` 先后新增 `0dc39aa`（原生页面迁移台账和静态门禁）及 `09c88b1`（发布文档时序校正），这些提交尚未
构建、上传或部署，不能沿用 `86cae9a` 的候选产物作为当前 HEAD。生产 `current` 仍为 `55fce6c`，`18081` 和旧 `8001` 均保持运行，
候选端口已释放；发布前仍必须重新执行 `git rev-parse HEAD` 固定当前候选，并按本手册复核完整 release。详细证据见
[`candidate-86cae9a-production-smoke-2026-08-16.md`](../../docs/release/candidate-86cae9a-production-smoke-2026-08-16.md)。
上述段落是窄权限配置前的历史记录；当前规则已安装并验证，最新候选切换证据见
[`query-error-contract-smoke-2026-08-16.md`](../../docs/release/query-error-contract-smoke-2026-08-16.md)。

2026-08-17 01:11-01:17 CST：候选 `b186098` 已完成五个 bundle checksum、真实生产 env preflight、
`127.0.0.1:18082` production smoke、SIGTERM 回收和原子 `current` 切换。切换后 `current=b186098`、
新 API `18081` active、旧 Python `8001` 保持 PID/监听、Worker inactive；公网 runtime smoke 完成
6/6 readiness、no-store、system ping 和未登录认证边界。支付、医保、HIS、报告 gate 和真实微信/Provider
业务仍关闭或待验收，完整证据见 [`b186098-production-acceptance-2026-08-17.md`](../../docs/release/b186098-production-acceptance-2026-08-17.md)。

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

2026-08-16 21:37-21:39 CST：候选 `d8f14f1` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，并在 `127.0.0.1:18087` 完成 production mode、真实 MySQL/Redis/schema、
live/ready、system-ping、未登录认证边界和 SIGTERM 停止验收。Provider smoke 新增患者归属门禁，
要求目标内部 patientId 出现在当前 session 的 `/patients` 目录中，未归属时不请求 Provider；候选未切换公网，
`current=d177991`、新 API `18081`、旧 Python `8001` 和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md)。

2026-08-16 22:16-22:19 CST：候选 `a11f117` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
真实生产 env preflight 通过，并在 `127.0.0.1:18088` 完成 production mode、真实 MySQL/Redis/schema、
live/ready、system-ping、未登录认证边界和 SIGTERM 停止验收。本候选只增加 MySQL/Schema 只读探针一次有界重试，
未切换公网；`current=d177991`、新 API `18081`、旧 Python `8001` 和 Worker 状态全程未改变。完整证据见
[`../../docs/release/candidate-a11f117-preproduction-smoke-2026-08-16.md`](../../docs/release/candidate-a11f117-preproduction-smoke-2026-08-16.md)。

2026-08-16 22:24-22:25 CST：在 MySQL/Schema readiness 恢复后，候选 `a11f117` 已按本手册完成
`current.next -> current` 原子切换，只重启 `hospital-platform-api-v2.service`。切换后内网
`10.0.0.3:18081` 与公网 `/api/v2` 的 live、ready、system-ping 全部通过，ready 的
`database/redis/schema` 均为 `ok`；旧 Python `8001` 保持运行，Worker 仍 inactive。注意公网业务
ping 是 `/api/v2/system/ping`，内部直连才是 `/api/v1/system/ping`，不能重复拼接两个前缀。
真实微信、患者、预约、费用、Provider 和真机业务仍未在本次切换中调用。完整证据见
[`../../docs/release/a11f117-production-acceptance-2026-08-16.md`](../../docs/release/a11f117-production-acceptance-2026-08-16.md)。

2026-08-17 02:09-02:12 CST：候选 `ca5a372` 已上传到独立 release，五个 bundle SHA-256 与本地产物一致；
使用 `shared/api.env` 的真实生产 env preflight 通过，候选 API 在 `127.0.0.1:18082` 完成 production
mode、MySQL/Redis/schema、live/ready、system-ping 和认证边界 smoke 后正常停止。随后执行
`current.next -> current` 原子切换并只重启新 API。公网 `/api/v2` 连续 6/6 readiness、live、system-ping
和四条“不登录且缺少业务参数”的受保护路径均通过，返回 401/`unauthorized`；旧 Python `8001`、PID
`636918` 和 Worker inactive 状态保持不变。完整证据见
[`../../docs/release/ca5a372-production-acceptance-2026-08-17.md`](../../docs/release/ca5a372-production-acceptance-2026-08-17.md)。

2026-08-17 15:00-15:05 CST：候选 `9833a01` 完成本地 build、真实生产 env preflight、5 个 bundle checksum、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收；随后从 `3ab0a6c` 原子切换到
`9833a01`，只重启新 API。公网 `/api/v2` 连续 6/6 readiness、live、system-ping 和未登录认证边界全部通过，
旧 Python `8001` 保持监听，Worker 未启动。首次 `sudo -n` 重启因服务器要求密码失败，软链接已自动恢复并经核对后使用交互式 sudo 完成切换；后续应重新验证 NOPASSWD 规则。真实微信、患者、预约历史、门诊费用、报告 Provider 和真机业务仍未在本次切换中调用。完整证据见
[`../../docs/release/9833a01-production-acceptance-2026-08-17.md`](../../docs/release/9833a01-production-acceptance-2026-08-17.md)。

2026-08-17 15:38-15:40 CST：候选 `daee96d` 完成本地完整门禁、真实生产 env preflight、5 个 bundle checksum、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收；随后从 `9833a01` 原子切换到 `daee96d`，
只重启新 API。切换后公网 `/api/v2` live、ready 连续 6/6、system-ping 和未登录认证边界全部通过，
旧 Python `8001` 保持监听，Worker 仍 inactive。此次只增加 Provider 失败低敏诊断字段，不执行 Provider 业务、
支付、医保、退款、HIS 写入或 migration。完整证据见
[`../../docs/release/daee96d-production-acceptance-2026-08-17.md`](../../docs/release/daee96d-production-acceptance-2026-08-17.md)。

2026-08-17 20:29-20:32 CST：候选 `bf67b96` 完成六个 artifact checksum、真实生产 env preflight 和
`127.0.0.1:18082` 隔离 runtime smoke 后，按本手册原子切换 `current`，只重启新 API。切换后公网 live、ready
连续 6/6、system-ping 和未登录认证边界全部通过，旧 Python `8001` 保持监听，Worker 仍 inactive；当前 release
内的 `p0-log-aggregate.js` 对切换后 journald 窗口聚合 `parseErrors=0`。本次没有调用真实微信、患者、预约、费用
Provider，也没有执行 migration、支付、医保、退款或 HIS 写入。完整证据见
[`../../docs/release/bf67b96-production-acceptance-2026-08-17.md`](../../docs/release/bf67b96-production-acceptance-2026-08-17.md)。

2026-08-17 23:13-23:18 CST：候选 `b823727` 完成 7 个 artifact checksum、真实生产 env preflight、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收，随后从
`bf67b9673708a6e5188880eba9a6d29b8e78f0c5` 原子切换到 `b823727`，只重启新 API。切换后内网和公网
live、ready、system-ping 通过，公网 runtime smoke 的 ready 连续 3/3，旧 Python `8001` 保持监听，
Worker 仍 inactive。当前 release 的日志聚合 `parseErrors=0`，但预约历史和门诊费用 P0 证据门禁均因
本窗口没有有效微信业务请求而缺少 requested/success；这不是业务验收完成。完整证据见
[`../../docs/release/b823727-production-acceptance-2026-08-17.md`](../../docs/release/b823727-production-acceptance-2026-08-17.md)。

2026-08-18 00:04-00:06 CST：候选 `b3c9a99` 完成 7 个 artifact checksum、真实生产 env preflight、
`127.0.0.1:18082` production runtime smoke 和正常 SIGTERM 回收，随后从 `b823727` 原子切换到
`b3c9a99`，只重启新 API。切换后内网与公网 `/api/v2` 的 live、ready、system-ping 通过，公网 runtime
smoke 的 ready 连续 3/3，旧 Python `8001` 保持监听，Worker 仍 inactive。此次仅验证运行时、依赖、
认证边界和 release 共存，没有调用真实微信、患者、预约、费用 Provider，也没有执行 migration、支付、
医保、退款或 HIS 写入；`sudo journalctl` 因服务器要求交互密码未执行聚合，不能把 startup/runtime smoke
误写成 P0 业务日志验收。完整证据见
[`../../docs/release/b3c9a99-production-acceptance-2026-08-18.md`](../../docs/release/b3c9a99-production-acceptance-2026-08-18.md)。
