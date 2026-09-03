# 原生小程序静态医院列表验收手册

本文只覆盖旧端 `pagesB/hospital/hospitalList.vue` 的静态单院区入口迁移，不代表动态机构目录、
多院区选择、真实路线或医院 provider 服务已经完成。

## 迁移范围

| 旧端事实 | 新端证据 | 约束 |
| --- | --- | --- |
| 顶部红色院区提示 | `pages/hospital-list/hospital-list.wxml/.wxss` | 必须位于卡片之前，文案和 86rpx 高度保持一致 |
| 高平市人民医院封面 | `src/assets/hospital-list/gaoping-hospital.jpg` | 使用本地 `<image>`，不得改成 WXSS `url()` 或运行时外部 OSS 地址 |
| 卡片、遮罩、医院名称和地址 | `pages/hospital-list/hospital-list.wxml/.wxss` | 保留 710rpx 宽、380rpx 高、20rpx 圆角和旧端布局 |
| 去挂号 | `hospital-list.ts` 的 `onRegisterTap` | 只进入已注册的预约只读目录，不创建预约、不锁号、不支付 |
| 查看路线 | `hospital-list.ts` 的 `onRouteTap` | 旧端没有路线接口；当前明确提示未开放，不猜坐标、不打开任意 URL |

## 本地门禁

在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm --filter @hospital/miniprogram build
```

构建后必须确认：

- `apps/miniprogram/dist/pages/hospital-list/hospital-list.js` 存在；
- `apps/miniprogram/dist/pages/hospital-list/hospital-list.wxml` 和 `.wxss` 存在；
- `apps/miniprogram/dist/assets/hospital-list/gaoping-hospital.jpg` 存在；
- `apps/miniprogram/dist/app.json` 注册 `pages/hospital-list/hospital-list`；
- `apps/miniprogram/dist/pages/hospital-list/hospital-list.js` 不包含 provider URL、坐标猜测或支付调用。

## 开发者工具/真机检查

1. 首页点击“预约挂号”，先进入医院列表，确认红色提示在顶部且卡片间距、封面裁剪、底部黑色遮罩和“去挂号”位置与旧端一致。
2. 点击医院卡片或“去挂号”，进入预约目录；确认仍然使用当前登录会话和已选择的内部 `patientId`，不会在医院列表页提交患者号或预约命令。
3. 点击“查看路线”，确认显示“路线服务暂未开放”，不会误进入预约目录；没有医院确认的坐标和地图授权前，不得改为 `wx.openLocation`。
4. 断网后重新打开页面，确认静态封面仍能展示；静态资源加载失败时由小程序资源错误显式暴露，不通过外部 OSS 兜底。

## 后续升级条件

只有取得机构/院区文档、数据版本、可用服务、坐标来源、路线授权、错误码、缓存 TTL 和日志字段后，
才可以把本页从静态配置升级为动态目录。动态升级必须新增独立 contract、服务端 owner/权限校验、
缓存版本和真实公网/真机验收，不得让本页直接调用旧 provider。
