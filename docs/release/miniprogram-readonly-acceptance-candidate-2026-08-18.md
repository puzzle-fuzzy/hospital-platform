# 原生小程序只读业务验收候选（2026-08-18）

本文固定当前真机验收所使用的“客户端候选 + 服务端 release”组合，避免把不同版本的页面、API 和日志混在同一份证据中。
本文只覆盖微信会话、患者目录、预约历史、爽约记录和门诊费用只读查询；预约写入、支付、医保、退款、报告详情和 HIS 继续关闭。

## 1. 当前候选组合

| 层级 | 固定值 | 证据 |
| --- | --- | --- |
| 服务端 release | `b7c9451` | 服务器 `/home/ps/code/hospital-platform/releases/b7c9451` |
| 服务端运行方式 | Bun/Elysia production | `hospital-platform-api-v2.service`，监听 `10.0.0.3:18081` |
| 旧服务 | Python，监听 `0.0.0.0:8001` | 本次验收不得停止、重启或修改 |
| 小程序客户端 | `3a66d12` | 与服务端 `b7c9451` 配套的当前本地验收候选包；本次新增“我的”页会话代际顺序门禁，并阻止无会话继续读取患者 |
| 小程序构建结果 | 14 个页面脚本 | `pnpm --dir apps/miniprogram build`、`runtime:verify`；小程序包的 Turbo build cache 已关闭，避免 Git 来源指纹被提交前缓存污染 |
| 小程序构建来源 | `3a66d125b0c1ca53879dd88a3661e3025fb7dd3d` | `dist/build-info.json` 的 `sourceRevision` |
| 小程序回归 | 154 项 / 1235 个断言 | `pnpm --filter @hospital/miniprogram test`；运行包来源固定为 `3a66d12` |
| 全仓回归 | 9/9 package、API 152/659、Worker 51/144、工具 19/57 | 当前工作树 `pnpm check` 已通过；服务端线上 release 为 `b7c9451`，旧 Python 保持运行 |
| 公网 API | `https://test-hp.meiyi.pro/api/v2` | 只允许 HTTPS，客户端不直连 Provider |

客户端候选的 `dist/` 必须由 `3a66d12` 运行输入工作树重新构建，并核对 `dist/build-info.json` 的完整 `sourceRevision`；不能使用旧聊天、旧开发者工具缓存或其他 release 的运行包推导本次结果。
`3a66d12` 在既有列表平台包络、业务读模型和会话命令重放门禁基础上，新增“我的”页资料先完成/降级、患者目录后读取的会话代际顺序校验，避免旧患者和新资料混合；无可用会话时停止患者读取，并在新加载周期清空旧患者卡片和数量。它不改变 Provider、数据库或旧服务。当前真机包的来源指纹必须是完整的 `3a66d125b0c1ca53879dd88a3661e3025fb7dd3d`。

本轮新增首页目录生命周期门禁：旧目录请求失去当前请求或页面资格后不会再把错误交给外层回调，避免覆盖新结果或在页面卸载后继续回写；当前请求的依赖失败仍保持原有 fail-closed 语义。详细边界见 [`miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md`](miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md)。

服务端当前 release `b7c9451` 包含 `98e091b` 门诊费用患者引用二次门禁：仓储返回的非法或跨患者/Provider
HIS 引用不会进入 Provider 调用；不改变本候选的真实 Provider、微信会话或真机验收结论。

随后 `400a800` 将同一校验规则下沉到 domain 并接入预约历史；预约记录的错误引用同样不会进入
Provider 调用。不增加真实预约 Provider 或真机验收结论。

随后 `b213dcc` 将同一校验规则接入报告目录；报告目录的错误引用同样不会进入 Provider 调用，
也不增加真实报告 Provider、微信会话或真机验收结论。

## 2. 真机操作顺序

### 2.1 会话和患者上下文

1. 在微信开发者工具重新编译当前 `dist/`，确认网络请求只指向公网 Hospital API。
2. 清理旧的本地会话后执行微信登录；首页应经历“验证会话中”再进入“已登录/已恢复会话”。
3. 进入“新增就诊人/更换就诊人”，等待目录读取和临床映射同步完成；同步中不能提前选择或返回使用旧患者。
4. 如果测试账号存在第二位 `clinicalAccess=ready` 患者，显式切换到第二位，返回首页后再分别打开业务页。
5. 返回首页确认患者卡片、脱敏卡号和当前选择一致；不能出现上一位患者的卡片与新列表混合。

### 2.2 只读业务

按以下顺序分别截图并保留开发者工具 Network 请求：

1. “我的挂号”→“在线挂号”：读取当前日前后各 90 天，只显示脱敏摘要和服务端归一化状态。
2. “爽约记录”：只读取过去 90 天，只显示服务端明确 `status=missed` 的记录。
3. “门诊缴费”→“待缴费”：读取最近 30 个中国标准时间自然日，核对 `unpaid` 状态和金额展示。
4. “门诊缴费”→“已缴费”：读取同一窗口，核对 `paid` 状态；页面不能出现支付调起、医保授权或退款按钮。
5. 返回患者选择页切换患者后，重复以上只读查询；页面必须先清空旧卡片/列表，再显示新患者结果。

## 3. 每一步必须保存的三层证据

| 层级 | 必须保存 | 禁止保存 |
| --- | --- | --- |
| 页面 | 页面截图、空态/错误态、当前患者和状态标签 | 完整身份证、完整卡号、Provider 患者号 |
| HTTP | URL 路径、状态码、`traceId`/`requestId`、脱敏字段摘要 | access token、openid、原始响应全文 |
| 服务端 | 当前 release、低敏业务 `requested/success/failed`、`providerRequestId` 数量 | Provider 原文、患者标识、金额明细日志 |

使用当前 release 的 `p0-log-aggregate.js` 聚合 journald，再交给 `p0-business-evidence-audit.js`；只有同一业务域同时出现请求和明确成功事件，
并且页面与 HTTP trace 能对齐，才允许把该域标记为“已验收”。readiness 200、页面显示列表或单独的 HTTP 200 都不够。

## 4. 立即停止条件

出现以下任一项，停止当前业务域，不继续点击下一步：

- `persistence-temporarily-unavailable`、`PROTOCOL_CONNECTION_LOST` 或 readiness 依赖异常；
- 页面显示旧患者数据，或患者切换后列表与卡片不一致；
- Provider 字段越过 adapter 白名单，出现患者号、预约号、电话、支付字段或原始 JSON；
- 只有 HTTP 200/请求事件，没有明确业务成功事件；
- 任意入口绕过会话/患者门禁，或者出现支付、医保、退款、预约写入、HIS 请求。

## 5. 当前仍未完成

本候选文件只固定验收方法，不宣称业务已经通过。当前 release 已切换为 `b7c9451`，仍缺：有效微信会话下的页面截图、HTTP trace、真实预约/费用 Provider 字段、
第二位患者切换和失效/恢复证据、普通资料 PUT/409、Redis TTL 以及后续支付/医保/HIS 独立契约证据。
