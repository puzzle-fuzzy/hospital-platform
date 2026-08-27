> 当前配套小程序运行包来源（2026-08-27）：`34f0fd21aac33214e991de561d37dfd7071013bf`（`34f0fd21`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# `13f597e` 真机三层业务验收执行手册（2026-08-24）
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前小程序配套运行包来源（2026-08-27）：`90d8910bdc54d48dde66c4ff03a7434c182ebd92`（`90d8910b`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

> 本手册只用于收集当前候选的业务证据，不会打开支付、医保、退款、预约写入、患者绑定或 HIS 写回。
> 当前服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，小程序运行包来源为
> `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）；两者是服务端独立发布后的有意分层配套。
> 旧二维码、旧开发者工具窗口和旧 release 的日志不能混入本次验收。

## 当前准入基线

| 项目 | 当前值 |
| --- | --- |
| 服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 小程序提交 | `13f597e` |
| 小程序运行包来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 微信开发者工具项目 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 公网 API 前缀 | `https://test-hp.meiyi.pro/api/v2` |
| 新 API 内网监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，本次验收不得修改 |

内部探针必须请求 `http://10.0.0.3:18081/health/ready`；服务进程没有绑定
`127.0.0.1`，因此把 `127.0.0.1:18081` 当成故障会得到误判。公网请求仍使用
`https://test-hp.meiyi.pro/api/v2`，公网网关负责把 `/api/v2` 映射到新 API 的内部 `/api/v1` 路由。

## 真机操作顺序

必须使用一次新的二维码会话，且页面截图、开发者工具 Network/Console 中的客户端 requestId、服务器 Pino 日志来自同一会话。
每一步都先确认上一层成功，再进入下一步；遇到失败只记录失败证据，不连续点击制造无法配对的请求。

1. 微信登录：打开首页，执行静默微信登录，记录登录成功页面和 `POST /api/v2/auth/wechat` 的低敏 requestId。
2. 当前用户：记录首页登录成功后的 `GET /api/v2/me`，只记录状态码、路径和 requestId，不记录响应身份字段。
3. 患者目录：进入首页/选择就诊人页，记录 `GET /api/v2/patients`；点击刷新或同步时再记录 `POST /api/v2/patients/sync`。
4. 显式切换：在选择就诊人页点击另一位已存在患者，返回首页或业务页后确认卡片姓名、脱敏卡号和业务查询都已按新患者刷新。不能只证明本地 storage 的 ID 改变。
5. 我的挂号：分别打开“在线预约”和“全部记录”，再打开“爽约记录”。记录页面空态/列表态和各自的 `/api/v2/appointments/records` requestId；列表为空是业务结果，不得改写成接口失败。
6. 门诊缴费只读：只查看未缴/已缴列表，记录页面结果和 `GET /api/v2/payments/outpatient/records` requestId。点击账单时只能看到“支付流程正在迁移中”等关闭提示，不能调起微信支付。
7. 普通资料：打开“我的”→个人资料，记录 GET；只有在确认可使用测试资料时才执行 PUT 更新。生产真实身份资料没有得到明确授权时，不执行写入，只将该域记为 pending。

当前不执行：报告详情、患者新增/绑定、预约下单/取消、微信支付、医保授权/结算、退款、HIS 写回和 Worker。
这些入口即使页面存在，也必须保持关闭或明确提示，不能用 `200` 的健康检查替代业务契约。

## 三层证据填写规则

每个业务域在 [`device-evidence-audit.mjs`](../../tools/device-evidence-audit.mjs) 中必须是 `pending`、`passed` 或 `failed`：

- `page`：页面截图为 `true`，填写观察时间和低敏可复核摘要；不得写姓名、身份证、卡号、openid 或完整手机号。
- `client`：填写无查询参数的公共路径、HTTP 方法、状态码和 requestId。查询参数中的患者标识和日期不能复制到文档。
- `server`：填写对应日志 contract 的 `businessDomain`、`auditPassed`、`requested/succeeded/http2xx/failed` 和两条链的 SHA-256 `correlationFingerprint`。不要复制 Provider 原始报文。
- `providerRequestId`：只保留低敏 requestId；如果该域没有 Provider 请求，写“不适用”，不要填身份证、卡号或会话凭证。

预约目录和普通资料是双请求域：科室/排班、资料 GET/PUT 必须使用不同 requestId 和不同服务端关联指纹，否则审计器会拒绝。患者同步必须同时能对上同步操作事件和最终目录读取事件。

## 日志取证

服务器上只读查看当前新 API 的低敏日志，建议按真机操作前后时间窗口筛选：

```sh
journalctl -u hospital-platform-api-v2.service --since "开始时间" --until "结束时间" --no-pager
```

只复制 `event`、`method`、无查询参数的 `path`、状态码、`requestId/traceId`、`providerRequestId` 和计数摘要。
不要复制 `Authorization`、微信 code、token、session_key、openid、完整身份证、完整卡号、手机号或 Provider 原始响应。

## 审计与停止条件

将脱敏 JSON 保存为临时文件后执行：

```sh
pnpm device:evidence:audit -- --file <脱敏证据文件>
```

当前可直接复制的 pending 起始清单见 [`device-evidence-13f597e-pending.json`](device-evidence-13f597e-pending.json)；其中服务端字段绑定
`8eb51b5ffe85b0b8f8a032783f893117d3df549d`，小程序字段绑定 `13f597e`。
它只能帮助开始记录，审计结果仍会是未完成；只有所有 P0 域都具备三层 `passed` 证据，才允许把真机验收标记为通过。

以下任一情况必须停止并回退到“待处理”，不能通过猜测修复：来源指纹不一致、服务端日志找不到同一 requestId、患者切换后仍展示旧业务数据、Provider 返回未冻结字段/状态、
依赖暂不可用、出现支付/医保请求，或无法完成敏感字段脱敏。线上异常只允许重启新 API 或回滚新 API release，旧 Python `8001`、MySQL schema 和 Redis 数据不得改动。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> 当前统一发布基线补充（2026-08-27 13:12 CST）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `90d8910bdc54d48dde66c4ff03a7434c182ebd92`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
