# 原生小程序静态公众号说明页验收手册

本文只覆盖旧端 `pagesB/account/follow.vue` 的静态说明部分，不代表用户已经关注公众号，
也不代表二维码、模板消息授权或通知发送链路已经完成。

## 迁移范围

| 旧端事实 | 新端证据 | 约束 |
| --- | --- | --- |
| 首页轮播点击进入公众号页 | `index.ts` 的 `follow` action | 只能跳转已注册的原生页面 |
| 顶部渐变背景 | `official-account.wxss` | 保留 200rpx 高度和旧端渐变，不依赖外部资源 |
| 欢迎文案和通知说明 | `official-account.wxml` | 保留旧端中文文案和字号层级 |
| 通知图标 | `src/assets/official-account/notice.svg` | 使用 `<image>` 本地加载，禁止运行时外部 OSS 兜底 |
| 公众号关注事实 | 当前未实现 | 打开页面、阅读文案都不能作为关注成功证据 |

## 本地门禁

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm --filter @hospital/miniprogram build
```

构建后必须确认：

- `apps/miniprogram/dist/pages/official-account/official-account.js` 存在；
- `apps/miniprogram/dist/assets/official-account/notice.svg` 存在；
- `apps/miniprogram/dist/app.json` 注册 `pages/official-account/official-account`；
- 页面源码不包含 provider URL、二维码接口、`wx.requestSubscribeMessage` 或关注成功状态写入。

## 开发者工具/真机检查

1. 点击首页轮播图，确认进入“公众号”页面，顶部渐变、文案、图标和通知说明布局与旧端一致。
2. 返回首页后重复进入，确认页面不发起网络请求，不创建会话，不修改患者或订阅状态。
3. 断网打开页面，确认静态文案和本地图标仍可展示。

## 后续开放条件

公众号二维码、关注状态或订阅消息必须另行确认目标主体、二维码来源、模板 ID、授权时机、业务事件、
发送结果、撤销/拒绝语义和日志字段；在这些资料和真机证据到达前，不新增“已关注”“设置已保存”或“通知已发送”等成功文案。
