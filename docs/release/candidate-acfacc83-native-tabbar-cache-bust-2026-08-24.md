# `acfacc83` 原生 TabBar 图标缓存隔离候选（历史，2026-08-24）

> 本候选已被后续的共享 `custom-tab-bar` 修正替代。它保留原生 TabBar 的缓存隔离证据，但不再是当前真机验收入口；当前入口见 [`candidate-shared-custom-tabbar-2026-08-24.md`](candidate-shared-custom-tabbar-2026-08-24.md)。

> 本记录只描述本地重制小程序候选，不代表已经上传微信或完成真机验收。旧 Python 服务、线上 API、数据库、Redis 和另一会话负责的众阳 Provider 自动化均未修改。

## 本轮结论

四个主入口继续使用微信原生 `tabBar`，不是每个页面分别绘制底栏：

- `tabBar.custom=false`、`position=bottom`；
- `pages/index/index`、`pages/consult/consult`、`pages/hospital/hospital`、`pages/my/my` 是唯一四个主 Tab；
- 页面 WXML 没有 `legacy-tabbar`，运行包不包含 `custom-tab-bar`；
- 主 Tab 的程序化入口仍集中在 `patient-navigation.ts`，统一使用 `switchTab`，当前 Tab 重复切换会直接 no-op；
- 普通业务页仍使用 `navigateTo`，返回主 Tab 时由微信清理普通页面栈并恢复原生底栏。

## 本轮修正

上一轮原生模式重新使用了曾被自定义 Tab 与旧候选共用的图标路径。开发者工具或真机可能按历史路径继续命中普通态资源，表现为：

1. 切换主 Tab 时底部出现闪帧；
2. 四个图标看起来都没有选中效果；
3. 页面内容已经更新，但底栏仍像旧候选。

本轮不新增第二套底栏，而是把 `app.json.tabBar.list` 的八个资源路径切换到已存在的独立 `-native.png` / `-native-active.png` 文件。构建脚本同时检查路径、文件存在性和普通/选中 PNG 的字节差异，避免把同一张图伪装成选中资源。

## 运行包与验证

| 项目 | 结果 |
| --- | --- |
| 小程序代码提交 | `acfacc830010ea993dfdaefeae71ad3bc8c407c0` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面运行文件 | 16 个页面的 `.js/.json/.wxml/.wxss` 完整 |
| 小程序回归 | `238 pass / 0 fail / 1901 expect()` |
| TypeScript 与构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包门禁 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 预览候选 | 已由当前新工程生成，二维码文件名包含 `acfacc83` |

## 真机验收边界

真机必须从 `apps/miniprogram/` 根工程重新普通编译并扫描当前二维码，然后核对 `dist/build-info.json` 的完整 revision。依次点击“医疗服务、就诊、互联网医院、我的”，应看到：

- 窗口底部只有一套原生 TabBar；
- 当前项使用蓝色图标和选中颜色，其他项为灰色；
- 切换时不出现页面级第二套底栏；
- 主 Tab 内容滚动时，底栏保持固定；
- 进入预约记录、患者选择等普通业务页时按微信规则隐藏，返回主 Tab 后仍恢复同一套原生底栏。

如果真机控制台来源不是完整 `acfacc830010ea993dfdaefeae71ad3bc8c407c0`，先停止验收并重新导入当前工程，不能把旧包的表现归因于本候选。

支付、医保授权/结算、预约写入、取消、患者绑定、二维码和 HIS 回写继续保持关闭。
