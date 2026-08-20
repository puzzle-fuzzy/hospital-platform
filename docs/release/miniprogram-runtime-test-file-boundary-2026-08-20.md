# 小程序运行包测试文件边界记录（2026-08-20）

## 现象

真机调试曾提示：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

重新扫码后可以恢复，但这类问题可能在开发者工具热重载或增量编译时再次出现。

## 核对结论

- `apps/miniprogram/tsconfig.build.json` 已将 `src/**/*.test.ts` 排除在微信运行包编译之外。
- 当前 `apps/miniprogram/dist/` 实际没有 `services/single-flight.test.js`，业务代码只依赖 `services/single-flight.js`。
- 因此错误不是小程序业务代码需要一个测试模块，而是开发者工具曾缓存过旧运行包路径，或历史构建产物被增量索引。
- 测试源码仍保留在 `src/`，继续由 TypeScript 类型检查和 Bun 测试执行；测试文件不属于微信运行时输入。

## 已加固的边界

- `scripts/build.ts` 在 staging 发布前递归扫描 `*.test.js`、`*.spec.js`，发现即阻断发布。
- `scripts/verify-runtime.ts` 对已存在的 `dist/` 做同样的只读扫描，发现测试脚本时不允许进入真机验收。
- 运行包仍采用 staging 完成后原子替换，构建失败不会清空正在被开发者工具读取的旧 `dist/`。

## 真机恢复顺序

1. 停止当前真机调试，关闭开发者工具窗口。
2. 在仓库根目录执行 `pnpm --filter @hospital/miniprogram build`。
3. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，确认页面脚本和运行包来源指纹完整。
4. 重新打开 `apps/miniprogram/`，确认项目配置的 `miniprogramRoot` 为 `dist/`，再执行编译和扫码。
5. 若仍出现同一 `*.test.js` 路径，记录完整错误时间和当前 `dist/build-info.json` 的 `sourceRevision`；不要手工在 `dist/` 创建测试脚本。

## 验收边界

本记录只证明运行包不会主动发布测试脚本，并不能替代微信开发者工具重新加载、真机连接和公网请求的实际验收。登录、患者同步以及后续业务仍需按请求号、服务日志和真机页面结果分别确认。

## 本轮复扫观察

2026-08-20 本轮重新扫码后，公网 readiness 仍返回 `200`，内部 journald 只观察到
`/health/ready` 和 `/health/live`，没有新的 `/auth/wechat` 或 `/patients` 请求。因此不能把
“重新扫码后没有立即报错”写成微信登录成功；下一次验收必须先确认开发者工具当前项目确实是
`E:\__Super_Core__\hospital-platform\apps\miniprogram`，再同时保存真机页面结果、请求链和服务端低敏日志。
