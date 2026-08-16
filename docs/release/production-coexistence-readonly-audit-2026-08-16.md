# 生产新旧服务共存只读审计（2026-08-16）

本文第一部分是 2026-08-16 对生产主机进行 SSH 只读检查后形成的快照。检查使用已经授权的 `ps` 账号，
未向用户、仓库或日志输出/提交任何环境变量秘密值，只提取了连接目标和开关元数据；初始快照阶段未删除 Redis key、
未执行 Redis flush、数据库 migration、写入业务数据、修改 Redis ACL 或重启服务。随后在本文件第 2.3 节记录了
经授权执行的 Redis 会话隔离和新 API 单服务重启。key 数量、进程号、连接状态会变化，不能当作永久配置。

## 1. 当前运行拓扑

| 项目 | 只读观察结果 | 迁移判断 |
| --- | --- | --- |
| 新 API | `hospital-platform-api-v2.service` active；生产模式；监听 `10.0.0.3:18081`；初始只读快照为 `ca3a877`，后续曾观察到 `3fd069d`；本次 14:01 CST 复核的 current symlink 为 `55fce6c` | 新 API 进程本身已由 systemd 管理，但患者同步 `0015` 版本尚未切换为当前 release |
| 旧 Python API | `python main.py run --env prod` 监听 `8001`；未发现对应 systemd unit；当前由 `nohup` 手工进程维持 | 旧服务仍是线上事实来源，不能因为新 API active 就停止 |
| 新 Worker | `hospital-platform-worker-v2.service` 已安装但 disabled/inactive；未观察到新 worker 进程 | outbox、支付查单和通知补偿当前不能宣称在生产运行 |
| 公网 v2 | `https://test-hp.meiyi.pro/api/v2/health/live`、`health/ready`、`system/ping` 均返回 200 | `/api/v2` 公网路由和 HTTPS 当前可达 |
| 内网 API | `/health/ready` 快照返回 database、redis、schema 均为 `ok` | 只证明当前探针可用，不等于 provider 或真机业务验收 |
| 旧公网路径 | `/api/v1/system/ping`、`/api/v1/health` 返回旧 FastAPI 风格 404 | 旧服务仍可响应；具体旧业务路径必须按旧接口清单验收 |

公网健康检查响应中的 `x-request-id` 已出现，API journald 中也能看到对应 HTTP 请求事件；这证明公网
Nginx → 新 API 的链路可关联。该事实不证明公网所有业务接口都已正确映射。

## 2. 共享 MySQL 与 Redis 的事实

### 2.1 MySQL

在不记录密码的前提下，对旧 `.env.prod` 和新 API 运行环境做了连接目标元数据比对：两者使用同一
MySQL 数据库 `hospital-dev`。新 API 启动日志和 `/health/ready` 均显示数据库探针、schema probe 通过。

这保持了当前设计的表隔离边界：新服务只使用 `hp_*` 表，旧服务继续使用旧表；但“同库”仍意味着必须继续
防止新 migration 修改旧表、旧清理任务误删 `hp_*`，以及两套服务对同一 provider 事实重复写入。

### 2.2 Redis

初始只读快照显示旧 Python 进程和新 Bun API 都连接到同一个 Redis host/port。旧生产配置的 Redis DB 是 `1`，
当时新 API `REDIS_URL` 的数据库路径也是 `/1`；因此快照当时不是“仅仅共用 Redis 产品”，而是“共用同一个 Redis DB”。

在该快照时刻，使用 `SCAN MATCH` 只统计 key，不输出 key 名和值，结果如下：

| 逻辑前缀 | 数量 | 解释 |
| --- | ---: | --- |
| `hospital:session:*` | 0 | 快照时没有新平台会话；不能因此删除或修改任何旧会话 |
| `access_token:*` | 169 | 旧服务在线 token 语义仍在使用 |
| `refresh_token:*` | 4056 | 旧服务 refresh token 语义仍在使用 |
| `system_config:*` | 16 | 旧管理端配置缓存仍存在 |
| `system_dict:*` | 10 | 旧管理端字典缓存仍存在 |
| `captcha_codes:*` | 0 | 快照时无验证码 key |
| `ticket:*` | 0 | 快照时无旧 WebView ticket key |

