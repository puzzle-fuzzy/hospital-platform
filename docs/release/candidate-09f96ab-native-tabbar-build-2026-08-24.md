# `09f96ab` 原生 TabBar 候选构建记录（2026-08-24）

> 本文只记录本地重制小程序候选，不代表已经替换线上小程序、完成微信真机业务验收或开放支付/医保能力。
> 旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 来源与构建结果

| 项目 | 结果 |
| --- | --- |
| 页面代码来源 | `09f96ab464bcf30d8359a8eeb0365d8a33851618` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面数量 | 16 |
| 原生主 Tab | 医疗服务、就诊、互联网医院、我的 |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` |
| 运行包来源校验 | 通过，`dist/build-info.json.sourceRevision` 与完整提交号一致 |

构建采用项目外 staging 和原子发布。构建完成后确认：

- `dist/app.json` 使用微信原生 `tabBar`，未开启 `custom`；
- 四项均声明独立的 `iconPath` 和 `selectedIconPath`；
- `dist/custom-tab-bar/` 不存在；
- `pages/consult/consult` 和 `pages/hospital/hospital` 的 `.js/.json/.wxml/.wxss` 均存在；
- 运行包没有 `*.test.js` 或 `*.spec.js`。

## 2. 本轮修正

此前的自定义 TabBar 虽然只有一个源码目录，但微信会为不同 Tab 页面创建不同的自定义组件实例，切换时可能出现底栏闪动和选中态丢失。本候选改用微信原生 `app.json.tabBar`，由平台统一维护底栏和激活状态；业务页面不再复制底栏 WXML，也不再自行推导选中项。

四个主 Tab 的内容仍通过独立 `scroll-view` 滚动，普通业务页继续使用普通页面导航。预约写入、支付、医保授权/结算、退款、患者绑定、报告附件和外部 WebView 没有因本轮导航修正而开放。

## 3. 回归证据

- 小程序定向测试：`232 pass / 0 fail`，`1774 expect()`；
- 全仓 `pnpm test`：`9/9` workspace packages 成功；
- 小程序 TypeScript 类型检查：通过；
- Biome 格式检查与 Lint：通过；
- 文档链接审计：618 个文档，无断链。

下一步是使用本候选进行真实设备页面和请求链验收，不能把本地测试结果当作微信、Provider 或线上业务成功证据。
