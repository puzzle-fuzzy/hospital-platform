# 原生小程序运行包验证（2026-08-17）

本文记录报告目录页曾出现 `pages/report-directory/report-directory.js` 缺失后，当前运行包的源码、构建和只读验证结果。
本记录只覆盖小程序静态运行包完整性，不代表微信登录、患者 Provider、预约历史、报告业务或真机验收已经完成。

## 1. 验证命令

在仓库根目录执行：

```bash
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
pnpm --filter @hospital/miniprogram test
```

验证时间：2026-08-17（开发机）。

## 2. 结果

- TypeScript 类型检查通过。
- 构建脚本从 `src/app.json` 动态读取 14 个注册页面，并重新生成 14 个页面 JavaScript 文件。
- `runtime:verify` 通过：14 个页面均同时具备 `dist/` 下的 `.js/.json/.wxml/.wxss`。
- 报告目录页实际存在：`dist/pages/report-directory/report-directory.js`。
- 就诊人选择页实际存在：`dist/pages/patient-select/patient-select.js`。
- 原生小程序验收测试通过：53 项，0 失败。
- 迁移清单审计通过：14 个原生页面、64 个旧页面、190 个旧 API 路由和旧客户端基础设施清单一致。

## 3. 运行边界

微信开发者工具必须打开 `apps/miniprogram/`，并使用公共 `project.config.json` 的 `dist/` 作为
`miniprogramRoot`。源码目录 `src/` 不是上传根目录；修改 TypeScript 后必须重新执行 build，不能只在
`src/` 中新增页面文件就直接真机调试。

`runtime:verify` 是只读检查，不会删除或修改 `dist/`。若它失败，禁止继续用旧运行包进行真机验收；先修复构建产物，
再重新导入开发者工具项目。

构建和 `runtime:verify` 还会检查运行输入是否干净。只要 `src/`、构建脚本、公共 contract、锁文件或其它运行输入有
未提交/未跟踪改动，流程就会停止，避免把工作树中的新代码打进 `dist/` 却仍标记为旧提交来源。开发者工具维护的
`project.config.json` 不参与业务源码指纹，但 `build.ts` 会单独校验 `dist/` 根目录和 TypeScript 插件配置；因此不能通过
修改配置绕过运行包结构门禁。

## 4. 尚未证明的事项

本次结果不能证明：

1. 真实微信授权登录和 `/me` 会话恢复成功；
2. 患者目录、多患者切换、失效恢复和 Redis TTL 正常；
3. 预约记录、报告目录、门诊费用的真实 Provider 请求成功；
4. 开发者工具/真机页面已经使用本次本地生成的运行包；
5. 支付、医保、预约写入、HIS 回写或退款已经开放。

这些事项仍需按 [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](p0-readonly-business-acceptance-runbook-2026-08-17.md)
和对应 Provider contract 单独留存证据。
