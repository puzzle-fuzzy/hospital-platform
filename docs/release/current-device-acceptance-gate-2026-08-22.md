# 当前真机准入记录（2026-08-22）

> 当前完整小程序来源校验值：`a33416d8417661fa5256deb22df55a97456cc608`；当前服务端已验证 release：`9f479c9a`。

## 当前候选覆盖（2026-08-22）

后续真机验收只接受小程序源码/运行包来源 `a33416d8417661fa5256deb22df55a97456cc608`，服务端配套基线为
`9f479c9a`。前文 `b0e0935`、`4e1b2e2` 和 `7181e99e` 的具体时间段均为历史证据，
不覆盖本节当前事实。

当前 `dist/build-info.json` 已验证为 `a33416d8417661fa5256deb22df55a97456cc608`，14 个页面齐全，运行包没有
`*.test.js`/`*.spec.js`。开发者工具中仍需关闭旧“真机调试”会话、清理编译缓存、普通编译并重新生成二维码；当前尚无手机页面与
服务端同链业务证据，不能标记真机验收完成。

## 历史：2026-08-22 08:08 CST `9eb672b1` 候选运行包恢复

当时服务端已部署 `9f479c9a`，小程序运行包来源为
`9eb672b1296f282fc536f72bb897631683e4532f`。针对再次出现的 `dist/services/single-flight.test.js` ENOENT，
已重新执行小程序构建和 `runtime:verify`：`single-flight.js` 存在，测试 JS 数量为 0，14 个页面入口齐全。
随后通过微信开发者工具 CLI 关闭项目、清理该项目 compile 缓存并重新打开正确的
`E:\__Super_Core__\hospital-platform\apps\miniprogram` 项目；下一步必须普通编译并生成新二维码。

该动作只处理开发者工具的旧增量索引，不把测试文件复制进 `dist/`，不计入微信登录、患者、预约或 Provider 业务成功。
旧 Python `8001`、数据库、Redis 和 Provider 未因本次小程序恢复而修改。

## 结论

当前新项目的代码、构建产物和仓库门禁均通过；真机业务验收仍未开始。原因不是运行包缺文件，而是桌面上的微信开发者工具会自动恢复旧项目 `mp-weixin`，不能把旧项目模拟器、旧控制台或旧网络请求当作新项目证据。

本记录只描述新项目的当前准入边界，不修改旧 Python 项目，不重启旧服务，也不把旧项目的业务日志并入新项目证据。

## 2026-08-22 06:30–06:43 CST 当前候选再次复核

针对 `dist/services/single-flight.test.js` 的真机调试错误，当前候选再次完成构建、运行包校验和全仓门禁：

- `pnpm check` 通过：架构规则 67 条、API 测试 `206 pass / 0 fail`、工具测试 `51 pass / 0 fail`，9 个 workspace 的 typecheck/test/build 全部通过；
- 小程序来源仍为 `4e1b2e224964797c103eba832323ee7074c7ad2b`，注册页面 14 个，`dist/` 中测试运行脚本数量为 0；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过；
- 新 `miniprogram` 项目窗口仍指向 `apps/miniprogram/dist/`，普通编译完成，当前二维码界面显示有效至 `2026-08-22 06:56 CST`；
- 旧 `mp-weixin` 窗口未操作，线上服务、旧 Python 服务、数据库、Redis 和 Provider 均未触碰。

这次复核只证明运行包可以进入真机验收，仍没有手机扫码、微信会话、患者切换或 Provider 业务日志，因此不增加任何业务完成声明。下一步仍是使用当前二维码扫码，随后按“微信登录 → 患者目录 → 显式切换 → 预约/报告/门诊费用只读”的顺序采集页面、客户端请求和服务端同链日志。

## 2026-08-22 06:54 CST 当前新二维码

在新项目 `miniprogram` 窗口中重新打开“真机调试”，已生成新的 iOS 局域网二维码：

