# 小程序候选 `d772f09` 本地构建记录（2026-08-20）

## 1. 当前候选事实

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `d772f09` |
| 小程序构建来源 | `d772f0966bbb0e369c61646528e8205eaf73825f` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 注册页面/生成页面脚本 | 14 |
| 是否上传线上小程序 | 否 |
| 是否完成真机验收 | 服务端微信会话与患者同步部分通过，页面选择链路未完成 |

`apps/miniprogram/dist/build-info.json.sourceRevision` 必须等于上表完整 40 位来源。
上一份 [`candidate-0dccf54-local-build-2026-08-20.md`](candidate-0dccf54-local-build-2026-08-20.md)
仍保留为历史候选追溯，不能用于本次扫码验收。

## 2. 本候选变化

本候选在原子运行包发布和会话边界基础上，进一步把 `src/**/*.test.ts` 排除在微信运行包之外：
测试文件仍参与 TypeScript 类型检查和 Bun 测试，但不再生成 `dist/services/*.test.js`；来源指纹也排除测试提交，
避免纯测试变更伪装成页面运行逻辑变化。该修正不改变首页、患者、预约只读、报告、门诊费用、支付或医保业务语义。

构建仍先在 staging 目录完成 TypeScript 编译、静态资源复制、来源指纹和页面门禁，再原子替换完整 live `dist/`；
失败时保留旧运行包，避免开发者工具观察到页面脚本暂时缺失。

## 3. 本地验证

- 小程序定向构建/来源测试：96 项通过、0 项失败、1089 个断言；
- `pnpm --filter @hospital/miniprogram build`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过；
- `dist/build-info.json.sourceRevision`：等于 `d772f0966bbb0e369c61646528e8205eaf73825f`；
- 14 个注册页面的 `.js/.json/.wxml/.wxss` 均存在；
- `dist/` 中没有 `*.test.js`；
- 旧 Python 服务、数据库、Redis、Provider 和线上小程序均未修改。

这些是本地代码和运行包证据，不代表微信开发者工具已加载当前候选或真机页面已完成业务验收。
微信登录与患者同步的低敏公网证据及未完成边界见
[`miniprogram-real-device-login-acceptance-2026-08-20.md`](miniprogram-real-device-login-acceptance-2026-08-20.md)。
