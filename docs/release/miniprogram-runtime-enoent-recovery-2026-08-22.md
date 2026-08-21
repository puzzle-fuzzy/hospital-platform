# 小程序运行包 `single-flight.test.js` ENOENT 恢复记录（2026-08-22）

## 结论

本次重新复核的错误路径为：

```text
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

当前候选运行包不应该包含该文件。`single-flight.test.ts` 是开发测试源码，构建配置会排除它；微信运行时只需要
`services/single-flight.js`。把测试脚本复制到 `dist/` 会破坏生产运行包边界，因此不采用该处理方式。

本次根因仍是微信开发者工具旧的增量模块索引或旧真机调试会话残留，不是当前业务模块缺失。

## 当前候选证据

| 项目 | 结果 |
| --- | --- |
| 小程序运行输入来源 | `4e1b2e224964797c103eba832323ee7074c7ad2b`（`4e1b2e2`） |
| 运行包生成时间 | `2026-08-22 06:30:57 CST` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 页面运行包 | `14/14` |
| `runtime:verify` | 通过 |
| 微信开发者工具项目 | 新项目 `apps/miniprogram/`，`miniprogramRoot=dist/` |
| 普通编译 | 通过；日志出现 `Compile json files of 14 pages` 与 `analyzing codes success` |
| 编译后调试器 | `0` 个错误，3 条基础库提示 |
| 真机二维码 | iOS + 局域网模式，显示约 `2026-08-22 06:36 CST` 失效 |
| 旧项目/旧服务 | `mp-weixin` 未操作；旧 Python 服务未修改、未重启 |

## 已执行的恢复顺序

1. 重新执行 `pnpm --filter @hospital/miniprogram build`，由 staging 运行包原子发布到 `dist/`。
2. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，检查来源指纹、14 个页面和测试脚本边界。
3. 在正确的 `miniprogram` 项目窗口执行一次普通编译。
4. 确认编译后调试器不再报告缺失测试脚本，且没有页面 `.js` 缺失。
5. 从当前候选重新打开真机调试入口并生成二维码。

## 再次出现时的处理

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
Get-ChildItem -LiteralPath apps/miniprogram/dist -Recurse -File |
  Where-Object { $_.Name -match '\\.(test|spec)\\.js$' }
```

确认扫描为空后，关闭当前真机调试会话，退出并重新打开 `apps/miniprogram/` 项目，先普通编译，再生成二维码。
不得手工创建 `single-flight.test.js`，不得继续使用旧二维码，也不得为了刷新小程序工具缓存重启或修改旧 Python 服务。

## 验收边界

本文只证明当前运行包和开发者工具入口已恢复，不能证明手机已经完成微信登录、患者同步、就诊人切换、预约历史或门诊费用验收。
后续必须使用同一候选取得页面结果、客户端 HTTP 和服务端低敏日志三层证据；在此之前，业务仍保持“代码已实现、真实验收待完成”。