该快照没有对无前缀 AI `conversation_id` 做全量内容判断；Redis 总 key 数和无前缀 key 的业务归属仍需在
不读取值的前提下另行分类。新服务当前必须继续遵守：

- 只访问 `hospital:session:*`，禁止扫描、读取、刷新或删除旧前缀；
- 旧管理端的在线用户/缓存清理能力不能获得新服务 key 的删除权限；
- 在 Redis database 或 ACL 没有隔离前，不打开新服务的管理端、验证码、AI 会话和通用缓存能力；
- 新平台会话不从旧 JWT/旧 Redis token 直接换发，旧用户重新微信登录；
- 回滚只能处理新前缀，不能执行 `FLUSHDB`、`FLUSHALL` 或全库清理。

初始快照时最优先的发布前动作不是迁移 key，而是完成 Redis ACL/DB 隔离验证，并保存脱敏配置摘要和回滚演练证据。

### 2.3 后续 Redis 会话隔离实施（2026-08-16）

在完成上述只读盘点后，已在不触碰旧 key 的前提下完成新 API 会话边界切换：

| 项目 | 已验证结果 | 影响范围 |
| --- | --- | --- |
| 新 API Redis 用户 | 专用用户 `hospital_v2`，ACL 仅保留 `PING`、`SELECT`、`GET`、`SET` | 只授予新 API |
| 新 API Redis DB | 独立 DB3；目标库切换前为空，切换后探针 key 已自动过期，DB3 回到 0 key | 不读取旧 DB1 |
| key 约束 | ACL key pattern 为 `hospital:session:*` | 非所属 key 访问返回 `NOPERM` |
| 配置保护 | `shared/api.env` 和服务器端带时间戳回滚备份均为 `0600` | 秘密不进入仓库、日志或本文 |
| 新旧服务重启 | 只重启新 API；旧 Python PID `636918` 仍监听 `8001` | 旧公网服务未被停用 |

隔离探针验证了 `SET EX` 的 TTL 行为、过期后不可读以及跨 key pattern 拒绝。新 API 本机 `/health/ready`
和公网 `/api/v2/health/ready` 均为 200，database、redis、schema 均为 `ok`；旧服务本机 8001 仍可响应，
旧公网 `/api/v1/system/ping` 仍返回旧 FastAPI 风格 404。新 worker 没有切换 `worker.env`，仍保持 disabled/inactive。

这表示“新 API 会话已隔离”，不表示“整个 Redis 实例已完成隔离”：旧服务仍使用 DB1 的 `admin` 全权限账号，
旧 `access_token:*`、`refresh_token:*`、管理端缓存及其他历史 namespace 仍由旧服务负责。后续仍需在旧服务
下线或独立凭据轮换阶段收紧旧账号权限，并先完成旧任务、文件、Mongo 和管理端能力的替代证据。

## 3. 其他基础设施观察

### 3.1 MongoDB

旧生产 `.env.prod` 的 `MONGO_DB_ENABLE=False`；该主机未观察到 `27017` MongoDB 监听。旧源码仍保留 Mongo
连接和通用 CRUD 定义，因此结论是“当前生产配置关闭且本机无监听”，不是“历史 Mongo 数据已确认不存在”。
在删除旧配置或归档前，仍要确认外部 Mongo、备份和历史集合。

### 3.2 文件资源

旧服务仍保留本地 `static/upload` 能力，新服务没有文件上传/下载 API。不能把旧本地路径、头像 `file_url` 或
报告附件直接写入新事实；对象存储、内容安全、owner/TTL、签名 URL 和恢复演练仍未完成。
现场浅层元数据确认 `static`、`static/upload` 和 `static/swagger` 目录均存在，目录权限为 `0775`；本次没有
递归读取文件名或内容，文件数量、个人信息和历史报告资产仍未完成清点。

### 3.3 配置文件权限

