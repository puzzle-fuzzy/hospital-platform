# 小程序 `single-flight.test.js` ENOENT 恢复记录（2026-08-20）

> 本文记录的 `6e6604f` 及更早候选均为历史窗口。当前真机入口是 [`candidate-1b9b4b0-local-build-2026-08-21.md`](candidate-1b9b4b0-local-build-2026-08-21.md)，ENOENT 修复原则不变，但二维码必须从当前候选重新生成。

## 结论

2026-08-20 17:30 左右真机调试报告：

```text
ENOENT: no such file or directory, open
E:/__Super_Core__/hospital-platform/apps/miniprogram/dist/services/single-flight.test.js
```

当前候选运行包没有该文件，也没有任何运行时代码引用它。问题来自微信开发者工具此前编译过的旧增量模块索引/旧运行包状态；已通过重新构建、普通编译和重新生成真机调试会话恢复。

## 当前证据

| 项目 | 结果 |
| --- | --- |
| 小程序运行包来源 | `8f80b3e30385fe3655f871673d8616cd2d31faaa` |
| 构建时间 | 2026-08-20 20:47 CST |
| 页面数量 | 14 个 `app.json` 页面入口 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| `runtime:verify` | 通过 |
| 微信开发者工具普通编译 | 通过，模拟器回到首页 |
| 当前真机调试 | iOS + 局域网模式二维码已重新生成，工具显示约 21:14 CST 失效 |
| 旧服务 | 未修改、未重启 |

## 根因边界

`apps/miniprogram/tsconfig.build.json` 已排除 `src/**/*.test.ts`，`scripts/build.ts` 又在 staging 发布前对 `*.test.js` 和 `*.spec.js` 做文件级硬门禁；因此测试源码不会被发布到 `dist/`。

此前的开发者工具窗口曾经使用过包含测试脚本的历史运行包。微信开发者工具的增量编译/模块索引不会因为源码目录后来原子替换就必然清除所有旧模块引用，所以真机继续请求已被删除的 `dist/services/single-flight.test.js`，形成 ENOENT。该错误不能通过在 `dist/` 中补一个测试脚本来“兼容”，否则会把开发测试代码重新带入上传包。

## 已执行的恢复顺序

1. 重新执行 `pnpm --filter @hospital/miniprogram build`，确认 staging 发布成功。
2. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`，确认来源指纹、14 个页面和运行包边界均正确。
3. 扫描 `dist/`，确认没有 `*.test.js` 或 `*.spec.js`。
4. 在微信开发者工具中关闭旧的“真机调试”会话。
5. 执行一次“普通编译”，确认模拟器不再请求缺失的测试脚本并正常进入首页。
6. 重新打开“二维码真机调试”，生成当前候选的 iOS/局域网二维码。

## 后续操作规范

若再次出现同类错误，先执行以下检查，不要把测试文件复制进 `dist/`：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
Get-ChildItem -LiteralPath apps/miniprogram/dist -Recurse -File |
  Where-Object { $_.Name -match '\\.(test|spec)\\.js$' }
```

确认扫描结果为空后，在微信开发者工具中关闭当前真机调试会话，执行“普通编译”，再重新生成二维码。若普通编译后仍引用旧文件，再关闭并重新打开当前小程序项目，让开发者工具重新建立 `dist/` 模块索引；这一步只针对本地工具，不涉及服务器和旧 Python 服务。

## 验收边界

本记录证明运行包和开发者工具的缺失文件问题已恢复，不等于真实手机已经完成微信登录、患者同步或只读业务验收。扫码后的 `/auth/wechat`、`/me`、`/patients`、`/patients/sync` 请求仍需要结合真机页面、HTTP 请求和服务端低敏日志三层证据确认。

## 后续复核（2026-08-20 21:25 CST）

用户再次反馈同一路径的 ENOENT 后，对当前候选重新执行了构建和只读检查：

| 项目 | 当前结果 |
| --- | --- |
| 当前仓库提交 | `3b2234602bdc835bdbd245b7585e916939ff6e24` |
| 小程序运行输入来源 | `ac238c6156f085fdb56f5806fefac3613e5f85be`（`ac238c6`） |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

因此当前运行包仍不包含 `single-flight.test.js`，也不存在应补入运行包的业务缺失文件。若开发者工具仍报告这个已经不存在的绝对路径，必须关闭当前真机调试会话并退出/重新打开当前小程序项目，让工具重新建立 `dist/` 的模块索引，然后先执行一次普通编译，再重新生成二维码。不要在 `dist/` 手工创建测试文件，也不要继续复用旧二维码；这样做会把旧增量索引或旧候选继续带入真机调试，并破坏运行包与测试代码的边界。

## 当前仓库复核（2026-08-20，`9965299`）

在后续会话中再次针对同一 ENOENT 现象执行了当前仓库复核：

| 项目 | 当前结果 |
| --- | --- |
| 当前仓库提交 | `996529907bde2ddce25c922b2c2779338554531b` |
| 运行包来源 | `ac238c6156f085fdb56f5806fefac3613e5f85be` |
| 注册页面 | 14 个 |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 小程序测试 | 169 项通过，0 项失败 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 运行包中的 `*.test.js` / `*.spec.js` | 0 个 |

这里运行包来源指纹仍为 `ac238c6`，是因为当前提交只包含服务端/文档侧后续审计，原生小程序源码没有产生新的运行包输入；这不影响运行包门禁，反而能证明构建没有把测试文件带入发布目录。

