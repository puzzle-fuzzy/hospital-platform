# 小程序候选 `ce8d68b` 本地构建记录（2026-08-20）

## 1. 当前候选事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `ce8d68b` |
| 小程序构建来源 | `ce8d68b15fc0c6a813fbf7a95d36610167874b8e` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 注册页面/生成页面脚本 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`apps/miniprogram/dist/build-info.json.sourceRevision` 必须等于上表完整 40 位来源。上一份 `e050fa0` 记录仍保留在 [`candidate-e050fa0-local-build-2026-08-20.md`](candidate-e050fa0-local-build-2026-08-20.md)，仅作为历史候选追溯，不能用于本次扫码验收。

## 2. 本候选变化

本候选包含“我的”页面跨请求会话组合一致性修正：`/me`、普通资料和患者目录必须属于同一页面会话代际；账号在资料请求期间切换时，页面停止本轮组合并清理旧派生状态，不把新账号患者目录拼到旧 owner 证明上。详细规则见 [`miniprogram-my-page-session-composition-boundary-2026-08-20.md`](miniprogram-my-page-session-composition-boundary-2026-08-20.md)。

预约写入、支付、医保授权/结算、退款、二维码、报告 Provider、门诊病历和 HIS 回写仍保持关闭或迁移提示；本候选没有扩大业务开放范围。

## 3. 本地验证

- 小程序定向测试：163 项通过、0 项失败、1310 个断言；
- TypeScript 类型检查：通过；
- Biome 检查：通过；
- 文档链接审计：254 个文档、无断链；
- 小程序构建：通过，生成 14 个页面 JavaScript 文件；
- 构建输出来源：`ce8d68b`。

这些是本地代码和运行包证据，不代表微信开发者工具已加载、手机已连接或线上业务已验收。真机验收必须先重新构建并核对完整 `sourceRevision`，再按当前真机清单取页面、HTTP 和低敏服务端日志三层证据。
