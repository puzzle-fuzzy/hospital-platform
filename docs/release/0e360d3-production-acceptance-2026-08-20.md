# `0e360d3` 新 API 生产切换与 `patId` 契约验收

> 本文记录 2026-08-20 `0e360d3` 候选在阿里云中转内网服务器上的真实切换证据。
> 本次只切换新 Bun/Elysia API；旧 Python 服务、旧端口、数据库 schema、Redis namespace、支付、医保和 HIS 均不在变更范围内。
> `patInfosFind.data.patId` 的严格字符串校验已经部署，但没有借此宣称真实患者 Provider 业务或真机业务已完成。

## 1. 版本与共存边界

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 新 API release | `398be8eca74d4f0245b88695056061ac43c7f860` | `0e360d32edcfaa49128a7c29aaa4947cf739e090` |
| 新 API 监听 | `10.0.0.3:18081` | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` | `0.0.0.0:8001` |
| 旧 Python Gunicorn master | `3687390`，启动于 `2026-08-19 10:11:47 CST` | PID 和启动时间未变化 |
| 旧 Python workers | `3687419`、`3687420`、`3687421`、`3687422` | PID 均仍存活，未重启 |
| Worker unit | `inactive` | 未启动 |
| 配套小程序 | 本地 `e050fa0`（切换时的历史候选） | 仍未上传线上；当前验收候选见下方说明 |

切换只使用 `current.next -> current` 同目录原子替换，并只重启
`hospital-platform-api-v2.service`。旧 Python `8001` 没有停止、重启或改代码。

## 2. 候选门禁

本地 `pnpm check` 通过，包含架构边界、迁移台账、Provider intake、文档链接、发布基线、Biome、工具测试、
9 个工作区类型检查/测试/构建。最终 API 测试为 `182 pass / 0 fail / 768 expect`，工具测试为
`30 pass / 0 fail / 84 expect`。

候选上传后，服务器使用真实 `shared/api.env` 执行 production preflight，结果为：

- `environment=production`；
- MySQL、Redis、schema 均通过；schema 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用依赖为 `configured`；
- 微信支付、报告目录和报告详情仍为 `disabled`。

候选 8 个运行产物上传后与本地产物 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `ac4ccfd510c65fbf450e6fc8702cc9d930ead5bd4783c510d594be81402a7865` |
| `apps/worker/dist/index.js` | `67fec8390861f0a5cf6e0ab4276a4c72d731344251c1899d478c25b22807272b` |
| `apps/worker/dist/preflight.js` | `b50cfe34cef3d2da87849215327905af9fccd77fbc17fafb2f8c0fa3532edbe0` |
| `apps/worker/dist/provider-directory-smoke.js` | `4a81529fc2bf8a1e8cf157d3d1d13fc388c62b6e302dbc96db21b404ecc6de6b` |
| `apps/worker/dist/api-runtime-smoke.js` | `694e66ddeebaa7bdda3b1abf5db42d6b4723a4c328dcb8d702d7ccb8a20e037a` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008a3ea05133767c077246ecd5c5de000ca5fea0307a1920b36276da` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `d9105036e23b1807a7a0503c589ea9bbdba5938d9dfa9218ddd15021fa7f3771` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `8ee598fa54fd9f8cbcb752043a2ac1d85bc7decd88f9f8971d7a44a0eb79ccdb` |

> 上表中的哈希已经按本次 `Get-FileHash` 与服务器 `sha256sum` 的原始结果记录；后续重新构建时必须重新核对，不能凭历史值继续发布。

候选在 `127.0.0.1:18082` 以 production env 隔离启动，live、ready 连续 `3/3`、system ping 和未登录认证边界均通过；
候选完成后，临时进程已定向回收，`18082` 无残留监听。隔离 smoke 没有调用 Provider 或写入业务数据。

## 3. 切换后运行验收

切换后取得的结果：

| 检查项 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/0e360d32edcfaa49128a7c29aaa4947cf739e090` |
| systemd API | `active` |
| 内网 `/health/ready` | `200`，database/redis/schema 均 `ok` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均 `ok` |
| 公网 runtime smoke | live `200`、ready `6/6`、system ping `200`、认证边界 `401` |
| 旧 Python `8001` | 持续监听，master/worker PID 未变化 |
| 新 API 启动模式 | journald 明确记录 `environment=production`、`runtimeMode=production` |
| 临时端口 `18082` | 已释放 |

切换过程中第一次保护性后检查把执行命令自身误匹配为旧 Python PID，触发了仅针对新 API 的自动回滚；随后修正为固定
Gunicorn PID 与 master 启动时间校验，再次切换成功。两次保护性回滚/切换都没有停止或重启旧 Python，最终 current 为本记录的
`0e360d3`。

公网 smoke 后对新 API journald 做低敏聚合：`parseErrors=0`、`systemdWarningCount=0`，HTTP 完成请求为 `17` 条，
其中 `200` 为 `17` 条；`401` 为未登录受保护路由的预期拒绝。业务域没有微信登录、患者、预约、报告、门诊费用、支付或医保事件。

## 4. 业务范围与停止条件

本次发布只收紧众阳患者档案引用的输入契约：`patInfosFind.data.patId` 必须是字符串，数字或其他类型 fail-closed；
它仍然是服务端内部临床映射引用，不会下发给小程序，也不改变二维码编号、微信身份或患者绑定流程。

本次没有进行以下操作：

- 没有主动调用众阳患者、预约、报告或门诊费用 Provider；
- 没有执行患者新增、绑卡、预约写入、取消、支付、医保授权/结算、退款或 HIS 回写；
- 没有启动支付/补偿 Worker；
- 没有执行数据库 migration、清理 Redis 或修改旧 Python 项目。

## 5. 回滚边界与下一步

若新 API readiness、公网路径或后续业务只读验收出现无法解释的异常，只将 `current` 原子切回
`releases/398be8eca74d4f0245b88695056061ac43c7f860` 并只重启新 API；旧 Python `8001` 不参与回滚。

后续真机验收应使用当前候选 `0dccf54`（完整来源
`0dccf545ef65a905b58a27f38e787daea250fa54`），而不是本次切换时尚未包含后续会话代际修正的历史候选；候选记录见
[`candidate-0dccf54-local-build-2026-08-20.md`](candidate-0dccf54-local-build-2026-08-20.md)。在真实微信会话下继续取得患者目录、显式患者切换、
预约历史和门诊费用只读的页面、HTTP、Provider/日志三层证据。支付、医保、HIS、报告和写入能力继续保持最后专项处理。