如果微信开发者工具仍打开旧项目实例或旧真机调试会话，必须执行“关闭真机调试 → 退出并重新打开当前小程序项目 → 普通编译 → 重新生成二维码”。这个问题属于本机工具的增量模块索引，不应通过改服务端、改旧 Python 服务或把测试脚本复制到 `dist/` 来处理。

## 当前候选复核（2026-08-20 22:39 CST）

针对用户在 17:30 左右再次看到的同一路径错误，已在当前工作树重新完成只读运行包检查：

| 项目 | 当前结果 |
| --- | --- |
| 当前仓库提交 | `1a85a03` |
| 当前小程序候选来源 | `457d9aee567bc77c33279a9b61db921e3011f1c1`（`457d9ae`） |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| 注册页面 | 14 个 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

因此当前代码和运行包没有需要补入的业务文件。若开发者工具继续请求这个不存在的绝对路径，仍应按“开发者工具旧增量模块索引”处理：关闭当前真机调试，退出并重新打开仓库中的 `apps/miniprogram/` 项目，确认 `project.config.json` 的 `miniprogramRoot` 为 `dist/`，先执行一次普通编译，再用当前 `457d9ae` 候选重新生成二维码。不要复制或手工创建 `single-flight.test.js`。

同一时间窗口的公网只读复核未发现新服务异常：`/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 返回 200；未携带会话访问 `/api/v2/me`、`/api/v2/patients` 返回 401。该复核没有发送微信登录、患者同步、Provider、医保或任何业务写入请求，也没有修改或重启旧 Python 服务。

## 后续候选指针（2026-08-20）

本文件前面的 `457d9ae` 记录属于当时的 ENOENT 复核窗口，不再是当前真机候选。关系语义修正后，当前小程序运行输入已推进到
`7f157d4`，完整运行包来源为 `7f157d4cca02fa857612daec0b6aa56e328e0083`；当前构建和扫码前操作以
[`candidate-7f157d4-local-build-2026-08-20.md`](candidate-7f157d4-local-build-2026-08-20.md) 和
[`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md) 为准。
ENOENT 处理原则不变：不要把 `single-flight.test.js` 复制进 `dist/`，应关闭旧真机调试、重开项目、普通编译后重新生成二维码。

## 当前候选更新（2026-08-21）

选择页和普通资料页会话生命周期修正后，当前小程序候选为 `6e6604f`，完整运行包来源为
`6e6604f8089e45ceeaaf4bcbbd57065174a59a31`。该候选已重新构建并通过 `runtime:verify`；
`dist/` 仍不存在 `single-flight.test.js` 或其它 `*.test.js`/`*.spec.js`。后续真机调试必须以该候选
重新普通编译和生成二维码，前文 `7f157d4` 及更早候选只用于历史追溯。

## 当前候选再次复核（2026-08-20 23:14 CST）

针对同一错误继续在当前工作树和已打开的 `miniprogram` 开发者工具窗口复核：

| 项目 | 当前结果 |
| --- | --- |
| 当前小程序构建来源 | `7f157d4cca02fa857612daec0b6aa56e328e0083`（`7f157d4`） |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过 |
| 注册页面/已编译页面 | 14 / 14 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| 微信开发者工具普通编译 | 通过，日志显示 `Compile json files of 14 pages` 与 `analyzing codes success` |
| 当前真机调试二维码 | 已关闭旧会话并重新生成 iOS/局域网二维码，工具显示约 23:37 CST 失效 |
| 旧服务 | Python `8001` 未修改、未重启 |

这次复核进一步排除了“当前候选缺少测试文件”的可能性。当前尚未取得手机重新扫码后的微信登录、患者同步或业务页面三层证据；二维码生成只能证明调试入口已刷新，不能证明真机业务已经验收。后续必须使用这张新二维码扫码，并按页面、HTTP、服务端低敏日志三层关联记录。

## 当前候选再次恢复（2026-08-21 03:23 CST）

后续真机验收前重新核对了当前候选和开发者工具状态。之前窗口中显示的二维码已于
`01:17` 失效，不能继续扫码；这解释了在运行包已经正确而真机仍未形成有效业务链的情况。

本次只在本地新项目和微信开发者工具中操作：先重新执行普通编译，再关闭旧的真机调试会话，
通过模式切换触发新的代码包生成，最后选择 iOS/局域网模式重新生成二维码。服务端只做了
journald 只读观察，没有部署、重启、配置写入或业务请求。

| 项目 | 当前结果 |
| --- | --- |
| 服务端配套 release | `6038560` |
| 小程序运行包来源 | `6e6604f8089e45ceeaaf4bcbbd57065174a59a31`（`6e6604f`） |
| 运行根目录 | `apps/miniprogram/dist/` |
| 普通编译 | 通过，日志出现 `analyzing codes success` |
| 代码包 | 约 606 KB，14 个页面入口 |
| 当前二维码 | iOS + 局域网模式，约 03:48 CST 失效 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 测试运行脚本 | `*.test.js` / `*.spec.js` 均为 0 |
| 手机连接 | 当前尚未观察到 |
| 服务器日志 | 最近 30 分钟仅有 readiness 健康检查，无微信/患者业务事件 |
| 旧 Python `8001` | 未修改、未重启 |

因此，当前可以继续使用这张新二维码进行真机验收，但必须从“微信登录 → `/me` → 患者同步”开始；
不能把二维码显示、模拟器已登录患者或普通编译成功当作真实业务完成。若手机再次报同一
`single-flight.test.js` ENOENT，应立即停止扫码并记录错误时间，不应在 `dist/` 中补测试文件。
