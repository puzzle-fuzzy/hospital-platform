# 原生小程序 `single-flight.test.js` ENOENT 复核（2026-08-21）

## 结论

本次收到的真机调试错误：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

当前源码、构建脚本和运行包均未把 `single-flight.test.ts` 当作微信运行时模块：

- `apps/miniprogram/src/services/single-flight.ts` 只编译为运行文件 `dist/services/single-flight.js`；
- `apps/miniprogram/src/services/single-flight.test.ts` 仅属于 Bun 测试输入；
- `tsconfig.build.json` 明确排除 `src/**/*.test.ts` 和 `src/**/*.spec.ts`；
- 构建发布前和 `runtime:verify` 都会阻断 `dist/**/*.test.js`、`dist/**/*.spec.js`；
- 当前 `dist/` 中 `single-flight.js` 存在，`single-flight.test.js` 不存在，测试脚本数量为 0。

因此不能通过手工复制测试脚本到 `dist/` 修复。该错误是开发者工具或旧真机调试会话仍引用旧增量模块索引的表现，不能据此判断当前业务运行包缺少生产模块。

## 2026-08-21 21:02 CST 本地证据

| 检查项 | 结果 |
| --- | --- |
| 小程序运行包来源 | `24d84099eafe48e6438508f4e060c7ed701c0102` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/**/*.test.js` / `dist/**/*.spec.js` | 0 个 |
| `pnpm build` | 通过 |
| `pnpm runtime:verify` | 通过 |
| 小程序定向测试 | 197 pass / 0 fail / 1493 expects |
| 本机 `ignoreDevUnusedFiles` | `false` |

本地构建采用 staging 完成后再原子替换 `dist/`，不会在 TypeScript 编译期间清空正在被开发者工具监听的运行目录。旧 Python 服务、线上 API、数据库和 Redis 均未修改、未重启。

## 正确恢复顺序

1. 停止当前真机调试会话，关闭正在使用旧项目或旧二维码的开发者工具窗口。
2. 执行 `pnpm --filter @hospital/miniprogram build`，再执行 `pnpm --filter @hospital/miniprogram runtime:verify`。
3. 重新打开项目目录 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不要打开 `src/`，也不要继续使用旧的 `mp-weixin` 项目窗口。
4. 确认公共配置 `project.config.json` 的 `miniprogramRoot` 为 `dist/`，本机 `project.private.config.json` 的 `ignoreDevUnusedFiles` 为 `false`。
5. 在新项目窗口先执行一次普通“编译”，确认 14 个页面入口加载成功，再重新生成真机调试二维码。

如果重新建立项目窗口后仍请求 `dist/services/single-flight.test.js`，应保留开发者工具版本、项目窗口标题和错误时间，继续按增量索引/本机缓存排查；不要在 `src/` 或 `dist/` 中补测试 JS，也不要用该错误推动业务代码修改。
