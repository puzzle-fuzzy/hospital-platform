# 小程序运行包 `single-flight.test.js` ENOENT 恢复记录（2026-08-22）

> 本文保留多个历史候选的恢复证据，不是当前发布基线。当前小程序候选以
> [`candidate-7f09bbb-local-build-2026-08-22.md`](candidate-7f09bbb-local-build-2026-08-22.md) 和
> [`miniprogram-devtools-reimport-2026-08-22-1314.md`](miniprogram-devtools-reimport-2026-08-22-1314.md) 为准；当前完整来源为
> `7f09bbb2cf32d4753795bcbc91fe23ec05eeeee6`；配套服务端 release 为
> `84370077024762d92050cf077c27f3c60302e8f8`。

## 结论

本次重新复核的错误路径为：

```text
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

当前候选运行包不应该包含该文件。`single-flight.test.ts` 是开发测试源码，构建配置会排除它；微信运行时只需要
`services/single-flight.js`。把测试脚本复制到 `dist/` 会破坏生产运行包边界，因此不采用该处理方式。

本次根因仍是微信开发者工具旧的增量模块索引或旧真机调试会话残留，不是当前业务模块缺失。

## 2026-08-22 14:56 CST 再次本地复核

针对用户再次报告的同一路径错误，本轮重新执行了当前候选的构建和运行包门禁。结果只证明本地
运行包边界正确；本轮没有把旧真机调试会话当成已恢复，也没有生成新的真机业务证据。

| 项目 | 结果 |
| --- | --- |
| 当前仓库提交 | `1e527f8361bd49b7bf77f07e0873ae9772bad64a` |
| 小程序运行输入来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227`（`41c708e1`） |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 小程序定向测试 | `216 pass / 0 fail / 1619 expect()` |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 当前运行包相对引用 | 未发现指向缺失文件的引用 |
| 旧项目、旧 Python 服务 | 未操作、未重启 |

因此，当前再次出现该错误时，恢复动作必须在微信开发者工具中完成：结束旧的真机调试会话，
关闭并重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，确认运行根目录为
`dist/`，先执行一次普通编译，再从当前运行包重新生成二维码。不能在 `dist/` 中手工创建或复制
`single-flight.test.js`；那会把测试代码重新带进运行包，并掩盖开发者工具旧模块索引问题。

## 2026-08-22 15:13 CST 当前运行包再次复核

针对用户提供的真机调试错误时间点（`2026-08-20 17:30:30`），本轮在当前发布基线重新执行构建、
运行包门禁和小程序定向测试。结果仍然表明错误路径来自开发者工具残留索引或旧真机调试会话，
不是业务代码缺少测试模块：

| 项目 | 结果 |
| --- | --- |
| 当前小程序来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227`（`41c708e1`） |
| `pnpm --filter @hospital/miniprogram build` | 通过，类型检查通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 小程序定向测试 | `216 pass / 0 fail / 1619 expect()` |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 缺失相对模块引用 | 未发现 |
| 旧项目、旧 Python 服务 | 未操作、未重启 |

本次服务器最近 45 分钟的低敏业务聚合日志也没有出现微信登录、患者、预约、门诊费用或报告业务
事件，因此不能把这条运行包 ENOENT 与服务端业务失败混为一谈。若开发者工具仍显示同一路径，
必须在正确的新项目中结束旧真机调试、关闭并重开项目、普通编译后重新生成二维码；不得复制测试脚本
到 `dist/`，也不得通过修改或重启旧服务刷新本地工具缓存。

## 2026-08-22 16:16 CST 当前工作树再次构建

针对仍可能由旧真机调试会话上报的同一路径，本轮只在新项目工作树执行构建和只读运行包检查：

| 项目 | 结果 |
| --- | --- |
| 小程序运行输入来源 | `7f09bbb2cf32d4753795bcbc91fe23ec05eeeee6`（`7f09bbb`） |
| `pnpm --filter @hospital/miniprogram build` | 通过，类型检查通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 小程序定向测试 | `217 pass / 0 fail / 1624 expect()` |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 缺失相对模块引用 | 未发现 |
| 旧项目、旧 Python 服务 | 未操作、未重启 |

因此当前代码和运行包不需要、也不允许补入 `single-flight.test.js`。如果开发者工具仍报错，
必须结束新项目的真机调试，关闭并重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，
确认 `miniprogramRoot=dist/`，先普通编译，再从当前运行包生成新二维码；旧 `mp-weixin` 项目保持不动。

## 2026-08-22 13:44 CST 当前运行包重建与开发者工具重导入

针对用户再次报告的同一路径 ENOENT，本轮从当前源码重新生成运行包，并只操作新项目
`E:\__Super_Core__\hospital-platform\apps\miniprogram`：

| 项目 | 结果 |
| --- | --- |
| 小程序运行输入来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227`（`41c708e1`） |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 小程序定向测试 | `216 pass / 0 fail / 1619 expect()` |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 正确项目普通编译 | 完成，模拟器首页正常加载 |
| 旧项目 `mp-weixin`、旧 Python 服务 | 未操作、未重启 |

