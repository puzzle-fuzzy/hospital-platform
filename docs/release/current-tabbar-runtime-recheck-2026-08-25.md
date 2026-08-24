# 当前原生 Tab 运行包复核（2026-08-25）

## 结论

本次反馈的“底部 Tab 仍然闪动、选中效果消失”没有在当前源码中复现出第二套底栏：

- `src/app.json` 和 `dist/app.json` 都是微信原生 `tabBar`，`custom=false`、`position=bottom`；
- 四个主入口只在 `app.json.tabBar.list` 声明一次；
- 四个主入口同时位于 `app.json.pages` 前四项，首屏和 Tab 切换使用同一组根页面注册；
- 页面 WXML、运行包和导航服务都没有 `legacy-tabbar`、`custom-tab-bar` 或页面级固定底栏；
- 主 Tab 的程序化入口只允许 `wx.switchTab`，普通业务页仍使用 `wx.navigateTo`；
- 普通态和选中态图标路径不同，且构建包中的文件字节与源码一致。

因此不能通过重新添加自绘底栏来掩盖现象。自绘底栏会随页面生命周期产生第二套实例，反而会重新制造闪动和 selected 状态竞态。本次按工具缓存/旧增量运行包边界处理。

## 2026-08-25 当前续发布：运行包来源与图标缓存重新隔离

本轮复核时发现仓库已进入新的提交，但 `dist/build-info.json` 仍停留在旧的
`ad7b079`，`runtime:verify` 因此阻断了验收。已将四组原生 Tab 的普通态和选中态
图标路径升级为全新的 `*-v4.png`，图形内容保持与旧视觉基线一致，只改变资源路径
以撤销微信开发者工具/真机对旧 `v3` 路径的增量缓存；普通态和选中态仍是两份不同的
81×81 PNG，选中态仍由微信原生 `selectedIconPath` 维护。

当前候选必须在本次构建完成后，以 `dist/build-info.json` 的完整 `sourceRevision` 为准。
若 `dist/` 被开发者工具占用，构建会把候选保留到 `.local/hospital-miniprogram/pending`，
此时必须关闭新项目的开发者工具窗口和真机调试会话，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

这次缓存隔离不改变旧服务、线上 API、数据库或 Redis；也不重新引入自绘底栏。真机
仍需从 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` 重新普通编译并
扫描新预览，启动日志中的 revision 必须与 `dist/build-info.json` 完全一致。

## 本次现场处理

在不接触旧 Python 服务、服务器、数据库、Redis 或线上小程序的前提下，只对新项目的微信开发者工具执行了以下动作：

1. 针对独立运行根 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` 清理编译缓存；
2. 重置该运行根的 file-utils 索引；
3. 退出后重新打开独立 `dist` 工程；
4. 从当前 `dist` 重新执行预览，预览包大小为 `696935` 字节。

当前运行包来源仍为：

```text
45742ff4450b223b8db3b36e4a3859e3fc86e1c5
```

`dist/build-info.json`、`dist/app.json` 和 `dist/project.config.json` 均已现场核对。独立工程的 `miniprogramRoot=./`、`compileHotReLoad=false`、`ignoreDevUnusedFiles=false`，不会主动监听仓库的 TypeScript 源码和测试脚本。

本轮进一步把原生 Tab 图标改为独立的 `*-v2.png` 资源：普通态和选中态保持原视觉内容，统一为 `81×81` PNG，并由构建脚本读取 PNG 的 IHDR 做尺寸门禁。这样可以同时避开开发者工具/真机对旧资源路径的缓存，并符合原生 tabBar 的稳定输入边界；没有重新引入 `custom-tab-bar`。

## 2026-08-25 再次反馈后的资源缓存隔离

源码和运行包结构审计仍确认只有微信原生 `tabBar`，但本机开发者工具日志曾在同一历史会话
中同时监听过 `apps/miniprogram/dist`、父目录 `apps/miniprogram` 和 `apps/miniprogram/src`，
并出现过已经撤回的 `src/constants/legacy-tabbar.js` 增量文件。为避免真机继续命中旧预览包或旧图标
缓存，本轮不改变图形内容，只将四组普通/选中图标的路径升级为唯一的 `*-v3.png`，并重新生成完整运行包。
这不是新增自绘底栏；选中态仍完全由 `app.json.tabBar.list[].selectedIconPath` 交给微信维护。

重新生成预览后，必须确认开发者工具窗口标题为 `hospital-platform-runtime`，工程根为
`E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`，并扫描本轮新的预览二维码。

本轮再收紧页面注册顺序：`pages/index/index`、`pages/consult/consult`、
`pages/hospital/hospital`、`pages/my/my` 固定为 `app.json.pages` 的前四项，
并由验收测试锁定。它不能替代重新普通编译；若启动日志仍不是本候选 revision，
真机看到的仍然是旧运行包。

## 2026-08-25 现场补充：开发者工具入口混用

用户反馈仍出现底栏闪动且没有选中态后，对本机微信开发者工具的项目记录做了只读核对，
发现同一个新项目历史上同时存在以下三个入口：

- `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`（唯一正确运行根）；
- `E:\__Super_Core__\hospital-platform\apps\miniprogram`（构建父目录，不应直接打开）；
- `E:\__Super_Core__\hospital-platform\apps\miniprogram\src`（TypeScript 源目录，不应作为小程序工程）。

