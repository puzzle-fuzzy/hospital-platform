# `4da9cc09` 原生 Tab 与单一开发者工具项目边界候选记录（2026-08-24）

> 本候选只用于本地微信开发者工具和真机验收，不代表已经发布线上。功能修正基线为 `e48cfe42`，`4da9cc09` 仅补正核心构建注释格式并作为最终运行输入。旧 Python 服务、线上 API、MySQL、Redis 和正式小程序发布包均未修改。

## 本轮根因与修正

四个主入口的业务配置本身已经是微信原生 `tabBar`，但开发者工具曾在
`apps/miniprogram/src/` 下发现另一套被忽略的 `project.config.json` 和
`project.private.config.json`。同一仓库同时存在根项目和嵌套项目时，工具会监听并增量处理
`src/`，历史的自绘底栏、生成 JavaScript 或半套页面图就可能和 `dist/` 运行包混合，表现为：

- 主 Tab 切换时底栏闪动，像每个页面各有一份底栏；
- `selectedIconPath` 不稳定或完全不生效；
- 页面脚本 404，或出现已经从源码删除的旧文件；
- `dist/app.json` 与工具实际运行的页面图不一致。

本轮只保留 `apps/miniprogram/project.config.json` 作为微信项目入口，并删除本机 `src/` 下的两份嵌套配置。构建脚本发现嵌套配置时直接失败，不再尝试兼容它。

## 当前运行边界

| 项目 | 值 |
| --- | --- |
| Git 提交 | `4da9cc093c2b510bf8b48ff2c589df9302c367e0` |
| 微信项目根目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 公共配置 | `project.config.json` 的 `miniprogramRoot=dist/` |
| 原生 Tab | 医疗服务、就诊、互联网医院、我的 |

四个主 Tab 仍只来自 `src/app.json` / `dist/app.json` 的原生 `tabBar.list`；页面 WXML 不渲染第二套底栏，程序化主 Tab 跳转仍只能使用 `wx.switchTab`。普通业务页继续使用 `wx.navigateTo`。

## 构建与工具证据

已执行：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
pnpm --filter @hospital/miniprogram test
```

结果：

- `dist/build-info.json.sourceRevision` 为 `4da9cc093c2b510bf8b48ff2c589df9302c367e0`；
- 16 个 `app.json` 页面均有 `.js/.json/.wxml/.wxss`；
- `dist/app.json` 使用 `tabBar.custom=false`、`position=bottom`，四项均有不同的普通/选中图标；
- `dist/` 不包含旧自绘底栏目录、`*.test.js` 或 `*.spec.js`；
- 小程序回归测试 `234 pass / 0 fail / 1879 expect()`；
- `runtime:verify` 通过；
- 已用 CLI 关闭并重新打开唯一项目根目录，随后日志只记录嵌套配置删除，没有再记录旧底栏或源码生成 JavaScript 的运行输入。

## 真机/开发者工具验收顺序

1. 关闭旧的真机调试会话和其它同名小程序窗口。
2. 只打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不要打开 `src/` 或 `dist/`。
3. 确认项目配置显示 `miniprogramRoot=dist/`。
4. 执行一次“普通编译”，再重新生成真机调试二维码；旧二维码不作为证据。
5. 从首页依次点击四个 Tab：底栏只能有一份、固定在底部；当前项应显示对应的蓝色选中图标；切换不能把主 Tab 压入普通页面栈。
6. 如果错误路径再次出现 `src/app.json`、旧的 `custom-tab-bar` 或 `*.test.js`，立即停止业务验收，先检查 `src/` 下是否被工具重新生成 `project.config.json`，再重新关闭/打开项目。

本候选仍不开放预约写入、支付、医保、患者绑定、二维码扫码协议或 HIS 回写；真机业务的页面、客户端 requestId、服务端 Pino 和 Provider 低敏 requestId 三层证据仍需单独采集。
