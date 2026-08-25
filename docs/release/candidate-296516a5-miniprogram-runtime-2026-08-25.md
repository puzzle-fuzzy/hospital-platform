# 小程序候选运行包构建证据（2026-08-25）

## 结论

小程序代码提交 `296516a5f255c563ec5eac40f2a3439632b143b8` 已完成 TypeScript 类型检查和构建阶段的运行包静态门禁。由于微信开发者工具仍锁定 `apps/miniprogram/dist/`，构建没有覆盖当前运行包，而是按原子发布策略保留候选到：

```text
E:\__Super_Core__\hospital-platform\.local\hospital-miniprogram\pending
```

旧 `dist/` 未删除、未替换，当前开发者工具打开的旧运行包不会因为本次构建进入半成品状态。

## 候选事实

`build-info.json`：

```json
{
  "schemaVersion": 1,
  "sourceRevision": "296516a5f255c563ec5eac40f2a3439632b143b8",
  "pageCount": 20
}
```

候选静态核对结果：

- `app.json` 注册 20 个页面；每个页面的 `.js`、`.json`、`.wxml`、`.wxss` 均存在；
- 运行文件共 266 个；
- 缺失相对依赖为 0；
- workspace 裸模块引用为 0；
- `*.test.js`/`*.spec.js` 为 0；
- 生成的 `app.js` 构建来源与 `build-info.json.sourceRevision` 一致；
- TypeScript 类型检查和小程序标准回归均在构建前通过。

## 发布阻断

本次发布尝试收到 Windows `EBUSY`：

```text
apps/miniprogram/dist is locked by WeChat DevTools
```

这不是编译失败，也不是页面文件缺失。正确恢复顺序是：

1. 关闭当前小程序开发者工具窗口和真机调试会话，释放 `dist/` 文件句柄；
2. 在仓库根目录执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`；
3. 执行 `pnpm --filter @hospital/miniprogram runtime:verify`；
4. 重新打开 `apps/miniprogram/dist/` 这一独立微信工程，再普通编译和生成新的真机二维码。

不能删除 `dist/`、复制测试脚本、继续使用旧二维码，或把旧 live 包的页面结果当作本候选验收结果。

## 未完成声明

本记录只证明代码构建和运行包边界，不证明：

- 微信开发者工具已经加载本候选；
- 真机页面和底部原生 TabBar 已验收；
- 线上小程序运行包已替换；
- Provider、数据库、Redis、日志链或支付/医保业务已验收。

本次没有修改旧 Python 项目、旧服务、旧数据库、Redis 或线上运行进程。

## 2026-08-25 再次发布尝试

本轮按既定命令再次执行：

```text
pnpm --filter @hospital/miniprogram runtime:publish-pending
```

发布器在原子替换前尝试把旧 `dist` 重命名为备份目录时收到更具体的 Windows 锁定错误：

```text
EBUSY: resource busy or locked, rename
apps/miniprogram/dist -> apps/.hospital-miniprogram-backup-*
```

失败后的只读核对结果：

- `apps/miniprogram/dist/build-info.json.sourceRevision` 仍为旧运行包来源 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`；
- `.local/hospital-miniprogram/pending/build-info.json` 仍为 `296516a5f255c563ec5eac40f2a3439632b143b8`；
- 没有发现残留的发布备份目录；
- 旧 `dist` 没有被删除、清空或半替换。

因此本次仍不能执行 `runtime:verify` 通过，也不能打开旧运行包生成的二维码作为新候选证据。关闭微信开发者工具及真机调试会话后，仍需从 `runtime:publish-pending` 重新开始。

## pending 候选的独立静态验证

在 `dist/` 仍被开发者工具锁定时，可以直接验证隔离候选，不需要覆盖 live 运行包：

```powershell
$env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = "296516a5f255c563ec5eac40f2a3439632b143b8"
pnpm --filter @hospital/miniprogram runtime:verify:pending
Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION
```

该命令只读检查 `.local/hospital-miniprogram/pending/` 的独立工程配置、20 个页面文件、相对模块引用、workspace 依赖、测试脚本和
`build-info.json` 来源。完整来源指纹必须由调用者显式传入，不能由脚本从 pending 元数据自动推断；因此通过只证明候选包静态完整，
不证明它已经替换 `dist`、上传微信或完成真机业务验收。
