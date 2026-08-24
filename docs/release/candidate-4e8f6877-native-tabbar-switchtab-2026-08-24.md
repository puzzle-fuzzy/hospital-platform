# `4e8f6877` 原生 TabBar 稳定切换候选（2026-08-24）

> 本记录只描述本地重制小程序候选，不代表已经上传微信、替换线上小程序或完成真机业务验收。旧 Python 服务、线上 API、数据库和 Redis 未修改。

## 当前来源

| 项目 | 结果 |
| --- | --- |
| 小程序代码与构建链提交 | `4e8f6877edd045333400c9bb506c7bbaf146eac2` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 页面入口 | 16 个页面脚本完整 |
| TabBar | `custom=false`、`position=bottom`，四项由微信原生 TabBar 统一管理 |
| 选中资源 | 四项均声明独立 `selectedIconPath`，资源存在且为 active PNG |
| 小程序测试 | `235 pass / 0 fail / 1888 expect()` |
| 构建结果 | 通过，`dist/build-info.json.sourceRevision` 与上方提交号一致 |

## 本轮修正

除四项主入口必须经过 `switchTab` 的既有路由门禁外，会话失效时回首页的三条路径也统一改为 `switchToPrimaryTab("/pages/index/index")`：

- 通用认证入口不再使用 `reLaunch` 重建首页。
- 选择就诊人页失效恢复不再销毁并重建底栏。
- 普通资料页失效恢复不再销毁并重建底栏。

`switchTab` 仍会离开普通业务页面栈，但把主 Tab 的生命周期和 selected 图标继续交给微信原生实现，避免错误恢复路径造成底栏闪帧或选中态暂时丢失。

## 本机开发者工具复核

已清理并重新打开唯一正确的项目根目录：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram
```

控制台打印：

```text
[医院小程序] 运行包来源：原生 TabBar；revision=4e8f6877edd045333400c9bb506c7bbaf146eac2
```

模拟器页面路径为 `pages/index/index`。底部只存在一份 `医疗服务 / 就诊 / 互联网医院 / 我的` 原生底栏；点击“我的”后页面切换到 `pages/my/my`，同一份底栏仍在窗口底部，“我的”图标和文字呈蓝色选中态。构建后的开发者工具窗口错误数为 0。

## 真机验收要求

真机必须在 `apps/miniprogram/` 根工程执行普通编译并重新生成二维码，手机控制台应核对完整的 `4e8f6877edd045333400c9bb506c7bbaf146eac2`。如果仍显示 `13f597e`、`4ea15b8` 或其他来源，不能把闪动/选中态问题归因于本候选，应先清理旧二维码和开发者工具旧增量缓存。

当前候选仍关闭预约写入、患者新增/绑定、支付、医保授权/结算、取消和 HIS 写回；本记录只证明导航运行包和本机模拟器行为。
