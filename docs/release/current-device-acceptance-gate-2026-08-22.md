# 当前真机准入记录（2026-08-22）

## 结论

当前新项目的代码、构建产物和仓库门禁均通过；真机业务验收仍未开始。原因不是运行包缺文件，而是桌面上的微信开发者工具会自动恢复旧项目 `mp-weixin`，不能把旧项目模拟器、旧控制台或旧网络请求当作新项目证据。

本记录只描述新项目的当前准入边界，不修改旧 Python 项目，不重启旧服务，也不把旧项目的业务日志并入新项目证据。

## 当前发布基线

| 项目 | 当前值 |
| --- | --- |
| 服务端生产 release | `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10` |
| 小程序运行包来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff` |
| 小程序短提交 | `90fd783` |
| 小程序运行根目录 | `apps/miniprogram/dist/` |
| 注册页面数 | 14 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |

上述基线由 `pnpm release:baseline:audit` 和 `pnpm --filter @hospital/miniprogram runtime:verify` 共同校验；不能只凭开发者工具标题或模拟器画面判断来源。

## 本轮门禁结果

在仓库根目录 `E:\__Super_Core__\hospital-platform` 执行 `pnpm check`，结果为通过：

- 架构边界审计通过，共 67 条规则；
- 14 页迁移台账、Provider 文档接收审计和 443 篇 Markdown 链接审计通过；
- 发布基线与当前服务端/小程序来源一致；
- Biome 格式检查和 lint 通过；
- 9 个 workspace 包 typecheck/test/build 全部通过；
- API 测试 204 pass、0 fail；
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

## 2026-08-22 03:48 CST 线上只读窗口

通过 SSH 只读核对当前运行边界：新 API `hospital-platform-api-v2.service` 为 `active`，监听
`10.0.0.3:18081`；旧 Python 服务继续监听 `0.0.0.0:8001`；新 Worker 保持 `inactive`。随后查询新 API
最近 30 分钟的 journald，仅按 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*`、`profile.*`、
`report.*` 和 `http.request.*` 业务事件筛选，没有发现新的业务请求事件。

这个窗口只能证明“当前没有新的业务流量”和新旧监听仍共存，不能证明微信登录、患者切换或只读页面成功；下一次
必须从当前 `90fd783` 运行包重新普通编译、扫码，并保存页面、客户端 HTTP 和服务端同链日志三层证据。此次检查
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
`002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`，`hospital-platform-api-v2.service` 为 `active`，主进程为 Bun
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

## 当前未形成的证据

当前没有以下新项目三层证据：

- 微信登录请求、会话签发、患者目录同步的同链服务端日志；
- 多就诊人切换和会话漂移后的页面证据；
- 预约目录/历史、报告目录、门诊费用的真实 Provider 请求号和真机结果；
- 支付、医保、HIS 写回等副作用证据。

因此下一步仍应先完成当前候选的真实微信登录和患者切换，再按只读预约、报告、门诊费用顺序验收。支付、医保、退款、预约写入和 HIS 回写继续保持最后专项。