- 代码包约 `619 KB`，来源仍为 `4e1b2e224964797c103eba832323ee7074c7ad2b`；
- 二维码界面显示有效至 `2026-08-22 07:19 CST`；
- 开发者工具当前显示业务编译 `Errors: 0`，另有 3 个 warning；warning 未被计入业务成功；
- 旧 `mp-weixin` 窗口未操作，未向旧服务发起请求，也未修改旧项目；
- 当前仍没有手机扫码、客户端 `/api/v2/` 请求或新增服务端业务链，因此仍处于“等待真机扫码”状态。

扫码后必须先记录微信登录和患者目录的请求/响应，再进行显式患者切换；预约、报告和门诊费用只允许按只读顺序验收。不要继续使用已经过期的二维码，也不要把模拟器页面或历史日志当作当前真机证据。

## 2026-08-22 06:55 CST 全量门禁复核

在当前工作树再次执行 `pnpm check`，所有代码、契约、日志和构建门禁均通过：

- 架构边界 67 条、14 页迁移台账、Provider 文档接收审计、459 个 Markdown 链接和 81 个静态日志事件全部通过；
- 发布基线仍为服务端 `7181e99e3a352244102f5591279528b3b66332c9`、小程序来源
  `4e1b2e224964797c103eba832323ee7074c7ad2b`；
- 工具测试 `51 pass / 0 fail`，9 个 workspace 的 typecheck/test/build 全部通过，API 测试 `206 pass / 0 fail / 849 expects`；
- 小程序构建再次原子发布完整 `dist/`，14 个页面脚本齐全，测试运行脚本仍为 0；
- 开发者工具仍显示 `Errors: 0`、`Warnings: 3`，二维码仍对应当前来源并显示有效至 `07:19 CST`。

本轮只重新验证仓库和运行包，没有改变旧服务、数据库、Redis、Provider 或任何业务数据；当前仍没有手机扫码、微信会话、客户端请求或真机页面证据。全量门禁通过不能替代真机验收，也不能提前打开预约写入、病历、患者绑定、二维码、支付、医保或 HIS 回写。

## 2026-08-22 06:44–06:45 CST 线上只读探针

本轮尝试通过现有 SSH 检查入口读取 `ps@192.168.112.172` 时返回 `Permission denied (publickey,password)`；因此没有把新 API、旧 Python `8001`、Worker 或 journald 状态写成已确认事实，也没有修改 SSH 配置。

公网只读探针结果如下：

- `/api/v2/health/live`：HTTP `200`；
- `/api/v2/health/ready`：HTTP `200`，`database`、`redis`、`schema` 均为 `ok`；
- `/api/v2/system/ping`：HTTP `200`；
- `/api/v2/patients`（无 Bearer）：HTTP `401`，错误码 `unauthorized`。

这些结果只证明公网运行层健康和未登录鉴权边界，不包含微信会话、患者目录、Provider、旧服务日志或真机业务证据；探针没有写入 MySQL/Redis，也没有调用 Provider。后续需先恢复只读 SSH 检查入口，再配对手机扫码产生的页面、客户端请求和服务端日志。

## 2026-08-22 06:46–06:48 CST SSH 恢复后的服务端业务证据

交互式 SSH 只读检查已恢复。本次快照确认新 API `hospital-platform-api-v2.service` 为 `active`，运行代码目录对应当前
`7181e99e...` release，监听 `10.0.0.3:18081`；旧 Gunicorn Python 服务仍监听 `0.0.0.0:8001`，Worker 仍为 `inactive`。
新旧服务同时存在，本次没有重启任何服务。

对新 API journald 从 `2026-08-22 06:00 CST` 起导出 JSONL，并只在服务器上通过 P0 聚合器和业务证据门禁处理，未把原始日志带回本地：

| 服务端业务域 | requested | 明确成功 | 同链 HTTP 2xx | 结果 |
| --- | ---: | ---: | ---: | --- |
| 微信登录 | 1 | 1 | 1 | 通过服务端门禁 |
| 患者目录读取 | 4 | 4 | 4 | 通过服务端门禁 |
| 患者目录同步 | 2 | 2 | 2 | 通过服务端门禁 |

