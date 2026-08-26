# 小程序历史候选运行包 `a9963729`（2026-08-26）

> 本候选已被 `d27bddf0` 替代；当前 pending 运行包和真机验收入口请以 [`candidate-d27bddf0-miniprogram-runtime-2026-08-26.md`](candidate-d27bddf0-miniprogram-runtime-2026-08-26.md) 为准。本文保留上一批会话边界修正和运行证据，仅作历史追溯。

## 当前结论

本候选由提交 `a9963729f905030c0982f332625289ff1cd51216` 构建，包含 `app.json` 注册的 40 个页面。
它已经通过 pending 运行包静态校验，但还没有替换微信开发者工具正在使用的 live `dist`，因此本记录不产生真机验收结论。
运行输入来源：`a9963729f905030c0982f332625289ff1cd51216`；发布前后的运行包都必须以对应目录的 `build-info.json` 来源指纹为准。

本候选只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上进程，也不修改另一会话维护的众阳预约适配器。

## 候选包含的业务边界修正

### 1. 共享患者外壳和直接患者页面统一会话清理

首页、就诊、报告、费用以及临床/外部服务入口复用的患者外壳，继续执行“当前账号 `/me` owner 证明 → 患者目录读取 → owner 与会话代际重验证”。
账号会话变化时立即清理旧患者卡片，显示“登录账号已切换，请重新读取就诊人”，不把旧卡片保留在新账号下，也不把清理动作误报为空患者。

便民记录、我的快递、采血预约和消息订阅等直接患者页面也注册同一页面级清理器；清理回调只更新本地状态，不在新 token 写入前自动发起网络请求，页面回到前台、用户重试或重新进入入口时再读取新账号数据。

### 2. 既有安全边界继续保持

就诊二维码仍保持待开放，不生成 payload、不访问第三方二维码服务、不外发卡号或 HIS `patId`。健康数值仍是“不联网、不写患者记录、不输出临床结论”的安全子集，支付、医保、临床 Provider 和外部互联网医院能力继续 fail-closed。

## 构建与验证证据

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `a9963729f905030c0982f332625289ff1cd51216`（`a9963729`） |
| 页面数量 | 40 |
| pending 校验 | `pnpm --filter @hospital/miniprogram runtime:verify:pending` 通过 |
| 小程序全量回归 | 332 个测试通过；0 失败；3650 个断言 |
| TypeScript | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| lint / 格式 | `pnpm lint`、`pnpm format:check` 通过 |
| 文档链接 | `pnpm docs:audit` 通过 |
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
