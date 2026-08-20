# 小程序候选 `501e3a7` 本地构建记录（2026-08-20）

## 1. 当前候选事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `501e3a7` |
| 小程序构建来源 | `501e3a77e3d6808d946cbe6c6122d942182709a9` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 注册页面/生成页面脚本 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 否 |

`apps/miniprogram/dist/build-info.json.sourceRevision` 必须等于上表完整 40 位来源。
上一份 [`candidate-ce8d68b-local-build-2026-08-20.md`](candidate-ce8d68b-local-build-2026-08-20.md)
仍保留为历史候选追溯，不能用于本次扫码验收。

## 2. 本候选变化

本候选修复微信开发者工具监听 `dist/` 时的运行包发布竞态：构建先在 staging 目录完成
TypeScript 编译、静态资源复制、来源指纹和页面门禁，再替换完整的 live `dist/`；替换
失败时恢复旧运行包，不再在编译开始时删除整个 `dist/`。这解决了
`pages/report-directory/report-directory.js` 在构建窗口内暂时不存在而导致的 404。

发布器、测试和现场证据见 [`miniprogram-runtime-publish-atomicity-2026-08-20.md`](miniprogram-runtime-publish-atomicity-2026-08-20.md)。
本次不改变微信授权、患者、预约、门诊费用、报告 Provider、支付、医保或 HIS 业务语义。

## 3. 本地验证

- 小程序定向测试：165 项通过、0 项失败、1320 个断言；
- 全仓 `pnpm check`：通过；
- TypeScript 类型检查：通过；
- Biome 格式与 lint：通过；
- 文档链接审计：258 个文档、无断链；
- 小程序构建：通过，生成 14 个页面 JavaScript 文件；
- `runtime:verify`：通过；
- `apps/miniprogram/dist/pages/report-directory/report-directory.js`：存在；
- 构建输出来源：`501e3a7`。

这些是本地代码和运行包证据，不代表微信开发者工具已重新编译、手机已连接或线上业务已验收。
真机验收必须先核对完整 `sourceRevision`，再按当前真机清单取得页面、HTTP 和低敏服务端日志三层证据。
