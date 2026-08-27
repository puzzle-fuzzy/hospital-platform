# 当前项目发布与迁移基线（2026-08-27）

> 本文是新项目当前发布事实的单一阅读入口。本文只描述
> `E:\__Super_Core__\hospital-platform`，不修改、不代表也不替代旧 Python 项目、旧数据库、旧 Redis 或旧进程。
> 其它文档中的较早“当前”措辞均属于当时窗口的历史快照；需要判断现在能否继续验收时，以本文、仓库门禁和现场证据为准。

## 1. 当前运行事实

| 项目 | 当前事实 | 不能据此推出 |
| --- | --- | --- |
| 新 API release | `e5d941aef3a8b0d1df24a518bea03f36f2ee505d`（`e5d941ae`） | Provider、微信真机、支付或医保业务已经成功 |
| 新 API 监听 | `10.0.0.3:18081`，systemd `hospital-platform-api-v2.service=active` | 旧服务已被替换 |
| 旧 Python 服务 | `0.0.0.0:8001`，继续共存 | 新 API 与旧 API 使用相同业务实现 |
| Worker | `hospital-platform-worker-v2.service=inactive` | 支付、医保或 HIS 回写已经执行 |
| 生产依赖 | MySQL、Redis、schema probe 均为 `ok` | 业务 Provider 字段或业务状态一定正确 |
| 当前微信线上小程序 | 历史运行包 `13f597e` | 可以拿线上历史包证明本地候选真机结果 |
| 当前本地 live 小程序 | `0be59f966de2c3a0861cb44e9a526a1ef557f6c7`（`0be59f96`），40 个页面 | 微信线上版本已经上传或真机已经加载 |
| live 目录 | `apps/miniprogram/dist/`，`runtime:verify` 已通过，发布后无 pending 目录 | 开发者工具一定已经重新编译当前目录 |

服务端 release 已完成 production preflight、隔离 runtime smoke、原子切换和公网 runtime smoke；
这些是运行层证据。旧 Python `8001` 在切换过程中没有停止、重启或修改。

## 1.1 公网 HTTPS 安全门禁

2026-08-27 只读核对发现，阿里云中转机 `8.130.127.184` 上原来配置的
`test-hp.meiyi.pro` 证书已于 `2026-08-26 23:59:59 GMT` 过期。该问题属于公网中转层，
不是旧 Python 服务或新 Bun 服务的代码问题；证书过期期间，微信真机和小程序网络请求不能视为可验收。

本次已在不停止旧服务的前提下完成修复：

- 通过 Certbot 使用 HTTP-01 临时校验申请新的公开 DV 证书，有效期至 `2026-11-25`。
- Nginx 已改为引用 `/etc/letsencrypt/live/test-hp.meiyi.pro/` 的自动更新路径，旧配置已保留备份。
- 已添加 Certbot deploy hook，续期成功后只执行 Nginx 平滑 reload，不停止旧 Python 进程。
- `nginx -t` 通过，公网无 `-k` TLS 校验返回 `Verify return code: 0`；live、ready、ping 均返回 HTTP 200。
- Certbot 自动续期定时器为 active；证书续期仍需在到期前通过公网无跳过校验复核，不能只看本机文件日期。
- 证书切换后以 `NODE_ENV=production` 运行公网 runtime smoke：live、连续 3 次 ready、system ping、未登录认证边界和关闭边界均通过；服务端 journald 能按同一 `requestId/traceId` 看到 `production` 请求完成/失败事件。

因此，当前 HTTPS 已恢复为可继续验收状态，但这次证书修复只证明传输层恢复，
不增加微信登录、Provider、真机业务或支付/医保证据。后续若证书、域名或 Nginx 转发再次变化，
必须先完成无 `-k` 的 TLS 验证，再生成新的真机证据。

本次运行层 smoke 的证据时间为 `2026-08-27 09:43 CST`。它只覆盖公网传输、路由、依赖就绪、认证拒绝和关闭边界；
没有登录微信、读取患者、访问 Provider 或触碰支付/医保数据，因此不能替代九个真机业务域的三层证据。

## 2. 迁移范围事实

| 范围 | 数量/状态 | 正确解读 |
| --- | --- | --- |
| 旧端页面 | 64 个，全部进入迁移台账 | 入口没有遗漏，不等于 64 个业务完成 |
| 新端页面 | 40 个 TypeScript 原生页面 | 页面落点和事件闭环不等于 Provider 已开放 |
| `replaced` | 8 | 已有原生安全实现，仍需适用的真实证据 |
| `partial` | 23 | 只开放已确认的静态/只读安全子集 |
| `surface-only` | 25 | 只有页面外壳和明确关闭态，不能展示假成功 |
| `blocked-payment` | 7 | 支付、医保、结算或 HIS 写回仍保持关闭 |
| `excluded` | 1 | 明确属于开发辅助入口，不纳入业务迁移 |

当前只读代码域为患者目录、预约目录/历史、报告目录/受限详情、门诊费用只读和普通资料。
所有患者范围读取都必须经过服务端 owner、内部患者引用、会话代际和字段白名单边界；
客户端不能提交 Provider 患者号、卡号、openid 或旧端 URL。

## 3. 当前门禁与未完成项

- `pnpm check` 已通过：架构、迁移台账、边界、契约材料、日志、错误码、发布基线、类型检查、测试和构建均通过。
- 当前小程序回归为 `336 pass / 0 fail / 3697 expect()`；这是代码和运行包证据，不是微信真机业务证据。
- 九个真机证据域仍为 `pending`，见 [`device-evidence-0be59f96-pending.json`](device-evidence-0be59f96-pending.json)。清单结构通过不等于业务通过。
- 健康百科仍等待正式审核 bundle；临床读取、患者绑定/协议同意/撤回/审计、外部会话、物流/采血号源和公开记录仍等待各自 contract。
- 预约写入、取消、费用支付、医保授权/结算、退款和 HIS 回写保持最后处理，不因页面存在或只读列表成功而开放。

## 4. 下一步执行顺序

1. 先执行公网无 `-k` 的 HTTPS live/ready/ping 和证书有效期复核；通过后，有真实开发者工具和手机会话时，只从当前 `apps/miniprogram/dist/` 普通编译并生成二维码，并核对 `build-info.json.sourceRevision` 与本文一致。
2. 按九域清单逐项采集页面截图、客户端 `requestId`、公网 HTTP、服务端 Pino `traceId` 和 Provider 低敏请求号；每个域独立判定，不能用另一个域的成功链拼接。
3. 没有运行中的真机/开发者工具会话时，保持清单 `pending`，只做代码、文档和脱敏审计，不制造“已通过”的证据。
4. 收到正式 Provider 或内容材料后，先登记版本、来源指纹、成功/空/拒绝/超时样例、owner 映射和字段白名单，再分别实现 adapter、domain、API、页面状态机和日志。
5. 最后才进入预约写入、支付、医保、退款和 HIS 回写，并额外提供幂等、最终状态查询、补偿和回滚证据。

## 5. 常用核对命令

```powershell
pnpm migration:readiness
pnpm release:baseline:audit
pnpm device:evidence:audit --file docs/release/device-evidence-0be59f96-pending.json
pnpm check
```

其中真机清单在全部 `pending` 时只能完成结构审计；出现 `passed` 或 `failed` 前，必须先确认当前发布基线仍通过。
