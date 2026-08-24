# 共享 custom-tab-bar 修正候选（2026-08-24）

> 本记录描述本地重制小程序的导航修正，不代表已经上传微信或完成真机验收。旧 Python 服务、线上 API、数据库、Redis 和另一会话负责的众阳 Provider 自动化均未修改。

## 本轮结论

针对真机反馈的“底部 Tab 切换闪动、四项没有选中效果”，本轮不再依赖微信原生 `selectedIconPath` 的隐式切换，而改用微信官方 `custom-tab-bar` 单实例组件：

- `src/app.json` 的 `tabBar.custom=true`，四项路由仍集中声明在同一份 `tabBar.list`；
- `src/custom-tab-bar/index.*` 是底栏唯一渲染入口，首页、就诊、互联网医院和“我的”页面不再复制底栏；
- 组件根据当前页面 `route` 计算 selected，初始化、attached 和 page show 都会重新同步；
- 点击目标 Tab 时先更新 selected，再调用 `wx.switchTab`；路由失败会回滚 selected，避免用户看到错误的蓝色激活态；
- `.tab-page-scroll` 只预留一份 `130rpx + safe-area` 底部内容空间，底栏固定在窗口底部，页面级滚动仍然关闭。

## 运行包边界

当前运行包来源为 `192cb75d64fb11bb431b6a003def7a0516b13b64`（提交 `192cb75d`）。

构建时必须确认：

1. `dist/app.json` 为 `custom=true`，四个主 Tab 路径依次是医疗服务、就诊、互联网医院、我的；
2. `dist/custom-tab-bar/index.js|json|wxml|wxss` 全部存在；
3. `dist/` 不包含页面级 `legacy-tabbar`，也不包含 `*.test.js` 或 `*.spec.js`；
4. 16 个注册页面均存在 `.js/.json/.wxml/.wxss`，并且四个主 Tab 的 `disableScroll` 为 `true`；
5. 开发者工具项目根目录必须是 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不能打开 `src/` 或 `dist/` 子目录。

## 已完成的本地验证

| 项目 | 结果 |
| --- | --- |
| 小程序 TypeScript | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| 小程序导航验收 | 覆盖单实例组件、route selected、switchTab 失败回滚和无页面复制底栏 |
| 小程序回归 | 238 项测试，1909 个断言 |
| 运行包构建 | `dist/build-info.json` 来源为 `192cb75d64fb11bb431b6a003def7a0516b13b64` |
| 运行包门禁 | `runtime:verify` 通过 |
| 服务端/旧服务 | 未上传、未切换、未重启；旧 Python `8001` 不受影响 |

本地构建脚本故意要求运行输入处于已提交状态，避免 `dist/build-info.json` 把未提交的底栏代码伪装成旧 revision。提交后重新执行：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

## 真机验收边界

重新普通编译并生成新二维码后，依次点击四项底栏，必须同时观察：

- 窗口底部只有一套固定底栏；
- 当前项图标和文字为蓝色，其余三项为灰色；
- 切换过程中底栏不消失、不叠加、不先错误选中首页；
- 主 Tab 内容长时只有内容区域滚动，底栏不随内容移动；
- 进入患者选择、预约记录等普通页面时底栏按微信规则隐藏，返回主 Tab 后仍恢复同一套组件。

在用户完成上述真机操作并提供页面现象前，本候选只能标记为“代码与运行包门禁通过”，不能把本地测试当成真机完成证据。支付、医保授权/结算、预约写入、取消、患者绑定、二维码和 HIS 回写继续保持关闭。