新服务的 `shared/api.env`、`shared/worker.env` 权限为 `0600`。本次审计初始观察到旧服务 `env/.env.prod`
和 `env/.env.dev` 为 `0664`，其中生产文件可能包含微信、数据库、Redis、医保和支付秘密；这是高优先级安全问题。
在确认旧进程所有者仍为 `ps` 后，已将旧 `env` 目录收紧为 `0700`，两个 env 文件收紧为 `0600`；旧 Python
进程在修复后仍保持运行，未重启、未切换流量。

权限修复已完成，但不能证明历史文件没有被非授权账号读取。后续必须：

1. 根据主机审计能力检查历史读取风险；若无法排除，按秘密类型安排轮换；
2. 只在确认服务账号仍可读取后再重启旧服务；
3. 不把旧 env 内容复制到 Git、issue、日志或聊天记录。

### 3.4 Worker 与旧调度器

旧 Python/Celery 相关进程仍存在，新 Bun worker 未启动。新 worker 的 outbox 与查单代码不能被视为线上补偿
已经执行；支付 gate 当前关闭，所以本次不启动 worker。未来启动前必须先单独验收 worker env、schema、lease、
日志和回滚，不得通过患者 API 进程内循环替代。

### 3.5 14:01 CST 生产复核补充

本次只读 SSH 复核未修改服务、文件、数据库或 Redis：

| 项目 | 当前证据 | 迁移判断 |
| --- | --- | --- |
| 新 API current | `/home/ps/code/hospital-platform/current -> releases/55fce6c`；systemd 主进程 cwd 也指向该 release | `1447a2e` 的 `0015` 患者同步实现仍未进入公网 current；不能宣称 durable sync 已完成线上业务验收 |
| 旧 Python | `python main.py run --env prod`，PID `636918`，监听 `0.0.0.0:8001`；父进程是手工 shell/nohup 链路 | 旧服务仍承担原业务；重启或切换新 API 不等于旧服务已具备可恢复发布管理 |
| 新 Worker | 未发现 `hospital-platform-worker-v2` 运行进程；systemd 仍为 disabled/inactive | outbox、支付查单和通知补偿仍不能宣称线上运行；支付 gate 关闭期间不启动 |
| MongoDB | 本机无 `mongod` 进程、无 `27017/27018` 监听；旧生产配置此前为 `MONGO_DB_ENABLE=False` | 只能证明当前主机未运行本地 Mongo，不能证明外部 Mongo、备份或历史集合没有业务数据 |
| 旧文件资产 | `Hospital-Backend/static` 约 `16M`；`static/upload` 约 `300K`，包含 `9` 个文件、`4` 个目录；本次只读了数量/大小/时间，不读取内容 | 至少存在需保留/分类的旧资源；必须先做脱敏分类、哈希和恢复策略，不能删除或直接挂新公网 URL |
| 微信登录运行观察 | journald 在 13:40 CST 记录一次 `POST /api/v1/auth/wechat` 返回 `503`，错误类型为 `PersistenceUnavailableError`；13:54 CST 的 `/health/ready` 随后返回 200 | 不能把 readiness 200 当成登录链路已稳定；需要用真实 `wx.login` code 和 requestId 复现，并核对 MySQL/Redis 瞬时故障、连接池和重试边界 |

以上证据只更新“当前运行事实”，不扩大新服务权限，也不替代 provider、公网业务和真机验收。

### 3.6 16:57 CST 公网与 SSH 主机 readiness 短时观测差异（历史观测，已由 3.7 修正）

在未修改服务、配置、数据库或 Redis 的前提下再次做了只读复核，发现公网响应与 SSH 主机上实际运行的
Bun 进程不一致：

