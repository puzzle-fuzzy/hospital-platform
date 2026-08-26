# 小程序候选运行包 `aae1297b`（2026-08-26）

## 当前结论

本候选由提交 `aae1297baae5fc3c35b38472ce724f10ba82336b` 构建，包含 `app.json` 注册的 40 个页面。
它已经通过 pending 运行包静态校验，但还没有替换微信开发者工具正在使用的 live `dist`，因此本记录不产生真机验收结论。

本候选只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上进程，也不修改另一会话维护的众阳预约适配器。

## 本候选变更

### 1. 本地健康数值工具增加规则版本

BMI 公式和血压读数校验仍然是“不联网、不写患者记录、不输出临床结论”的安全子集。
返回值增加固定 `ruleSetVersion=local-non-diagnostic-v1`，用于确认工程规则来源；它不代表临床指南版本，
也不开放健康百科、风险分级、诊断或就医建议。

### 2. 就诊人二维码安全壳增加会话门禁

二维码仍保持待开放，不生成 payload、不访问第三方二维码服务、不外发卡号或 HIS `patId`。
点击入口现在必须同时满足：

- 最近一次首页会话验证状态为有效；
- 当前页面存在患者快照；
- 患者 `clinicalAccess=ready`；
- storage 中显式选择仍与当前患者一致。

医院扫码字段、签名、TTL、撤销、防重放和扫码方验收证据仍未提供，真实二维码能力继续 fail-closed。

## 构建与验证证据

| 项目 | 结果 |
| --- | --- |
| 构建来源 | `aae1297baae5fc3c35b38472ce724f10ba82336b` |
| 页面数量 | 40 |
| pending 校验 | `pnpm --filter @hospital/miniprogram runtime:verify:pending` 通过 |
| 小程序二维码安全门禁 | 139 个 acceptance 测试通过；0 失败；2176 个断言 |
| 健康数值工具 | 4 个单元测试通过；0 失败；12 个断言 |
| TypeScript | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| 格式 | `pnpm format:check` 通过 |
| live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`，40 页 |
| 发布状态 | 未切换；微信开发者工具锁定 `apps/miniprogram/dist/`，返回 `EBUSY` |

## 下一步

关闭当前微信开发者工具项目和真机调试后，只执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布成功后，重新从 live `dist` 普通编译并生成真机二维码，再按九个证据域采集登录、患者、预约、报告、费用、
外部入口、临床内容和错误恢复证据。不要手工复制部分页面、修改 `build-info.json`，或把旧 live 包当成本候选。
