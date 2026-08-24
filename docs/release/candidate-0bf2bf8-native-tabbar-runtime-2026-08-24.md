# `0bf2bf8` 原生 TabBar 运行包复核记录（2026-08-24）

## 当前候选事实

| 项目 | 结果 |
| --- | --- |
| 小程序运行输入 | `0bf2bf828b107c7b65b26ac5457edfa2b4e1ac9e` |
| 运行包来源 | `apps/miniprogram/dist/build-info.json` 与完整提交号一致 |
| 页面入口 | 16 个，页面 JS/WXML/WXSS 均完整 |
| 原生 TabBar | `custom=false`、`position=bottom`、四项路由唯一声明 |
| 运行包门禁 | `runtime:verify` 通过；无 `custom-tab-bar`、无 `*.test.js`/`*.spec.js` |
| 线上服务 | 未修改；旧 Python、MySQL、Redis 未修改 |

## 问题定位

开发者工具在本轮首次现场仍打印旧来源 `4e8f6877...`，而磁盘上已经生成了
`0bf2bf8...` 的新运行包，因此当时看到的底栏闪动或选中态缺失不能归因于当前源码。
这属于开发者工具保留旧页面实例/增量运行包的缓存问题。

本轮只对当前新工程执行了：

1. `reset-fileutils --project E:\__Super_Core__\hospital-platform\apps\miniprogram`；
2. 关闭当前工程并重新打开同一个 `apps/miniprogram/` 根工程；
3. 重新读取控制台启动来源并切换原生 Tab。

重开后控制台确认：

```text
[医院小程序] 运行包来源：原生 TabBar；revision=0bf2bf828b107c7b65b26ac5457edfa2b4e1ac9e
```

模拟器现场显示首页只有一份底部原生 TabBar；切换到“就诊”后仍是同一份底栏，
“就诊”图标与文字呈蓝色选中态。当前证据不代表真机业务验收通过，真机必须重新从
本候选普通编译并核对完整 `sourceRevision`，不能继续使用旧二维码。

## 后续操作边界

- 如果真机仍显示旧样式，先核对启动日志是否为完整 `0bf2bf8...`；不是该来源时先重新普通编译和生成二维码。
- 不要打开 `apps/miniprogram/src/` 或 `apps/miniprogram/dist/` 作为独立微信工程。
- 不要新增页面级底栏或恢复 `custom-tab-bar`；四个主 Tab 继续由微信原生 `app.json.tabBar.list` 统一维护。
- 本候选只完成运行包与导航结构复核，不开放预约写入、取消、支付、医保授权或 HIS 回写。