后两个入口会让开发者工具重新读取源码 `app.json` 或旧增量页面图，足以造成“看起来有两套底栏”、
页面切换闪动和选中资源没有更新；这与当前源码中不存在第二套底栏并不矛盾。

本次只对新项目开发者工具执行了以下动作：

1. 清理 `dist` 工程的编译缓存；
2. 重置 `dist` 工程的 file-utils 索引；
3. 关闭历史中的父目录和 `src` 错误入口；
4. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`；
5. 重新生成预览包，包大小为 `696935` 字节；
6. 运行 `pnpm --filter @hospital/miniprogram runtime:verify`，结果为 `16 pages`、`revision=45742ff`。

当前没有修改旧项目、旧服务、服务器、数据库、Redis 或线上小程序。后续真机验收仍必须确认工具窗口根目录正是
`apps/miniprogram/dist`，并在启动日志看到完整的 `45742ff4450b223b8db3b36e4a3859e3fc86e1c5`；不要继续使用父目录、
`src` 或历史二维码。

## 2026-08-25 运行包锁定补充

重新构建时，构建脚本发现 `apps/miniprogram/dist` 仍被微信开发者工具占用，因而没有覆盖已验证的完整运行包，
而是把候选保存在 `.local/hospital-miniprogram/pending`。这不是业务代码编译错误，但如果此时继续热编译或继续使用旧
真机调试会话，工具可能把旧增量页面图和当前 `app.json` 混合加载，表现为底栏闪动、选中图标不更新或页面文件来自旧候选。

本次针对新项目执行了以下恢复动作：

1. 关闭 `dist`、`apps/miniprogram` 父目录和 `src` 三个新项目入口；
2. 退出仍持有文件锁的微信开发者工具主进程；
3. 执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`，将待发布候选安全替换到 `dist`；
4. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，确认 `16` 个页面脚本和 `revision=45742ff`；
5. 只重新打开 `apps/miniprogram/dist`，并重新生成新的预览二维码。

这组操作没有删除患者缓存、登录状态或线上数据，也没有触碰旧项目和旧服务。之后若再次需要修改源码，必须先关闭
这个唯一的 `dist` 工程和真机调试会话；如果构建输出提示 `dist is locked`，应先完成上述发布流程，不能手工复制文件到
`dist` 或继续使用旧二维码。

## 业务链路复核补充

预约记录页的两个标签不是前端本地筛选的同一份数据：`在线挂号`和`全部挂号`
分别对应服务端已经确认的读取范围。患者会话或显式就诊人在页面停留期间失效时，
标签点击会先保存用户意图，再重新执行 `/me`、患者目录和记录查询；回归测试锁定了
重载必须显式携带刚点击的标签，避免标签文案与实际请求范围短暂错配。

## 真机验收准入

真机必须在本次重新普通编译后重新预览，不能继续使用旧二维码或旧真机调试会话。启动控制台应出现：

```text
[医院小程序] 运行包来源：微信原生 tabBar；revision=45742ff4450b223b8db3b36e4a3859e3fc86e1c5
```

随后依次点击“医疗服务、就诊、互联网医院、我的”，必须同时满足：

1. 底部始终只有一套四项导航；
2. 当前项图标和文字为蓝色，其他三项为灰色；
3. 切换时底栏不先消失、不叠加第二套、不先错误选中“医疗服务”；
4. 长内容只在页面自己的 `scroll-view` 内滚动，底栏固定；
5. 进入普通业务页时底栏按微信规则隐藏，返回主 Tab 后仍恢复为同一套原生底栏。

如果这次重新普通编译、并确认完整 revision 后仍然出现同样现象，下一步应记录真机系统、基础库版本、当前 route、启动 revision 和切换录屏，再判断是否属于微信基础库的原生过渡动画；在取得这组证据前不切换到第二种底栏架构。

## 2026-08-25 本轮再次发布与回归

> 本轮最终运行包已更新为 `0b1df915a0051cd84c52bcdb2cc679cec1ab0664`，预览二维码为
> `.local/hospital-miniprogram/tabbar-preview-0b1df915.png`。以下上一段中的
> `45742ff` 仅保留为历史候选记录，不能继续用于真机验收。

本轮用户再次反馈“底栏闪动、选中态消失”后，构建先检测到 `dist/` 仍被微信开发者工具占用，
没有覆盖旧运行包；完整候选已保存在 `.local/hospital-miniprogram/pending`。随后只关闭占用该新项目的
微信开发者工具进程，执行 `runtime:publish-pending`，再打开唯一运行根
`E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`。

本轮再次执行了以下门禁：

- 清理 `compile` 缓存并重置 file-utils 索引；
- CLI 预览包大小为 `748481` 字节；
- `pnpm --filter @hospital/miniprogram test`：`240 pass / 0 fail / 1929 expect()`；
- `pnpm --filter @hospital/miniprogram runtime:verify`：`16 pages`、`revision=0b1df915`；
- 当前源码和 `dist` 仍只有微信原生 `tabBar`，没有 `legacy-tabbar`、`custom-tab-bar` 或页面级底栏。

因此下一次真机复核必须扫描本轮重新生成的预览，不得继续使用旧二维码；启动日志应出现完整
`0b1df915a0051cd84c52bcdb2cc679cec1ab0664`。若新预览仍发生同样现象，必须同时提供真机系统、基础库版本、
当前 route、启动 revision 和切换录屏，才能区分工具缓存与微信原生 Tab 的平台过渡动画。