| 检查位置 | 结果 | 结论 |
| --- | --- | --- |
| SSH 主机进程 | Bun PID `2935571`，命令为 `/home/ps/.bun/bin/bun /home/ps/code/hospital-platform/current/apps/api/dist/index.js` | 当前 `current` 指向 `releases/55fce6c`，不是仓库 `main` 的待发布最新提交；发布前必须固定 `git rev-parse HEAD` |
| SSH 主机监听 | `10.0.0.3:18081`；旧 Python `0.0.0.0:8001` 仍在监听 | 新旧服务端口没有互相抢占；`127.0.0.1:18081` 被拒绝是因为新 API 只绑定 `10.0.0.3`，不是服务停止 |
| SSH 主机 `GET http://10.0.0.3:18081/health/live` | HTTP `200`，`status=ok` | 该进程可以响应存活检查 |
| SSH 主机 `GET http://10.0.0.3:18081/health/ready` | HTTP `200`，`database=unavailable`、`redis=ok`、`schema=unavailable` | 该进程当前没有达到可用状态 |
| 公网 `GET https://test-hp.meiyi.pro/api/v2/health/ready` | HTTP `200`，`database=ok`、`redis=ok`、`schema=ok` | 公网确实到达某个新 API，但不能证明它来自上述 `55fce6c` 进程 |
| 公网随机 query + `Cache-Control: no-cache` | 仍返回 `ready`，且响应没有 `Cache-Control: no-store` | 不能用普通缓存解释差异；仍需核对公网 upstream、外层转发或另一份 release |
| 公网 `GET /api/v2/patients` 无认证 | HTTP `401 unauthorized` | 只能证明公网路由存在和认证边界生效，不能证明患者业务实例与 SSH 主机一致 |

SSH 用户可见的 `/etc/nginx` 配置中没有找到 `api/v2`、`18081` 或 `proxy_pass` 的对应文本，因此当时无法仅从该主机
配置证明最外层阿里云转发的 upstream。16:57 CST 的差异需要通过 requestId 继续关联，结果见下一节；在关联完成前，
不得把公网 `200`、provider 请求或真机业务结果记为当前 `main`/当前 release 的验收证据。

本次检查没有重启、切换 `current`、修改 Nginx、修改环境变量、运行 migration 或写入业务数据。后续通过同一个
`X-Request-Id` 核对公网响应、Bun 请求日志和进程 release；在关联完成前，应先按另一 upstream/旧 release 处理，
而不是继续扩大业务 gate。

### 3.7 17:02 CST requestId 关联复核修正

随后使用公网唯一请求号 `provenance-1786870899294` 访问
`https://test-hp.meiyi.pro/api/v2/health/ready?audit=...`，公网返回 `ready`；SSH 主机 PID `2935571` 的
journald 同时记录了完全相同的 requestId、路径 `/health/ready` 和 `statusCode=200`。17:02 CST 再从 SSH 主机
直接请求 `http://10.0.0.3:18081/health/ready`，也返回 `database=ok`、`redis=ok`、`schema=ok`。

因此，3.6 节的“来源不一致”只能作为 16:57 CST 的瞬时观测，当前已修正为：**公网和 SSH 主机指向同一个
`55fce6c` Bun 进程，16:57 的 `database/schema=unavailable` 在后续探针中恢复，并非另一 upstream 的证据**。
这次关联也证明公网路由可以把 `X-Request-Id` 传入新 API；但当前 `55fce6c` 的内外层 readiness 响应都缺少
候选代码要求的 `Cache-Control: no-store`，所以仍不能把当前 release 当作包含最新健康探针修复的代码。

后续发布判断应区分三件事：

1. `health/ready` 的 HTTP `200` 只是探针请求完成，必须读取 body 中的依赖状态；
2. 真实 release provenance 已通过 requestId 关联确认，但当前运行版本仍是旧的 `55fce6c`；
3. 仓库 `main` 的待发布最新提交尚未部署；候选切换前必须固定 `git rev-parse HEAD`，切换后仍需重新验证 no-store、依赖恢复日志、公网路径和旧 `8001`。

### 3.8 17:59-18:00 CST 当前 release 与公网认证边界复核

本次仍只做只读检查，SSH 使用已授权的 `ps` 账号；没有重启、切换 `current`、修改配置、执行 migration
或写入业务数据。仓库当前 `main` 为 `3c8c01b`，服务器 `/home/ps/code/hospital-platform/current`
仍解析到 `releases/55fce6c`，因此当前公网不能作为 `3c8c01b` 的业务验收证据。

