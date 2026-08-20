# 小程序 `single-flight.test.js` ENOENT 恢复记录（2026-08-20）

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
