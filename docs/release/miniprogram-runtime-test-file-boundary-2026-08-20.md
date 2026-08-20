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
5. 如果开发者工具仍显示旧的 `*.test.js` 路径，先在开发者工具中执行“工具/清除缓存”里的文件缓存清理，退出后重新打开
   `E:\__Super_Core__\hospital-platform\apps\miniprogram`；不要继续使用旧的 `mp-weixin` 项目窗口，也不要直接打开 `src/`。
6. 若仍出现同一 `*.test.js` 路径，记录完整错误时间和当前 `dist/build-info.json` 的 `sourceRevision`；不要手工在 `dist/` 创建测试脚本。

## 验收边界

本记录只证明运行包不会主动发布测试脚本，并不能替代微信开发者工具重新加载、真机连接和公网请求的实际验收。登录、患者同步以及后续业务仍需按请求号、服务日志和真机页面结果分别确认。

## 本轮复扫观察

2026-08-20 本轮重新扫码后，公网 readiness 仍返回 `200`，内部 journald 只观察到
`/health/ready` 和 `/health/live`，没有新的 `/auth/wechat` 或 `/patients` 请求。因此不能把
“重新扫码后没有立即报错”写成微信登录成功；下一次验收必须先确认开发者工具当前项目确实是
`E:\__Super_Core__\hospital-platform\apps\miniprogram`，再同时保存真机页面结果、请求链和服务端低敏日志。

## 本次再次复现与处理记录

用户在 2026-08-20 报告真机调试再次请求：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

本次处理按以下顺序完成：

1. 复核 `dist/`：`services/single-flight.js` 存在，`services/single-flight.test.js` 不存在，整个运行包没有 `*.test.js` 或 `*.spec.js`。
2. 重新执行 `pnpm --filter @hospital/miniprogram build` 与 `runtime:verify`，均通过；来源指纹仍为 `767ed9c`，页面数为 14。
3. 关闭当前新项目开发者工具窗口；旧的 `mp-weixin` 项目窗口保持打开。
4. 从开发者工具“打开最近项目”重新打开 `[小程序] miniprogram`，等待编译完成后重新生成真机调试二维码。

重载后的候选窗口再次显示完整首页，构建面板完成，二维码正常生成且不再显示 `end/重试`。因此本次仍确认是开发者工具对旧运行包的增量索引，而不是业务模块缺失；后续如果再次出现同一路径，必须重复“重建、校验、关闭并重新打开当前项目”流程，不能向 `dist/` 添加测试文件。

## 历史复核：3a89312 候选（2026-08-20 20:11 CST）

针对用户报告的同一路径错误，本轮在当前 `3a89312` 候选上重新执行：

1. `pnpm --filter @hospital/miniprogram build`：通过；运行包来源仍为完整提交
   `3a89312cd982ee2fc490b75515cdb6c7d58d513e`。
2. `pnpm --filter @hospital/miniprogram runtime:verify`：通过；14 个页面及根文件齐全。
3. 递归扫描 `apps/miniprogram/dist/`：测试运行时脚本数量为 0，且没有
   `single-flight.test.js` 的引用。
4. 在正确的 `miniprogram` 开发者工具窗口重新打开真机调试并等待编译完成；构建面板显示 14 个页面分析成功，
   iOS 二维码显示有效至 20:36 CST。

因此当时的错误仍应按开发者工具旧增量索引处理，不能通过复制 `single-flight.test.js` 进行“修复”。本次只证明运行包和
真机调试入口已恢复，不增加微信登录、患者同步或其他业务的真机通过结论；后续若扫码成功，仍须按页面、HTTP 请求号
和服务端低敏日志三层证据继续验收。

## 历史复核：8f80b3e 患者同步会话证明候选（2026-08-20）

随后小程序候选曾推进到 `8f80b3e`，运行包来源为
`8f80b3e30385fe3655f871673d8616cd2d31faaa`。构建和 `runtime:verify` 重新通过，
`dist/` 仍没有测试运行时脚本；同步前 `/me` 会话证明的回归测试也已通过。上一节的 `3a89312`
二维码只保留为历史证据；该候选也不再代表当前发布基线，后续真机调试必须以发布基线文档指定的运行包重新编译后现场生成二维码。

## 当前候选复核：7f157d4（2026-08-20）

本轮以仓库发布基线中的小程序来源指纹为准，重新执行了运行包构建、运行包验证和全量门禁：

1. `pnpm --filter @hospital/miniprogram build` 通过，生成 14 个注册页面脚本；`dist/build-info.json` 的完整来源指纹为
   `7f157d4cca02fa857612daec0b6aa56e328e0083`。
2. `pnpm --filter @hospital/miniprogram runtime:verify` 通过；`dist/` 递归扫描没有发现任何 `*.test.js` 或 `*.spec.js`，也没有
   `single-flight.test.js`。
3. `pnpm check` 全部通过：架构 67 项、文档链接 286 个无断链、工具测试 31 项、API 测试 184 项/772 个断言，9 个 workspace
   的类型检查和构建均通过。
4. 关闭并重新打开 `miniprogram` 开发者工具项目后，构建面板完成，调试器显示 `Errors: 0`；重新生成真机调试二维码后，当前窗口
   不再出现 `single-flight.test.js` 缺失、页面脚本缺失或 `end/重试` 运行包错误。

以上只证明当前运行包和开发者工具增量缓存边界已经恢复，不能把二维码生成或模拟器显示当作微信登录、患者同步或后续业务成功。
下一步必须使用最新 `6e6604f` 运行包取得真机页面、HTTP 请求链和服务端低敏日志三层证据；支付、医保、退款和 HIS 写入继续保持关闭。

## 当前候选更新（2026-08-21）

选择页和普通资料页会话生命周期修正后，当前真机候选已推进到 `6e6604f`，完整运行包来源为
`6e6604f8089e45ceeaaf4bcbbd57065174a59a31`；重新构建和 `runtime:verify` 均通过，运行包仍为 14 个页面且不包含测试脚本。
前文 `7f157d4` 只保留为历史运行包证据，不能继续生成当前真机二维码。
