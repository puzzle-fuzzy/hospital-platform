# 当前微信原生 tabBar 运行包复核（2026-08-25）

## 当前结论

上一轮自定义底栏在真机扫码后完全没有呈现。静态构建只能证明文件存在，不能证明微信设备端自定义组件层已经挂载；
继续叠加页面级底栏会重新引入重复实例、滚动遮挡和选中态分叉。

项目最终固定使用微信原生 tabBar；`custom-tab-bar` 仅保留在历史记录中，不再作为实现候选：

- `app.json.tabBar.custom=false`、`position=bottom`；
- 原生尺寸沿用旧端基线：`height=65px`、`fontSize=10px`、`iconWidth=24px`、`spacing=3px`；
- 四个主入口、普通图标、选中图标和顺序只在 `app.json.tabBar.list` 声明；
- 页面不渲染底栏，也不维护页面级 selected；
- 主 Tab 的程序化跳转仍统一经过 `switchTab`，普通业务页仍使用 `navigateTo`；
- 页面内容通过统一安全区占位避免被原生底栏遮挡；
- 自定义 `custom-tab-bar` 源码和运行文件已从候选中移除。

这是针对真机事实的稳定性收敛。支付、医保、患者绑定、二维码、预约写入和 HIS 回写仍保持原有关闭边界。

## 运行包证据

| 项目 | 当前值 |
| --- | --- |
| 修正提交 | `c3c7eec30e9303ff9b8996876f452c05e3bd310d` |
| 运行包目录 | `apps/miniprogram/dist/` |
| `dist/build-info.json.sourceRevision` | `c3c7eec30e9303ff9b8996876f452c05e3bd310d` |
| 页面数量 | 16 |
| TabBar | `custom=false`、`position=bottom`、四项共享路由 |
| `dist/custom-tab-bar/` | 不存在 |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均不存在 |
| 小程序测试 | 本轮 240 pass、0 fail、1937 assertions |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 预览二维码 | 本轮未生成二维码；请直接打开 `apps/miniprogram/dist/` |

## 真机验收

请直接在微信开发者工具打开下面的独立运行工程，不要打开父目录、`src/` 或历史 `dist/`：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram\dist
```

普通编译后先确认启动日志包含 `微信原生 tabBar` 和本轮完整 `revision`，再依次点击“医疗服务、就诊、互联网医院、我的”，确认：

1. 底部始终只有一套四项导航；
2. 当前项显示蓝色图标和文字，其余项保持灰色；
3. 切换过程中底栏不消失、不叠加、不回到“医疗服务”；
4. 底栏固定在窗口底部，只有页面内容 `scroll-view` 滚动；
5. 进入普通业务页后底栏按微信原生 tabBar 规则隐藏，返回主 Tab 后仍由微信恢复同一套底栏。

验收时可核对 `dist/build-info.json` 的完整 revision。若仍加载旧底栏或旧选中态，先关闭历史微信工程、清理当前工程缓存并重新普通编译，不要恢复页面级底栏。

## 影响范围

本轮只修改新项目的小程序导航源码、构建门禁、测试和文档；没有修改旧 Python 服务、线上服务、服务器、MySQL、Redis 或另一会话负责的众阳自动化。
