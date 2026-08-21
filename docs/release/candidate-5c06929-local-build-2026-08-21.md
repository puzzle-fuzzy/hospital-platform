# 当前小程序候选构建记录（`5c06929`，2026-08-21）

## 运行包结果

本候选由提交 `5c069290e8f26f1e4d22742a8c7a4b4ad18ca3d6` 生成，服务端和旧 Python 服务均未因本次构建而修改或重启。

| 项目 | 结果 |
| --- | --- |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包验证 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 运行包来源 | `5c069290e8f26f1e4d22742a8c7a4b4ad18ca3d6` |
| 注册/编译页面 | 14 / 14 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

## 对真机 ENOENT 的判断

如果微信开发者工具仍报告：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

这不是当前运行包缺少业务模块。`single-flight.test.ts` 是 Bun 测试源码，已经被 `tsconfig.build.json` 排除；构建发布器还会在
staging 发布前扫描并拒绝 `*.test.js`/`*.spec.js`。当前 `dist` 中没有该文件，说明开发者工具仍引用旧的增量模块索引或旧的真机调试会话。

## 开发者工具恢复顺序

1. 关闭当前“真机调试”会话，不继续复用旧二维码。
2. 退出并重新打开 `E:/__Super_Core__/hospital-platform/apps/miniprogram/` 项目。
3. 确认 `project.config.json` 的 `miniprogramRoot` 为 `dist/`。
4. 执行一次“普通编译”，确认模拟器不再请求 `single-flight.test.js`。
5. 重新生成当前候选的真机调试二维码，再扫码。

不要在 `dist/` 手工创建 `single-flight.test.js`，也不要把测试源码复制进运行包；这会破坏测试与生产运行时隔离。

## 验收边界

本记录只证明本地运行包和构建门禁正确，尚未证明手机扫码后的微信登录、患者同步或其他业务页面已经完成真机三层验收。
真机验收仍需同时记录页面结果、HTTP 请求和服务端低敏日志，并确认请求对应本候选来源。
