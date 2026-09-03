# 原生小程序静态院内导航验收手册

本文只覆盖旧端 `pagesB/hospital/navigation` 的静态地图能力，不代表动态医院列表、楼层定位、科室定位或实时路线已经迁移。
该页面不调用 Hospital API、众阳接口、定位服务或第三方图片域名；地图资源随小程序构建产物发布。

## 已迁移的旧端事实

| 事实 | 新端实现 | 验收要求 |
| --- | --- | --- |
| 页面底色为 `#E8F2DA` | 页面 JSON、WXSS 和容器均使用 `#e8f2da` | 页面打开后不能出现白色闪屏或黑色画布 |
| 使用本地 `map.jpg` | `src/assets/hospital-navigation/map.jpg` | 构建产物必须包含相同资源，不能改成 WXSS `url()` |
| 图片使用 `aspectFit` | WXML `<image mode="aspectFit">` | 地图完整可见，不裁切、不变形 |
| 点击地图预览 | `wx.previewImage` 打开同一张本地图片 | 点击后能放大查看，预览失败显示明确 toast |
| 图片加载失败提示 toast | `binderror="onMapError"` | 模拟资源错误时显示“地图加载失败，请稍后重试” |

## 代码和构建验收

在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm --filter @hospital/miniprogram build
```

必须同时满足：

- 小程序 acceptance test 包含静态导航入口、`aspectFit`、错误提示和地图资源存在性检查；
- `apps/miniprogram/dist/pages/hospital-navigation/hospital-navigation.js` 存在；
- `apps/miniprogram/dist/assets/hospital-navigation/map.jpg` 存在；
- 源码和构建产物中没有该页面的 provider URL、患者标识、支付字段或定位接口；
- `git diff --check` 通过。

## 开发者工具和真机验收

1. 使用 `apps/miniprogram/dist/` 作为小程序项目目录编译并打开首页。
2. 点击“便民”中的“院内导航”，确认页面标题和底色与旧端一致。
3. 确认地图完整显示；在不同屏幕比例下不得被裁切或拉伸。
4. 点击地图，确认进入微信图片预览；返回后页面仍可正常操作。
5. 在开发者工具 Network 面板确认打开和预览不产生 Hospital API 或第三方图片请求。
6. 真机至少验证一次：首页入口、地图显示、放大预览、返回首页和弱网下的静态资源提示。

## 回滚和后续边界

该页面只新增小程序页面和静态资源，不修改旧 Python 服务、数据库、Redis、Nginx 或 provider 配置。
如需回滚，只需回退首页入口、`app.json` 页面注册、构建清单和导航页面资源；不要通过万能 provider 转发替代静态页。

动态医院列表、楼层/科室定位和实时路线必须在取得数据来源、地图版本、定位输入、路线算法、缓存 TTL、错误码和日志字段后，
另行设计 contract 和验收手册；在此之前页面只能保持静态地图能力。
