# 历史小程序候选运行包 `d27bddf0`（2026-08-26）

> 本候选已被 `0be59f96` 替代；当前 pending 运行包和真机验收入口请以 [`candidate-0be59f96-miniprogram-runtime-2026-08-26.md`](candidate-0be59f96-miniprogram-runtime-2026-08-26.md) 和 [`device-evidence-0be59f96-pending.json`](device-evidence-0be59f96-pending.json) 为准。本文件保留上一候选证据，仅作历史追溯。

## 当前结论

本候选由提交 `d27bddf04a5535520eed2770d7befd447bf61f9b` 构建，包含 `app.json` 注册的 40 个页面。
它已经通过 pending 运行包静态校验，但还没有替换微信开发者工具正在使用的 live `dist`，因此本记录不产生真机验收结论。
运行输入来源：`d27bddf04a5535520eed2770d7befd447bf61f9b`；发布前后的运行包都必须以对应目录的 `build-info.json` 来源指纹为准。

本候选只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上进程，也不修改另一会话维护的众阳预约适配器。

## 候选包含的业务边界修正

### 1. 患者范围页面统一会话清理

预约历史、爽约记录、报告目录、门诊费用和报告详情都注册统一的页面级会话清理器。账号会话变化时立即清理旧患者卡片、列表、金额、报告检测项和本地展开窗口，显示“登录账号已切换，请重新读取就诊人”，不把旧读模型保留在新账号下。

报告详情还会同时清除深链中的 `patientId/reportId`，使重试按钮不能重新提交上一账号的报告引用。清理回调只更新本地状态，不在新 token 写入前自动发起网络请求；页面回到前台、用户重试或重新进入入口时再读取新账号数据。

### 2. 既有安全边界继续保持

就诊二维码仍保持待开放，不生成 payload、不访问第三方二维码服务、不外发卡号或 HIS `patId`。健康数值仍是“不联网、不写患者记录、不输出临床结论”的安全子集，支付、医保、临床 Provider 和外部互联网医院能力继续 fail-closed。

## 构建与验证证据

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `d27bddf04a5535520eed2770d7befd447bf61f9b`（`d27bddf0`） |
| 页面数量 | 40 |
| pending 校验 | `pnpm --filter @hospital/miniprogram runtime:verify:pending` 通过 |
| 小程序全量回归 | 333 个测试通过；0 失败；3667 个断言 |
| TypeScript | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| lint / 格式 | 本轮变更文件格式检查通过；全仓门禁需在候选文档同步后复跑 |
| live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`，40 页 |
| 发布状态 | 未切换；微信开发者工具锁定 `apps/miniprogram/dist/`，返回 `EBUSY`；pending 已保留 |

## 下一步

关闭当前微信开发者工具项目和真机调试后，只执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布成功后，重新从 live `dist` 普通编译并生成真机二维码，再采集账号切换、患者目录、预约、报告、费用、
外部入口、临床内容和错误恢复证据。不要手工复制部分页面、修改 `build-info.json`，或把旧 live 包当成本候选。