该窗口聚合 `parseErrors=0`、`systemdWarningCount=0`，没有预约历史、预约目录、报告或门诊费用事件。以上是服务端同链证据，不能单独证明手机页面已显示正确结果；完整真机验收仍需配对手机页面截图/操作、客户端 `/api/v2/` 请求和对应服务端 trace。支付、医保、HIS、预约写入继续关闭。

## 当前发布基线

| 项目 | 当前值 |
| --- | --- |
| 服务端生产 release | `7181e99e3a352244102f5591279528b3b66332c9` |
| 小程序运行包来源 | `4e1b2e224964797c103eba832323ee7074c7ad2b` |
| 小程序短提交 | `4e1b2e2` |
| 小程序运行根目录 | `apps/miniprogram/dist/` |
| 注册页面数 | 14 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |

上述基线由 `pnpm release:baseline:audit` 和 `pnpm --filter @hospital/miniprogram runtime:verify` 共同校验；不能只凭开发者工具标题或模拟器画面判断来源。

## 本轮门禁结果

在仓库根目录 `E:\__Super_Core__\hospital-platform` 执行 `pnpm check`，结果为通过：

- 架构边界审计通过，共 67 条规则；
- 14 页迁移台账、Provider 文档接收审计和 Markdown 链接审计通过；
- 发布基线与当前服务端/小程序来源一致；
- Biome 格式检查和 lint 通过；
- 9 个 workspace 包 typecheck/test/build 全部通过；
- API 测试 206 pass、0 fail；
- 小程序构建再次生成完整 `dist/`，并通过运行时页面清单门禁。

这些结果只证明代码和运行包候选可进入验收，不证明微信登录、患者切换、预约、报告或门诊费用已经在真机完成。

## `single-flight.test.js` 错误的固定处理

`src/services/single-flight.test.ts` 是测试输入，不能复制到 `dist/`。构建脚本会在 TypeScript 编译配置和最终文件清单两层排除测试脚本；若真机错误仍指向
`dist/services/single-flight.test.js`，说明开发者工具或旧真机调试会话保留了旧增量模块索引。

正确处理顺序是：

1. 结束旧真机调试会话；
2. 关闭开发者工具当前项目或清理其编译/文件缓存；
3. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不能打开 `dist` 或 `src`；
4. 普通编译后确认项目配置的 `miniprogramRoot` 仍为 `dist/`；
5. 再生成二维码并开始真机验收。

禁止手工新增 `dist/services/single-flight.test.js`，否则会把测试代码混入运行包，并掩盖开发者工具来源错配。

本次重新加载新项目时还发现过 `module 'services/@hospital/contracts.js' is not defined`：这是微信运行时不解析
pnpm workspace 裸模块名造成的真实运行包问题，已在前一候选 `47be0bc` 中改为小程序本地的无第三方依赖时间校验模块，
并增加了与共享契约边界一致性的测试。当前重新编译后的控制台不再出现该错误；不能通过向 `dist/` 手工复制 workspace 包来规避。

## 2026-08-22 05:50 CST `single-flight.test.js` 复核后的新二维码

针对真机再次报告的 `E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js`，
本地重新执行 `pnpm --filter @hospital/miniprogram build` 和 `pnpm --filter @hospital/miniprogram runtime:verify`：

- 构建和运行包门禁通过，当前来源仍为 `4e1b2e224964797c103eba832323ee7074c7ad2b`；
- `dist/services/single-flight.js` 存在，`dist/services/single-flight.test.js` 不存在；
- `dist/` 递归扫描仍为 0 个 `*.test.js` / `*.spec.js`；
- 新项目 `miniprogram` 窗口重新完成普通编译，并重新生成代码包约 `619 KB` 的真机调试二维码，界面显示有效至
  `2026-08-22 06:15 CST`；调试器显示 `Errors: 0`，没有出现测试脚本或 workspace 裸模块错误。

当前仍没有手机扫码连接或业务请求三层证据。这一步只证明旧增量模块索引已经被新编译会话替换；请使用这张新二维码扫码，
不要继续复用旧二维码，也不要把 `single-flight.test.js` 手工复制进运行包。

## 2026-08-22 05:43 CST 真机扫码前复核

