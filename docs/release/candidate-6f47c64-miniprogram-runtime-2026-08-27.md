# 小程序候选运行包 `6f47c64`（2026-08-27）

## 当前结论

本候选由提交 `6f47c6408fe5b62025bd74fa66893f306eb7b9aa` 构建，包含 `app.json` 注册的 40 个页面。
它已通过小程序 TypeScript 检查、页面回归、构建和运行包完整性校验，并原子发布到
`apps/miniprogram/dist/` live 目录。该事实只证明本地运行包来源，不能证明微信线上版本已经上传，
也不能替代真机业务验收。

本候选只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上 Elysia 服务或另一会话维护的
众阳预约适配器。服务端无需重启，因为本候选没有服务端运行时代码变化。

## 本候选修正

就诊主 Tab 和互联网医院主 Tab 的关闭态状态卡片明确使用纵向排列、水平/垂直居中和居中文本。
此前两处只有 `display: flex`，微信默认按横向 `row` 排列，可能把插图、标题和说明挤在同一行。
两张状态卡仍维持固定高度，loading、无记录和迁移关闭态不会因为内容方向不一致而跳变。

代码注释说明了 `flex-direction: column` 的业务视觉原因；acceptance test 直接锁定两个选择器的
纵向规则，防止后续回退为只有 `display:flex` 的不完整实现。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `6f47c6408fe5b62025bd74fa66893f306eb7b9aa`（`6f47c64`） |
| 页面数量 | 40 |
| 小程序回归 | `337 pass / 0 fail / 3702 expect()` |
| TypeScript | 通过 |
| 构建 | 通过，已生成 40 个页面脚本 |
| `runtime:verify` | 通过，live `dist` 来源为 `6f47c64` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为 [`device-evidence-6f47c640-pending.json`](device-evidence-6f47c640-pending.json)。
没有真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、客户端
`requestId`、服务端 trace 和 Provider 低敏请求号。

## 下一步

当前没有运行中的微信开发者工具或真机会话，九个证据域继续保持 `pending`。后续应从本文件对应的
`apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域清单逐项采集页面、客户端 requestId、
服务端 Pino traceId 和 Provider 低敏请求号；不得把历史候选或本地静态校验当作真机业务证据。
