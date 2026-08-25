# 微信开发者工具锁定运行包目录的诊断记录（2026-08-25）

## 结论

当前 `apps/miniprogram/dist` 无法被候选运行包原子替换，原因是微信开发者工具仍将该目录作为本地小程序项目打开。构建脚本已经完成编译、类型检查、运行包生成和候选留存；失败发生在最后的目录替换阶段，错误为 Windows `EBUSY`。

> **当前候选事实（2026-08-25）**：本文下方如果出现 `f97f9f0`，仅表示上一历史候选；当前待发布运行包是 `7627843a`，完整来源为 `7627843aa48ffe18651a5e5162202cbd0fd5d594`，共 20 个页面。发布和真机取证只能使用当前候选，不能使用历史候选的证据清单。

这不是服务端故障，也不是小程序业务代码编译失败。它只阻止“把已验证候选发布到开发者工具当前打开的 dist 目录”，不影响旧服务、数据库、Redis 或当前已打开的旧运行包。

## 证据

- `pnpm --filter @hospital/miniprogram test`：当前候选 `276 pass / 0 fail / 2915 expect()`。
- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram runtime:verify:pending`：通过，候选来源为 `7627843a`，包含 20 个页面和根文件。
- `pnpm --filter @hospital/miniprogram build`：编译和候选生成通过；发布阶段因为 `EBUSY` 保留候选，没有覆盖旧 `dist`。
- Windows 微信开发者工具本地工作区记录显示，当前项目路径为：
  `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist`。
- 本机存在多个微信开发者工具渲染/工作区进程；不能把所有微信相关进程视为目标进程，因为其中还可能包含其他微信插件或独立应用。

## 安全处理原则

1. 构建失败时保留 `.local/hospital-miniprogram/pending/`，不删除候选。
2. 不自动结束微信开发者工具进程，不强杀所有 `WeChatAppEx`，不触碰与本项目无关的微信插件。
3. 不直接删除或覆盖当前 `dist`，避免真机调试继续使用时出现半发布状态。
4. 只有在用户关闭本项目的开发者工具窗口、停止该项目的真机调试并确认目录可写后，才执行 `runtime:publish-pending`。
5. 发布后必须重新运行 `runtime:verify`、重新普通编译并生成同一候选的开发者工具/真机证据；旧运行包上的页面现象不能升级为新候选证据。

## 下次发布操作

在微信开发者工具中只关闭 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` 这个项目，保留其他微信窗口和插件运行。确认没有该项目的真机调试后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

若仍然返回 `EBUSY`，只做只读诊断并重新确认工作区路径，不删除 `dist`，也不回滚源码。发布成功后，按 `docs/release/device-evidence-7627843-pending.json` 中的 9 个业务域逐项采集页面、客户端 requestId、服务端日志和 Provider 低敏 requestId；未采集的域仍保持 `pending`。

## 当前迁移边界

该锁只影响开发者工具运行包发布，不改变广度迁移统计：旧端 64 个入口、原生 20 个页面、39 个业务入口仍处于 blocked/partial。临床、外部问诊、患者绑定、预约写入和支付医保等业务，仍需各自正式 contract 和四层/三层证据，不能因为运行包发布成功就视为完成。