通过桌面只读核对目标开发者工具窗口：窗口标题为 `miniprogram - 微信开发者工具 Stable v2.01.2510290`，资源树根节点为
`MINIPROGRAM`，当前模拟器路径为 `pages/index/index`，最新二维码界面显示代码包约 `619 KB`、有效至 `2026-08-22 06:11 CST`。
调试器显示 `Errors: 0`；仍有 4 个 Warning，未将其计为业务成功。旧 `mp-weixin` 窗口未操作，二维码内容未保存。

这只是新项目的扫码前置证据，不是手机真机证据；仍需用户用手机扫码后，逐项保存页面、客户端 `/api/v2/` 请求和服务端低敏同链日志。

## 2026-08-22 03:48 CST 线上只读窗口

通过 SSH 只读核对当前运行边界：新 API `hospital-platform-api-v2.service` 为 `active`，监听
`10.0.0.3:18081`；旧 Python 服务继续监听 `0.0.0.0:8001`；新 Worker 保持 `inactive`。随后查询新 API
最近 30 分钟的 journald，仅按 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*`、`profile.*`、
`report.*` 和 `http.request.*` 业务事件筛选，没有发现新的业务请求事件。

这个窗口只能证明“当前没有新的业务流量”和新旧监听仍共存，不能证明微信登录、患者切换或只读页面成功；下一次
必须从当前 `4e1b2e2` 运行包重新普通编译、扫码，并保存页面、客户端 HTTP 和服务端同链日志三层证据。此次检查
没有修改旧 Python、没有重启旧服务、没有写入 MySQL/Redis，也没有调用 Provider。

## 2026-08-22 04:02 CST 本机新项目窗口复核

使用只读桌面窗口检查确认：微信开发者工具中存在两个项目窗口，目标窗口标题为
`miniprogram - 微信开发者工具 Stable v2.01.2510290`，资源树根节点为 `MINIPROGRAM`，同时可见
`dist/`、`src/` 和 `project.config.json`；另一个 `mp-weixin` 窗口本轮没有操作。目标窗口的模拟器路径为
`pages/index/index`，未出现页面脚本缺失、`single-flight.test.js` 或 workspace 裸模块错误，首页视觉上已加载
患者卡、医疗服务入口、三组业务分类和固定底部导航。

同一时刻控制台出现一次未登录状态下的 `GET https://test-hp.meiyi.pro/api/v2/me 401`，但截图中仍能看到患者姓名和
脱敏卡号。当前客户端对 GET 读取允许一次受控恢复：第一次 401 会触发 `wx.login()`，随后用新会话重试；如果最终
重试返回 200，控制台保留第一次 401、首页显示恢复后的患者是正常现象。反之，只有最终重试仍为 401、登录恢复失败，
或页面在没有最终成功链时继续展示患者，才属于会话清理问题。当前截图没有配套的最终 HTTP 链和服务端日志，不能把
这张患者卡单独解释为登录成功，本条证据标记为 `待清洁重载/真机复核`，不计入微信登录或患者同步成功。

后续清洁复核应由验收人员关闭当前真机调试、重新普通编译并从当前运行包扫码；如仍出现“401 与患者卡同时存在”，
再保存同一时刻的页面、网络和服务端 trace，才能判断是页面生命周期竞态。此次没有自动清除本地小程序数据，
避免未经确认删除用户的本地会话/选择状态；旧项目、旧服务、数据库和 Redis 均未修改。

## 2026-08-22 04:14 CST 当前候选二维码

在目标 `miniprogram` 窗口中重新执行普通编译后，构建面板显示 14 个页面编译成功，开发者工具生成了新的二维码真机调试会话。
当时运行包大小约为 `619 KB`，二维码界面显示有效期至 `2026-08-22 04:38 CST`；运行包来源仍为
`90fd7832e3ad1031c9c916f118f90cc0f2840aff`，项目根目录仍为 `apps/miniprogram/`，运行根目录为 `dist/`。

这一步只证明“当前候选已经编译并生成可扫码会话”，尚未证明微信登录、患者同步或任何业务请求成功。二维码需要由验收人员使用真机扫码；
扫码后应先保存首页最终状态，再按登录 → 患者目录 → 显式切换 → 预约历史/费用的顺序操作，并配对客户端请求与服务端日志。
本次没有操作旧 `mp-weixin` 窗口，没有清除小程序本地数据，也没有修改旧服务、数据库或 Redis。

