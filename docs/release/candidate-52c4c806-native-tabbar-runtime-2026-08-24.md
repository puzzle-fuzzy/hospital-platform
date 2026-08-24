# `52c4c806` 原生 Tab 运行包与开发者工具根目录候选记录（2026-08-24）

> 本候选只用于本地开发者工具和真机验收，不代表已经发布线上。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 本轮修正

上一轮虽然已经把四个主入口切换为微信原生 `tabBar`，但开发者工具本机仍可能在
`apps/miniprogram/src/` 下保留旧的 `project.config.json`。如果工具继续打开这个目录，
它会绕过完整的 `dist/` 运行包，重新使用源码目录和旧增量页面图，真机表现就会像底栏
不是共享、切换时闪动、选中图标消失，甚至再次出现页面脚本 404。

本候选把运行边界收紧为：

- 公共 `apps/miniprogram/project.config.json` 的 `miniprogramRoot` 固定为 `dist/`；
- 若本机残留 `src/project.config.json`，只允许其兼容性地指向 `../dist/`；
- 根目录 `project.private.config.json` 关闭 `ignoreDevUnusedFiles` 和热重载，避免增量模块图或半套运行包被工具继续复用；
- 四个主 Tab 仍只由微信原生 `app.json.tabBar.list` 提供，页面没有自绘底栏，选中态只来自 `selectedIconPath`；
- `dist/build-info.json` 使用当前完整提交指纹，开发者工具必须在构建后重新编译，不能复用旧二维码。

## 来源与运行包

| 项目 | 值 |
| --- | --- |
| Git 提交 | `52c4c80651ed353ba79437827d2b11c71854b350` |
| 小程序项目根目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 页面入口 | 16 个 |
| 原生 Tab | 医疗服务、就诊、互联网医院、我的 |

## 构建证据

已执行：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
pnpm --filter @hospital/miniprogram test
```

结果：

- `dist/build-info.json.sourceRevision` 为 `52c4c80651ed353ba79437827d2b11c71854b350`；
- `dist/app.json` 的 `tabBar.custom=false`、`position=bottom`；
- 四项均拥有不同的 `iconPath` 和 `selectedIconPath`；
- `dist/custom-tab-bar/` 不存在，运行包没有 `*.test.js` 或 `*.spec.js`；
- 小程序回归 `234 pass / 0 fail / 1878 expect()`；
- `runtime:verify` 通过，16 个页面的 JavaScript、JSON、WXML、WXSS 均存在。

## 开发者工具操作顺序

1. 停止当前真机调试，关闭所有旧的小程序开发者工具窗口。
2. 关闭工具后重新打开项目根目录：
   `E:\__Super_Core__\hospital-platform\apps\miniprogram`。
3. 确认项目配置显示 `miniprogramRoot=dist/`，不要打开 `src/` 或 `dist/` 作为项目根目录。
4. 重新执行一次“编译”，再生成新的真机二维码；旧二维码和旧窗口不能作为本候选证据。
5. 依次点击四项 Tab，确认底栏始终只有一份、固定在窗口底部，当前项使用蓝色选中图标，切换不会把主 Tab 压入普通页面栈。

如果工具窗口标题或错误路径仍出现 `src/app.json`，说明打开的仍是旧项目；如果出现旧的
`dist/services/*.test.js`，说明仍在使用旧增量模块图，必须关闭工具后重新导入上述项目根目录。
不能向 `dist/` 手工复制测试脚本，也不能把 `navigateTo` 用来替代主 Tab 的 `switchTab`。

## 尚未完成

本记录只证明运行包和导航结构，不证明真实手机已经验收，也不开放预约写入、支付、医保、
患者新增绑定、二维码扫码协议或 HIS 回写。真机仍需补充页面 route、截图、客户端 requestId
和服务端日志的同链证据。
