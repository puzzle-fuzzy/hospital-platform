# `39b50d5c` 小程序运行层隔离与主 Tab 稳定候选（2026-08-24）

## 本轮处理

本轮针对真机/开发者工具反馈的“底部 Tab 闪动、选中态消失、运行包可能混入旧页面”继续收口。
源码审计确认四个主入口仍只使用微信原生 `tabBar`，没有恢复页面级底栏或 `custom-tab-bar`。

本轮增加两层防护：

- `apps/miniprogram/project.config.json` 的 `packOptions.ignore` 明确忽略 `src/`、`scripts/` 和项目说明文件；微信开发者工具只能把 `dist/` 当作小程序运行层，避免同一项目根目录下的 TypeScript 源码和已编译 JavaScript 被增量监听后混入运行图；
- 首页会话恢复时先撤销旧患者，再以固定两行占位维持患者卡片高度；“我的”页在资料读取期间保留固定单行占位。这样不泄露旧会话患者，也不会因为异步验证造成主 Tab 切回时的整页跳高。

既有边界继续保持：

- 主 Tab 只由 `app.json.tabBar.list` 提供，程序化切换只使用 `wx.switchTab`；当前页重复切换直接 no-op；
- 普通业务页仍使用 `wx.navigateTo`，不能把普通页注册成主 Tab；
- 旧 Python 服务、服务器配置、MySQL、Redis 和线上小程序均未修改。

## 来源与验证

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `39b50d5c4287f54ecc24e8564e2dc811a55c1d1b` |
| 运行包来源 | `dist/build-info.json.sourceRevision=39b50d5c4287f54ecc24e8564e2dc811a55c1d1b` |
| 页面脚本 | 16 个页面脚本完整 |
| 小程序回归 | `237 pass / 0 fail / 1901 expect()` |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包门禁 | `runtime:verify` 通过 |
| 旧服务 | 未修改、未停止、未重启 |

## 开发者工具验收

1. 关闭当前小程序窗口和真机调试会话。
2. 执行一次当前工程文件缓存重置，并重新打开根工程：

   ```powershell
   & 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
   & 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
   ```

3. 确认工程根目录是 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，配置中的 `miniprogramRoot` 是 `dist/`；不能打开 `src/` 或 `dist/` 子目录作为独立微信项目。
4. 普通编译后在控制台核对 `[医院小程序] 运行包来源` 的完整 revision 为 `39b50d5c4287f54ecc24e8564e2dc811a55c1d1b`。
5. 依次点击“医疗服务、就诊、互联网医院、我的”：只能看到一套固定底栏，当前项图标和文字保持蓝色，内容滚动不能带动底栏。
6. 在首页已有会话时切到其他主 Tab 再返回，患者卡片可以短暂显示“正在验证就诊人”，但卡片高度不能收缩，且验证期间不能展示上一轮患者。

本记录证明的是源码、构建和工程边界；本地候选尚未上传微信，也不能替代真实手机截图、客户端 requestId、服务端 Pino 日志和 Provider 低敏 requestId 的业务三层证据。