## 2026-08-22 04:18 CST 公网只读探针复核

从本地对当前公网地址执行了三项只读请求：`/api/v2/health/live`、`/api/v2/health/ready` 和
`/api/v2/system/ping` 均返回 HTTP 200；ready 响应中的 `database`、`redis` 和 `schema` 均为 `ok`。
这只能证明新 API 的公网健康入口可达，不能证明微信会话、患者同步、Provider 业务或真机页面成功。

同一窗口使用现有 SSH 检查密钥访问 `ps@192.168.112.172` 被服务器返回 `Permission denied (publickey,password)`。
因此本次没有把新服务 systemd 状态、旧 Python `8001` 监听/PID、Worker 状态或 journald 业务日志写成已确认事实；
也没有重试写入、重启服务、调用 Provider、修改数据库或 Redis。待用户恢复该 SSH 检查入口后，再补做线上进程共存和
业务日志三层关联复核。

## 2026-08-22 04:20 CST SSH 只读运行层复核

SSH 检查入口已恢复。本次只读快照确认：当前新服务 release 为
`84fac75ceeb2247b252cf7e160eedbda220378f8`，`hospital-platform-api-v2.service` 为 `active`，主进程为 Bun
PID `2765512`，监听 `10.0.0.3:18081`；Worker 为 `inactive`。在绑定地址请求 `/health/ready` 返回 200，
MySQL、Redis 和 schema 均为 `ok`。`127.0.0.1:18081` 不接受连接是因为新 API 没有绑定 loopback，而不是 readiness 失败。

旧 Python 服务没有名为 `hospital-backend.service` 的当前 systemd unit，但 Gunicorn 主进程 PID `3687390` 及四个
worker（`3687419`–`3687422`）仍监听 `0.0.0.0:8001`；主进程自 `2026-08-19 10:11:47` 由 PID 1 托管。
这证明本次快照中新旧监听同时存在，但不替代连续 PID 变化记录，也不证明旧 Python 的每个业务接口均正常。

最近两小时新 API journald 仅筛到健康探针 `http.request.completed`，没有新的 `auth.*`、`patient.*`、
`appointment.*`、`outpatient.payment.*`、`report.*` 或 `profile.*` 业务事件，因此仍没有真机业务流量证据。
本次没有重启、写数据库/Redis、调用 Provider 或修改旧 Python。

## 2026-08-22 04:22 CST 公网鉴权前置烟测

对当前公网 `/api/v2` 入口执行无 Bearer 的只读/无副作用请求：`/me`、`/me/profile`、`/patients`、预约历史、
报告目录、门诊费用和 `POST /patients/sync` 均返回 HTTP 401。患者同步请求虽然带了临时幂等键和空 JSON，仍在
会话鉴权阶段结束，没有触发 Provider、MySQL 业务写入或 Redis 会话创建。这只证明认证前置和未登录错误边界，
不证明登录、患者同步或任何已登录业务成功。

## 2026-08-22 04:25 CST 模拟器页面结构复核

在目标 `miniprogram` 开发者工具窗口中只读检查了 `pages/my/my` 和
`pages/appointment-records/appointment-records`：前者保留旧端顶部背景、头像/用户行、家庭成员管理蓝卡、三组
“我的订单”分类、旧图标顺序和固定底部导航；后者进入独立“我的挂号”页面，显示就诊人及脱敏卡号、当前院区、在线/全部
挂号切换和“暂无挂号记录”空态，同时保留“更换就诊人”入口。页面结构与旧端 `userNavData.json`、挂号入口的迁移矩阵一致。

本次只证明当前运行包在模拟器中的结构和视觉映射；开发者工具仍可能保留本地会话/患者展示状态，未把该窗口计入微信登录、
患者同步或多患者切换的真机证据，也没有清除本地数据或修改运行包。

## 2026-08-22 04:28 CST 预约历史业务逻辑复核

