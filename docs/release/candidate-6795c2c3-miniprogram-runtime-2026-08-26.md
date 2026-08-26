# 历史小程序候选运行包 `6795c2c3`（2026-08-26）

> 本候选已被 `0be59f96` 替代；当前 pending 运行包和真机验收入口请以 [`candidate-0be59f96-miniprogram-runtime-2026-08-26.md`](candidate-0be59f96-miniprogram-runtime-2026-08-26.md) 和 [`device-evidence-0be59f96-pending.json`](device-evidence-0be59f96-pending.json) 为准。本文件保留上一候选证据，仅作历史追溯。

## 当前结论

本候选由提交 `6795c2c3f240d6ec092000d34cf71509d81217ff` 构建，包含 `app.json` 注册的 40 个页面。
它已经通过 pending 运行包静态校验，但还没有替换微信开发者工具正在使用的 live `dist`，因此本记录不产生真机验收结论。
运行输入来源：`6795c2c3f240d6ec092000d34cf71509d81217ff`；发布前后的运行包都必须以对应目录的 `build-info.json` 来源指纹为准。

本候选只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上进程，也不修改另一会话维护的众阳预约适配器。

## 候选包含的业务边界修正

### 患者入口页面在会话事件后立即撤销旧 UI

在上一候选已经覆盖预约历史、爽约记录、报告目录、门诊费用和报告详情的基础上，本候选继续补齐以下患者/用户入口：

- 首页：清理患者卡片、二维码和目录状态；
- “我的”：清理患者数量和当前就诊人，同时由全局资料仓库清理昵称/头像；
- 就诊主 Tab：清理患者摘要、预约历史窗口和加载状态；
- 个人资料：清理昵称、年龄、邮箱和 version，防止旧账号表单继续可编辑；
- 选择就诊人：清理患者列表、选中态和延迟返回定时器；
- 患者签名页：清理患者列表和选中态。

这些监听只做本地状态清理，不在新 token 写入前自动请求；页面重新显示、用户重试或重新进入入口时再读取当前 owner 数据。这样不会出现“新账号头像 + 旧账号患者”或“旧账号资料仍可保存”的混合快照。

### 既有高风险边界继续保持

就诊二维码仍保持待开放，不生成 payload、不访问第三方二维码服务、不外发卡号或 HIS `patId`。健康数值仍是“不联网、不写患者记录、不输出临床结论”的安全子集，支付、医保、临床 Provider 和外部互联网医院能力继续 fail-closed。

## 构建与验证证据

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `6795c2c3f240d6ec092000d34cf71509d81217ff`（`6795c2c3`） |
| 页面数量 | 40 |
| pending 校验 | `pnpm --filter @hospital/miniprogram runtime:verify:pending` 通过 |
| 小程序全量回归 | 334 个测试通过；0 失败；3691 个断言 |
| TypeScript | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| Biome | 本轮变更文件格式与 lint 通过 |
| live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`，40 页 |
| 发布状态 | 未切换；微信开发者工具锁定 `apps/miniprogram/dist/`，返回 `EBUSY`；pending 已保留 |

## 下一步

关闭当前微信开发者工具项目和真机调试后，只执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布成功后，重新从 live `dist` 普通编译并生成真机二维码，再采集账号切换、患者目录、预约、报告、费用、外部入口、临床内容和错误恢复证据。不要手工复制部分页面、修改 `build-info.json`，或把旧 live 包当成本候选。
