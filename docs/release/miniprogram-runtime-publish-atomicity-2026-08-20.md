# 小程序运行包发布竞态修复（2026-08-20）

## 结论

这次真机调试出现的 `pages/report-directory/report-directory.js` 404，根因不是
`app.json` 没有注册报告页面，也不是服务端 API 404，而是构建脚本在开发者工具
持续监听 `dist/` 时先删除了整个运行目录。

旧流程的顺序是：

1. 删除 `apps/miniprogram/dist/`；
2. 执行 TypeScript 编译；
3. 复制 WXML、WXSS、JSON 和静态资源；
4. 开发者工具在第 1 步到第 3 步之间读取页面文件。

TypeScript 编译和静态资源复制尚未完成时，`dist/pages/report-directory/` 自然不
存在，开发者工具就会报告 `report-directory.js file not found`。这解释了为什么
同一个候选有时能打开、有时刷新后 404：这是运行包发布竞态，不是业务接口随机返回。

## 现场证据

2026-08-20 09:30 CST 的微信开发者工具日志为：

`C:\Users\18267\AppData\Local\微信开发者工具\User Data\bcec9ed9590ec02ab0a1df532dd6cff0\WeappLog\logs\2026-08-20-09-20-23-753-zsDrxbpuvi.log`

日志确认开发者工具监听的项目是：

`E:\__Super_Core__\hospital-platform\apps\miniprogram`

在 `compile onFileChange unlinkDir dist` 之后，工具依次观察到：

- `unlink dist/app.js`
- `unlink dist/app.json`
- `unlink dist/build-info.json`
- `unlinkDir dist/pages`
- 后续才重新出现 `dist/pages/report-directory/report-directory.js`

因此，开发者工具确实看到了一个暂时不完整的运行目录。

## 修复方案

现在构建脚本使用两个目录：

- `stagingRuntime`：在 `.hospital-runtime-staging-*` 临时目录中完成 TypeScript 编译、
  静态资源复制、来源指纹写入和所有页面文件门禁；
- `runtime`：即开发者工具使用的 `dist/`，只有 staging 全部通过后才替换。

发布器 `apps/miniprogram/scripts/runtime-publisher.ts` 的顺序为：

1. 确认 staging 目录存在；
2. 将旧 `dist/` 移到同级临时备份；
3. 将完整 staging 目录移入 `dist/`；
4. 发布失败且新目录尚未安装时，恢复旧 `dist/`；
5. 发布成功后清理备份和临时目录。

这把“开发者工具可能看到不完整目录”的窗口从整个编译过程压缩为目录替换期间的
文件系统操作窗口。Windows 下如果微信开发者工具持有目录锁，发布器会失败并保留
旧运行包，要求关闭编译/真机调试后重试，不会退化成先删除 `dist/`。

运行包来源指纹同时纳入发布器本身；否则只修改发布逻辑却继续显示旧来源提交，会让
验收人员误以为正在运行另一份候选。

## 本地验证

在项目根目录执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

验收时必须确认：

- `apps/miniprogram/dist/build-info.json` 的 `sourceRevision` 与待验收提交一致；
- `apps/miniprogram/dist/pages/report-directory/report-directory.js` 存在；
- `runtime:verify` 通过后再让微信开发者工具重新编译；
- 真机仍需重新扫描当前候选二维码，不能把本地构建通过当作真机验收。

## 影响边界

本次只修改新项目的小程序构建与测试代码及文档：

- 没有修改旧 Python 项目；
- 没有重启旧服务；
- 没有修改阿里云转发、MySQL、Redis、医保或 Provider 配置；
- 没有修改并行会话维护的 `apps/miniprogram/project.config.json`；
- 不改变业务 API、微信授权、患者、预约、支付或医保语义。

这项修复只解决运行包发布竞态。微信授权、患者切换、预约/费用只读业务以及真实
支付、医保和 HIS 链路仍须按 [`next-business-gates-2026-08-20.md`](next-business-gates-2026-08-20.md)
分别取得真机、HTTP 和服务日志三层证据。