随后关闭并重新打开新项目，开发者工具的旧真机调试会话和增量索引被淘汰；当前界面没有再观察到
`single-flight.test.js` ENOENT。普通编译后控制台出现的
`Cannot read property '__subPageFrameEndTime__' of null` 来自微信开发者工具基础库
`3.17.1` 的内部计时逻辑，模拟器页面仍已成功渲染；它不是本项目缺失文件或业务请求错误，暂不以此
修改业务代码。

本轮没有生成新的二维码，也没有把模拟器加载成功当成真机登录、患者、预约或费用业务验收。

## 2026-08-22 11:43 CST 当前候选复核

针对再次出现的同一路径错误，已从当前 `1b621f07` 小程序源码重新执行构建和运行包门禁：

| 项目 | 结果 |
| --- | --- |
| 当前小程序来源 | `1b621f07ab8cec04f76fc8b682d0b3114ef6e3a1` |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |

本次只刷新本地 `dist/`，没有修改旧 Python 服务、数据库、Redis 或 Provider。若开发者工具仍请求该测试路径，必须结束旧真机调试、关闭并重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram`，普通编译后再生成二维码；不可手工创建测试脚本。

## 09:47 当前候选复核

本轮针对再次报告的同一路径 ENOENT，重新从当前源码构建运行包并执行运行包门禁：

| 项目 | 结果 |
| --- | --- |
| 当前小程序候选 | `dc8cd5b8bbf99411831cc5112bc39683108cd990`（`dc8cd5b8`） |
| 运行包生成时间 | `2026-08-22 09:47:31 CST` |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 页面运行包 | `14/14` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | `0` 个 |
| 预约历史/爽约/门诊费用定向测试 | `135 pass / 0 fail` |

本轮观察到开发者工具仍保留旧的“真机调试”独立窗口，窗口显示未收到手机消息并持续出现
`received error code -1`；这说明旧调试会话的传输/增量索引尚未被工具彻底淘汰，不能把该窗口状态当成当前候选的业务结果。
本轮没有生成新的二维码，也没有取得手机页面、客户端 requestId 或服务端业务日志三层证据。

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

## 06:59 历史候选重新构建复核

针对用户反馈的：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

已在当前候选重新执行：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

结果：

- 构建成功，当前小程序来源仍为 `4e1b2e2`。
- `dist/services/single-flight.js` 存在，`dist/services/single-flight.test.js` 不存在。
- `dist/` 内 `*.test.js` / `*.spec.js` 数量为 `0`。
- `dist/pages/report-directory/report-directory.js` 存在，14 个注册页面入口均通过运行包检查。
- 开发者工具新项目窗口重新观察后，真机调试二维码正常，模拟器首页正常，未出现 `ENOENT` 或运行时错误。

这次复核不修改 `apps/miniprogram/project.config.json`、旧项目或旧服务。工作树中的该配置文件格式化改动、`.codegraph/` 和发布压缩包仍保持原样，未纳入本次提交。

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