预约历史只读链路已按当前 contract 重新核对：服务端固定使用已确认的微信在线渠道 `requestChannel=3`，未知查询字段（包括
未来可能误传的渠道 4）会在 Provider 前拒绝；预约历史使用中国标准时间当前日前后各 90 天，爽约筛选使用过去 90 天，不能把
空结果、未知状态或 Provider 异常推断成“没有爽约”。服务端对患者映射、日期窗口、状态、时间段、数组数量和公共字段做二次校验，
坏记录整批 fail-closed；小程序只展示服务端明确归一化的 `missed`，并用患者/会话代际和渲染批次 key 阻断旧请求与旧事件回写。

本次定向回归全部通过：domain/date `5 pass`、API appointment service `25 pass`、小程序预约记录/时间/查询 `30 pass`，
共 `60 pass / 0 fail`。当前仍不开放“全部挂号”渠道 4、详情、取消、预问诊写入和支付；本轮没有调用真实 Provider、没有改旧项目，
也没有产生线上业务数据，因此仍需真机三层证据验证正常结果和真实失败链。

## 2026-08-22 04:32 CST `single-flight.test.js` ENOENT 恢复复核

针对真机再次报告的
`E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js`，先重新执行构建和运行包门禁：

- `pnpm --filter @hospital/miniprogram build` 通过，当前运行包来源为
  `90fd7832e3ad1031c9c916f118f90cc0f2840aff`；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面入口齐全；
- `dist/services/single-flight.js` 存在，`dist/services/single-flight.test.js` 不存在；
- `dist/` 递归扫描没有任何 `*.test.js` 或 `*.spec.js`，符合测试代码与微信运行包隔离边界。

随后只关闭并重新打开新的 `miniprogram` 项目窗口，旧 `mp-weixin` 窗口未操作；重新普通编译后，模拟器首页正常加载，
开发者工具调试器显示 `Errors: 0`。CLI 打开项目时额外打印的 `TypeError: d.on is not a function` 是该版本工具的已知打开项目提示，
窗口实际已成功载入新项目，不能据此把测试脚本加入 `dist/`。

本次已从重新编译后的运行包生成新的二维码，代码包约 `619 KB`，有效期至 `2026-08-22 04:57 CST`。当前只证明旧增量索引已被
重新建立，尚未计入微信真机登录或业务成功证据；真机必须扫描这张新二维码，不能继续复用此前二维码。旧项目、旧服务、数据库、Redis
和 Provider 均未修改。

## 2026-08-22 04:35 CST 门诊费用只读链路审计

当前门诊费用链路继续保持只读边界：服务端固定使用 `Asia/Shanghai` 最近 30 个自然日，患者映射必须是当前 owner
下的 `referenceKind=his-patient`；`unpaid` 和 `paid` 是两个独立查询状态，未知状态不会降级为已缴费。众阳 adapter
只接受已确认的 `amount` 字段并精确转换为人民币分，只把 Provider `tradeStatus=1/3` 映射为公共状态；缺少金额、错状态、
重复费用标识、窗口外账单、非法日期或异常包络均整批拒绝，不会把 Provider 故障伪装成空列表。API 日志只保留 owner 内部
患者标识、状态、数量、trace 和固定失败原因，不记录 Provider 原文、完整患者号或金额明细。

小程序费用页在请求前重新确认 `/me`、患者目录、显式选择和会话代际；状态切换使用点击时的状态快照，旧患者/旧批次事件
无法回写当前页面。页面的“加载更多”只展开本次完整只读结果，不宣称 Provider 分页；费用卡片点击目前只显示迁移提示，
不调用 `wx.requestPayment`，不发起医保授权，也不写入结算状态。

本轮定向回归：领域 `3 pass`、众阳 adapter `18 pass`、API service `15 pass`、小程序 dashboard/API/验收测试 `145 pass`，
共 `181 pass / 0 fail`。本轮没有调用真实 Provider、没有写数据库/Redis、没有修改旧服务，因此只证明当前代码和错误边界，
不能替代当前 release 的公网、服务端日志、Provider 和真机四层业务证据。费用明细、支付、医保授权、结算回写和退费继续保持最后专项。

