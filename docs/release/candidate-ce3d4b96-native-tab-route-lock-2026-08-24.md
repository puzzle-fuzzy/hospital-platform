# `ce3d4b96` 原生主 Tab 路由边界候选（2026-08-24）

> 本文记录本地重制小程序候选，不代表已替换线上小程序或完成真机视觉验收。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 本轮处理

用户反馈底部 Tab 切换仍有闪动、选中效果消失。本轮没有重新叠加一套自绘底栏，而是把原生导航的最后一层路由约束补齐：

- 四个主页面继续由 `app.json.tabBar` 的 `custom=false` 统一托管；首页、就诊、互联网医院和“我的”都没有自绘 `legacy-tabbar`；
- 新增 `PRIMARY_TAB_PAGE_PATHS` 和 `switchToPrimaryTab`，任何未来的程序化主 Tab 跳转都只能调用 `wx.switchTab`；
- `navigateToAuthenticatedPage` 和 `navigateToPatientScopedPage` 遇到主 Tab 路径时自动转为 `switchTab`，普通业务页仍保持 `navigateTo`；
- 验收测试增加主 Tab/普通业务页路由隔离，防止后续开发重新把主入口压入普通页面栈；
- 本机开发者工具 `project.private.config.json` 的 `compileHotReLoad` 已关闭，避免热重载替换运行包时制造假性闪动；该文件不进入 Git。

## 2. 运行包和验证

| 项目 | 结果 |
| --- | --- |
| 代码提交 | `ce3d4b964546317f6c3a658b1b14b31ace39ed94` |
| 运行包来源 | `apps/miniprogram/dist/build-info.json` 与上述提交一致 |
| 页面入口 | 16 个 `app.json` 页面脚本完整 |
| 选中资源 | `tab-01` 至 `tab-04` 的普通/active PNG 均存在 |
| 小程序测试 | `234 pass / 0 fail / 1867 expect()` |
| TypeScript | 通过 |
| 构建 | 通过 |
| 运行包校验 | `runtime:verify` 通过 |

## 3. 开发者工具验收动作

必须打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不要打开 `src/` 或旧 `mp-weixin` 项目：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

然后在开发者工具中执行一次“普通编译”，再分别点击四个底部 Tab。验收应看到：

1. 底部导航始终由同一个原生 TabBar 托管，不出现页面 WXML 自绘的第二套底栏；
2. 当前页面对应的 active PNG 为蓝色，其余图标为灰色；
3. 主 Tab 切换不增加普通页面栈，普通业务页返回时不会出现第二套底栏；
4. 若工具仍显示旧选中态或旧底栏，先完全关闭当前开发者工具和真机调试，再重新打开上述项目并生成新的二维码；旧二维码/旧增量缓存不能作为本候选证据。

本轮没有部署服务端，也没有打开支付、医保授权/结算、预约写入、取消、HIS 回写或真实患者绑定。