| 检查项 | 结果 | 迁移判断 |
| --- | --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active`，Bun PID `2935571`，监听 `10.0.0.3:18081` | 新 API 进程仍在运行，但版本落后于仓库 `main` |
| 旧 Python API | PID `636918` 仍监听 `0.0.0.0:8001` | 旧服务仍在，未发生端口抢占或停机 |
| 新 Worker | `hospital-platform-worker-v2.service=inactive` | outbox、支付查单和通知补偿不能宣称在线运行 |
| 公网健康检查 | `/api/v2/health/live`、`/api/v2/health/ready` 返回 200，ready body 为 database/redis/schema=`ok` | 只证明当前 release 的基础探针可用 |
| 公网缓存控制 | live/ready 响应未返回 `Cache-Control: no-store` | 当前 release 未包含候选健康探针修复，不能作为发布完成证据 |
| 公网系统探针 | `/api/v2/system/ping` 返回 200，并透传唯一 `X-Request-Id` | 公网 `/api/v2` 到新 API 的基础路由可关联 |
| 未登录患者端路由 | `/api/v2/patients`、`/appointments/departments`、`/reports`、`/payments/outpatient/records` 均返回 401 `unauthorized` | 路由注册和认证边界存在；不代表 provider、患者映射或真机业务成功 |

下一步发布门禁固定为：先在服务器保存仓库 `main` 的确切 commit，构建候选 release 并在临时端口验证
live/ready/no-store 和依赖恢复，再原子切换 `current`；切换后同时复测公网 `/api/v2`、旧 `8001`、
systemd 状态、requestId 关联和回滚路径。完成这些证据前，不打开患者同步真实验收、报告 gate 或任何支付 gate。

### 3.9 18:06-18:07 CST 公网 `/api/v2` Smoke 路径与缓存门禁复核

本轮只读执行仓库 `main=3c8c01b` 中刚补齐的运行 Smoke，显式设置
`HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro`、`HOSPITAL_API_PREFIX=/api/v2` 和
`HOSPITAL_RUNTIME_REQUIRE_READY=true`。Smoke 结果为：

| 请求 | 结果 | 证据判断 |
| --- | --- | --- |
| `GET /api/v2/health/live` | HTTP 200，但失败 | 公网路径正确命中；响应缺少 `Cache-Control: no-store` |
| `GET /api/v2/health/ready` | HTTP 200，但失败 | 公网路径正确命中；响应缺少 `Cache-Control: no-store` |
| `GET /api/v2/system/ping` | HTTP 200，通过 | `/api/v2` 公网前缀和基础路由可用，响应带唯一 requestId |

同一时段用 `curl` 复核，Nginx 响应头包含 `Server: nginx/1.18.0 (Ubuntu)`、`x-request-id`，但没有
`Cache-Control`。因此这次失败是有效的发布门禁证据，不是 Smoke 误把内部 `/api/v1` 拼到公网域名；
Smoke 现在默认验收内网 `/api/v1`，只有显式 `HOSPITAL_API_PREFIX=/api/v2` 才验收公网转发。
在 Nginx 或当前 release 补齐 no-store 并重新完成临时端口/公网复核前，不得推进下一次线上业务验收。

### 3.10 18:44 CST 当前线上只读复测

本次仍未重启、切换 `current`、修改 Nginx/环境变量、执行 migration 或写入业务数据。SSH 复核结果为：

| 检查项 | 当前结果 | 迁移判断 |
| --- | --- | --- |
| 新 API release | `current=/home/ps/code/hospital-platform/releases/55fce6c`，systemd `active` | 线上仍是旧候选，不能作为仓库当前 `main=a4bdb46` 的证据 |
| 端口共存 | 新 API `10.0.0.3:18081`，旧 Python `0.0.0.0:8001` 均监听 | 新旧服务仍共存，未发生端口抢占 |
| 发布权限 | `sudo -n -l` 返回“需要密码” | 不能执行原子切换、重启或回滚；不修改旧服务 |
| 公网 live | HTTP `200`，body `status=ok`，requestId `12645245-5279-4abc-b5bf-638534abb7b1` | 公网路由可达，但响应缺少 `Cache-Control: no-store` |
| 公网 ready | HTTP `200`，body `database/redis/schema=ok`，requestId `a6024114-5636-470e-bee1-64311b0300f6` | 当前 release 探针可用，但不满足候选发布缓存门禁 |
| 公网 system ping | HTTP `200`，body `apiVersion=0.1.0`，requestId `aa15d8b8-8f00-41c8-a6a5-a31cdf13ae29` | 只证明 `/api/v2` 基础路由和 requestId 透传 |

本次证据进一步确认：线上运行状态没有改变，下一步仍必须先获得窄权限、固定当前 `main` 的候选 SHA、构建并在临时端口验证，再执行原子切换；患者、预约、报告、费用的 provider/真机业务验收不能提前使用当前公网旧版本结果替代。

### 3.11 18:55 CST 公网只读复测

本次只通过公网 HTTPS 进行复测，没有重启服务、切换 `current`、修改配置、执行 migration 或写入业务数据。
本地仓库 `main=08ad3cb`，本次没有将该提交部署到服务器，因此以下结果只证明当前公网路径的即时状态，不能证明
`08ad3cb` 已在线。

| 请求 | 当前结果 | 证据判断 |
| --- | --- | --- |
| `GET /api/v2/health/live` | HTTP `200`，`status=ok`，requestId `97d864a2-6321-47da-b5e9-ffd30606a4ed` | 公网路径可达，但响应没有 `Cache-Control: no-store` |
| `GET /api/v2/health/ready` | HTTP `200`，`database/redis/schema=ok`，requestId `c6fe8385-c2a2-4524-8f1b-f7ce7311fe4f` | 当前公网依赖探针为 ready，但仍未通过 no-store 发布门禁 |
| `GET /api/v2/system/ping` | HTTP `200`，`apiVersion=0.1.0`，requestId `6ce5f370-4110-4bb1-b1ad-f8ea8990bb98` | `/api/v2` 基础路由和 requestId 透传正常 |
| `GET /api/v2/patients`（无认证） | HTTP `401`，`unauthorized`，requestId `3a426273-402e-4133-9853-c2d934d67b9f` | 未登录认证边界正常，不代表患者业务/provider 已完成验收 |

本次结果与 3.10 的发布判断一致：公网基础路径和认证边界正常，但当前线上仍不能作为仓库最新提交的业务验收环境；
下一步必须继续完成候选 bundle 的临时端口验证、`no-store` 修复和 release provenance 关联。

## 4. 当前不可宣称的内容

- 不能宣称整个 Redis 实例已完成隔离；新 API 会话已经迁移到 DB3/`hospital_v2`，但旧服务仍在 DB1 使用全权限 `admin`；
- 不能宣称新 worker 已接管旧 scheduler 或正在处理 outbox；
- 不能宣称报告目录/详情已迁移；当前 provider gate 仍关闭；
- 不能宣称支付、医保、HIS 已开放；支付配置和业务 gate 仍关闭；
- 不能宣称旧服务已具备可恢复的 systemd 发布/回滚；当前观察到的是手工 nohup 进程；
- 不能把公网健康检查 200 当成患者登录、患者切换、预约、报告或费用真机验收。

## 5. 下一步执行顺序

1. 已完成旧 env 文件权限收紧；下一步检查历史读取风险并决定是否轮换秘密。
2. 新 API Redis DB/ACL 隔离已经完成；保留旧 DB1 只读盘点，后续在旧服务替代和秘密轮换窗口再收紧旧 `admin` 权限。
3. 为旧 Python 服务补一个不影响现有端口的 systemd/回滚运行手册，先记录，不直接替换当前进程。
4. 保持新 API 只读能力，继续按患者目录 → 预约历史 → 报告目录 → 门诊费用完成公网与真机证据。
5. 等新的 provider 文档输入后，再冻结报告/病历/文件资源 contract；不根据旧页面猜字段开放写入。
