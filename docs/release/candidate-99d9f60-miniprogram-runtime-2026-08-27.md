# 小程序候选运行包 `99d9f60`（2026-08-27）

## 当前结论

本候选由提交 `99d9f60f6291b7f8d08d779cec059892f054d80e` 构建，包含
`app.json` 注册的 40 个页面。它已通过 TypeScript 检查、完整页面回归、运行包
完整性校验和来源校验，并原子发布到 `apps/miniprogram/dist/` live 目录。该事实
只证明本地运行包来源，不能证明微信线上版本已经上传，也不能替代真机业务验收。

本候选只收紧订阅页面分类折叠事件的 `dataset` 输入边界：仅接受分类表自身的
字符串键，拒绝原型链键和非字符串值。线上服务端继续使用
`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；旧 Python 服务、旧数据库和旧 Redis
未修改。

## 本候选修正

- `pages/patient-subscription/patient-subscription.ts` 不再使用会穿透原型链的
  `in` 判断分类键，避免未来模板复用或异常 dataset 进入 `buildSections`。
- 自动化门禁增加对应静态回归，保持消息订阅能力本身仍为未接入展示，不调用微信
  订阅授权，也不把本地开关伪装成服务端授权事实。
- 全局用户资料单飞、会话代际、患者选择、原生 TabBar、报告/费用只读和支付/医保
  关闭边界均未扩大。
- 提交 `2580a1fe` 进一步修正未开放入口审计器：模板文案会被忽略，但 `${...}`
  中的可执行表达式继续接受直连调用扫描；这只增强门禁，不改变本候选运行代码。
- 提交 `cbb43040` 修正集中 API client 导入扫描：导入路径保留字符串检查，注释
  中的伪导入不触发规则；这只增强门禁，不改变本候选运行代码。

## 未开放入口安全门禁

新增 `tools/surface-only-closure-audit.mjs` 作为静态安全审计，并由
`bun test tools` 纳入全量门禁。审计确认 15 个 `surface-only` 目标页中，14 个只
通过关闭态页面工厂承接入口，健康自测只保留本地 BMI/血压安全数值子集；页面和
共享工厂没有直连 HTTP、Provider、支付、微信登录、外部小程序或 WebView 旁路。
这只证明“未开放能力仍然关闭”，不代表临床、患者写入、外部会话或支付 contract
已经完成。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `99d9f60f6291b7f8d08d779cec059892f054d80e`（`99d9f60`） |
| 页面数量 | 40 |
| 小程序回归 | `338 pass / 0 fail / 3712 expect()` |
| TypeScript | 通过 |
| Biome | 通过 |
| `runtime:verify` | 通过，live `dist` 来源为 `99d9f60` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为
[`device-evidence-99d9f60f-pending.json`](device-evidence-99d9f60f-pending.json)。没有
真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、
客户端 `requestId`、服务端 `traceId` 和 Provider 低敏请求号。

## 下一步

从本文件对应的 `apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域
清单逐项采集页面、客户端 requestId、服务端 Pino traceId 和适用的 Provider 低敏
请求号。报告详情仍是受限只读边界；支付、医保、预约写入和 HIS 回写必须等待独立
contract 与真实证据。
