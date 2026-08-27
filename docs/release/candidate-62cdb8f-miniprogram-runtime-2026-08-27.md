# 小程序候选运行包 `62cdb8f`（2026-08-27）

## 当前结论

本候选由提交 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328` 构建，包含
`app.json` 注册的 40 个页面。它已通过 TypeScript 检查、完整页面回归、运行包
完整性校验和来源校验，并原子发布到 `apps/miniprogram/dist/` live 目录。该事实
只证明本地运行包来源，不能证明微信线上版本已经上传，也不能替代真机业务验收。

本候选收紧预约排班和预约历史请求构造器的运行时边界：请求进入 `wx.request`
前会拒绝未知字段、非法自然日、反向日期窗口、无界科室/医生标识，以及在线/全部
范围与日期不匹配的输入。它只保护客户端请求表达和日志边界，不扩大服务端 Provider、
预约写入、取消、支付或医保能力；服务端日期跨度和业务授权仍由服务端最终决定。
线上服务端继续使用 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；旧 Python 服务、
旧数据库和旧 Redis 未修改。

## 本候选修正

- `requestAppointmentSchedules` 通过底层纯函数统一校验和编码排班查询参数，页面层
  校验不再是唯一防线。
- `buildAppointmentRecordQuery` 只接受 `scope=online|all` 的 canonical union：在线
  必须同时携带合法日期，全部范围不得携带日期或旧端字段。
- 新增运行时异常输入回归，覆盖未知字段、控制字符、非法日期、反向日期和日期范围
  错配，避免错误调用被静默编码为看似正常的 URL。
- 全局用户资料、患者选择、原生 TabBar、报告/费用只读、支付/医保关闭边界均未扩大。

## 未开放入口安全门禁

当前候选继续使用 `tools/surface-only-closure-audit.mjs` 作为静态安全审计，并由
`bun test tools` 纳入全量门禁。未开放入口没有直连 HTTP、Provider、支付、微信登录、
外部小程序或 WebView 旁路；健康自测仍只保留 BMI/血压安全数值子集。这只证明关闭态
边界保持有效，不代表临床、患者写入、外部会话或支付 contract 已完成。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`） |
| 页面数量 | 40 |
| 小程序回归 | `340 pass / 0 fail / 3726 expect()` |
| TypeScript | 通过 |
| Biome | 通过 |
| `runtime:verify` | 通过，live `dist` 来源为 `62cdb8f` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为
[`device-evidence-62cdb8f8-pending.json`](device-evidence-62cdb8f8-pending.json)。没有
真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、
客户端 `requestId`、服务端 `traceId` 和 Provider 低敏请求号。

## 下一步

从本文件对应的 `apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域
清单逐项采集页面、客户端 requestId、服务端 Pino traceId 和适用的 Provider 低敏
请求号。报告详情仍是受限只读边界；支付、医保、预约写入和 HIS 回写必须等待独立
contract 与真实证据。
