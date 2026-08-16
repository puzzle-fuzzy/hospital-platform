# 生产新旧服务共存只读审计（2026-08-16）

本文第一部分是 2026-08-16 对生产主机进行 SSH 只读检查后形成的快照。检查使用已经授权的 `ps` 账号，
未向用户、仓库或日志输出/提交任何环境变量秘密值，只提取了连接目标和开关元数据；初始快照阶段未删除 Redis key、
未执行 Redis flush、数据库 migration、写入业务数据、修改 Redis ACL 或重启服务。随后在本文件第 2.3 节记录了
经授权执行的 Redis 会话隔离和新 API 单服务重启。key 数量、进程号、连接状态会变化，不能当作永久配置。

## 1. 当前运行拓扑

| 项目 | 只读观察结果 | 迁移判断 |
| --- | --- | --- |
| 新 API | `hospital-platform-api-v2.service` active；生产模式；监听 `10.0.0.3:18081`；当前 release 为 `ca3a877` | 新 API 进程本身已由 systemd 管理 |
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
