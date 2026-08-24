# `0f40ab92` 原生 Tab 候选来源日志记录（2026-08-24）

> 本记录描述本地未发布候选，不代表线上小程序已经更新。线上配套运行包仍为 `13f597e`，服务端仍为 `28a5c0c1`；旧 Python `8001`、旧数据库和旧 Redis 未修改。

## 本轮目的

上一轮真机观察仍出现“底部 Tab 闪动、选中态消失”的反馈，但源码、运行包配置和本地模拟器证据均指向微信原生 `tabBar`。本轮不重新引入自绘底栏，而是收紧开发者工具入口并增加运行包来源日志，先排除“手机/工具实际加载了旧包”这一高概率原因。

- `apps/miniprogram/project.config.json` 的 `miniprogramRoot` 固定为 `dist/`；
- 本机私有配置同样固定为 `dist/`，并关闭 `compileHotReLoad`；
- `src/app.json` 只声明一份 `custom=false`、`position=bottom` 的四项原生 Tab；
- `dist` 运行包不包含 `custom-tab-bar`、测试脚本或缺失页面脚本；
- `app.js` 启动日志会打印完整 `sourceRevision`，用于区分新候选和缓存旧包。

## 来源与状态

| 项目 | 值 |
| --- | --- |
| 小程序运行输入提交 | `0f40ab92c1c1fdb59b40b41d580bbc95c65c6022` |
| 目标运行包来源 | `0f40ab92c1c1fdb59b40b41d580bbc95c65c6022` |
| 当前 `dist/build-info.json` | 仍为上一份完整候选 `bdf4ac5722aadfc854d24b8138814c3c6742f950` |
| 阻塞原因 | 微信开发者工具/真机调试进程仍占用 `apps/miniprogram/dist`，原子替换返回 Windows `EPERM` |
| 线上服务 | `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，不切换 |

构建脚本在发布失败时保留旧完整 `dist`，不会先删除运行目录。因此本轮没有制造页面 404，也没有把半套候选交给开发者工具。

## 重新发布与验收顺序

1. 关闭所有微信开发者工具窗口和真机调试会话，确保不再占用 `dist`；
2. 在仓库根目录执行 `pnpm --filter @hospital/miniprogram build`；如果构建提示 `dist/` 被占用但显示已保留 validated pending runtime，不要删除旧 `dist/`；
3. 关闭工具后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`，再执行 `pnpm --filter @hospital/miniprogram runtime:verify`，确认输出 `revision=0f40ab9`；如果普通构建没有生成 pending 目录，才重新执行普通构建；
4. 打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不要打开 `src` 或直接打开旧 `mp-weixin`；
5. 普通编译一次，再生成新的真机调试二维码；
6. 在真机控制台确认 `[医院小程序] 运行包来源：原生 TabBar` 和完整 revision；
7. 依次点击四个主 Tab，记录只有一份固定底栏、当前项使用蓝色选中图标；
8. 若 revision 不是 `0f40ab92...`，立即停止视觉验收，说明仍在使用旧缓存/旧二维码。

真机页面、客户端 HTTP `requestId`、Provider `requestId` 和服务端 Pino 事件仍需配对记录后，才能把 P1 只读业务标记为完成。