## 2026-08-22 04:39 CST 报告目录与详情引用边界复核

报告目录服务端固定使用中国标准时间最近 30 天窗口，先通过 owner-scoped 患者映射取得 `his-patient` 引用，再访问众阳
LIS/PACS/ECG 只读目录；未指定来源时三路 Provider 必须全部成功，不能把部分成功伪装成完整目录。服务端对来源、日期、
报告状态、附件标记、Provider 报告号、目录数量和响应 trace 做运行时白名单校验，坏记录整批拒绝；PACS/ECG 当前不生成详情引用，
只有经过独立 gate 的 LIS 详情才允许使用短期 opaque `reportId`。

本轮发现并修复一个跨层时间边界缺口：报告引用仓储返回值此前只校验自身 TTL 不超过硬上限，没有确认 `createdAt/expiresAt`
仍等于本次服务端生成的 10 分钟窗口。现在 owner、patient、Provider 报告号和两个时间字段都必须与输入完全一致，否则隐藏详情入口、
保留安全目录摘要并记录低敏告警；报告详情读取仍按 owner + patient + reportId + TTL 查询，错范围引用不会访问 Provider。

新增回归测试覆盖“仓储将完整引用窗口整体平移 30 分钟但自身仍保持 10 分钟 TTL”的情况；API 全量测试 `206 pass / 0 fail`，
报告领域/adapter/service 定向测试 `46 pass / 0 fail`，小程序 API/页面验收测试保持通过。本轮没有调用真实报告 Provider、没有写数据库/Redis、
没有修改旧项目；报告目录/详情的公网、Provider、日志和真机证据仍未完成，附件下载、影像详情、体检报告、报告解读继续关闭。

## 当前未形成的证据

当前没有以下新项目三层证据：

- 微信登录请求、会话签发、患者目录同步的同链服务端日志；
- 多就诊人切换和会话漂移后的页面证据；
- 预约目录/历史、报告目录、门诊费用的真实 Provider 请求号和真机结果；
- 支付、医保、HIS 写回等副作用证据。

## 双请求证据独立性门禁

普通资料和预约目录的真机清单现在还要求两条客户端请求使用不同的
`requestId/traceId`，两条服务端摘要使用不同的 `correlationFingerprint`，避免把同一条链复制成双请求成功。
规则和回归证据见 [`device-evidence-distinct-chain-audit-2026-08-22.md`](device-evidence-distinct-chain-audit-2026-08-22.md)。

## 2026-08-22 `7181e99e` 切换后观察

最新生产切换已从 `84fac75c` 原子切换到 `7181e99e`，只重启新 API；旧 Python `8001` 仍保持监听，
Worker 保持 inactive。生产 preflight、隔离 runtime smoke、bundle checksum、公网 live/ready/system-ping
和未登录认证边界均通过，启动日志明确为 production，数据库/Redis/schema 均为 `ok`。完整切换证据见
[`7181e99e-production-acceptance-2026-08-22.md`](7181e99e-production-acceptance-2026-08-22.md)。

本节仍只证明运行层，尚无新的真机微信、患者切换、预约、报告或门诊费用业务事件；支付、医保和 HIS 写回继续关闭。

## 历史：2026-08-22 04:44–04:50 CST `84fac75c` 切换后观察

新 API 已从 `002acc1b` 原子切换到 `84fac75c`，仅重启 `hospital-platform-api-v2.service`；旧 Python `8001` 保持监听，
Worker 保持 inactive。切换后内网和公网 live/ready/system-ping 通过，ready 的 MySQL、Redis、schema 均为 `ok`。
低敏日志聚合 `parseErrors=0`、`systemdWarningCount=0`，窗口内没有新的登录、患者、预约、报告、门诊费用或普通资料成功事件。
因此当前仍等待同一二维码的真机三层业务证据，不能把健康探针或未登录 `401` 当作微信登录/患者同步完成。

因此下一步仍应先完成当前候选的真实微信登录和患者切换，再按只读预约、报告、门诊费用顺序验收。支付、医保、退款、预约写入和 HIS 回写继续保持最后专项。

