# `7a85dce8` 原生 TabBar 选中资源缓存隔离记录（2026-08-24）

## 本轮修正

用户反馈切换主 Tab 时仍有闪动，且当前项图标/文字没有选中效果。源码审计确认：

- 四个主入口仍只由微信原生 `app.json.tabBar` 管理，`custom=false`；
- 首页、就诊、互联网医院和我的页面没有 `legacy-tabbar` WXML、页面级固定底栏或
  `custom-tab-bar` 运行文件；
- 程序化打开主 Tab 继续统一使用 `wx.switchTab`；
- 普通态和选中态图标内容未改变，只将运行包资源路径隔离为
  `tab-01-native.png` / `tab-01-native-active.png` 至
  `tab-04-native.png` / `tab-04-native-active.png`，避免开发者工具或真机继续命中旧路径缓存。

本轮没有恢复自定义底栏。自定义组件会重新引入页面生命周期和选中态同步问题，不能用它
掩盖运行包缓存或错误工程根目录。

## 已验证

| 项目 | 结果 |
| --- | --- |
| 提交 | `7a85dce83fbef08794b0cc0966b2aa40d532b3d7` |
| 小程序页面 | 16 个页面脚本、WXML、WXSS 和 JSON 完整 |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包 | `revision=7a85dce`，`runtime:verify` 通过 |
| 小程序测试 | 235 pass / 0 fail / 1896 expect() |
| 文档审计 | 641 个 Markdown 文档无断链 |
| 开发者工具 | 已对 `apps/miniprogram/` 执行文件缓存重置、关闭并重开 |
| 旧系统 | 未修改旧 Python 服务、服务器、MySQL、Redis 或线上配置 |

## 真机前置

1. 打开路径必须是 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不能打开其下的
   `src/` 或 `dist/`。
2. 在开发者工具中执行一次“普通编译”，确认启动日志包含完整来源：

   ```text
   [医院小程序] 运行包来源：原生 TabBar；revision=7a85dce83fbef08794b0cc0966b2aa40d532b3d7
   ```

3. 依次点击四个主 Tab：底栏只能有一份，当前项的图标和文字必须呈蓝色；页面内容滚动时
   底栏不能进入内容滚动区域。
4. 真机预览或调试必须重新从本候选普通编译生成，不能继续使用旧二维码；线上仍是
   `13f597e`，本候选未上传微信，也未替换线上服务。
