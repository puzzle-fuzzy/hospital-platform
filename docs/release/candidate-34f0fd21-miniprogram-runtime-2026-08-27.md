# 小程序候选运行包 `34f0fd21`（2026-08-27）

## 当前结论

本候选由提交 `34f0fd21aac33214e991de561d37dfd7071013bf` 构建，包含 `app.json` 注册的 40 个页面。
它已通过小程序 TypeScript 检查、完整页面回归、运行包完整性校验和来源校验，并原子发布到
`apps/miniprogram/dist/` live 目录。该事实只证明本地运行包来源，不能证明微信线上版本已经上传，也不能替代真机业务验收。

本候选只更新小程序患者范围请求边界和门诊费用只读卡片层级；线上服务端继续使用
`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，旧 Python 服务、旧数据库和旧 Redis 未修改。

## 本候选修正

- 患者 opaque 标识的长度、空白和控制字符校验集中到共享模块，页面 helper 与底层 API 请求使用同一边界。
- 报告目录、报告详情和门诊费用底层请求在发起网络请求前校验患者标识、日期、报告引用和费用状态。
- 门诊费用卡片恢复旧端的院区、患者、科室、医生、金额和就诊时间层级；支付、医保授权和结算仍保持关闭。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `34f0fd21aac33214e991de561d37dfd7071013bf`（`34f0fd21`） |
| 页面数量 | 40 |
| 小程序回归 | `338 pass / 0 fail / 3707 expect()` |
| TypeScript | 通过 |
| `runtime:verify` | 通过，live `dist` 来源为 `34f0fd21` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为 [`device-evidence-34f0fd21-pending.json`](device-evidence-34f0fd21-pending.json)。没有真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、客户端 `requestId`、服务端 trace 和 Provider 低敏请求号。

## 下一步

从本文件对应的 `apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域清单逐项采集页面、客户端 requestId、服务端 Pino traceId 和适用的 Provider 低敏请求号。报告和门诊费用仍是只读边界；支付、医保、预约写入和 HIS 回写必须等待独立 contract 与真实证据。
