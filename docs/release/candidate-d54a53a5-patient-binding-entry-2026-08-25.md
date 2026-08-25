# 小程序候选：新增就诊人入口状态路由（2026-08-25）

> 候选来源：`d54a53a58bde9f71e60ca453ac96c8e39016ad6c`。
> 本记录描述新项目的本地候选构建，不代表微信开发者工具、真机或线上小程序已经切换。

## 1. 候选状态

| 项目 | 结果 |
| --- | --- |
| 源码提交 | `d54a53a58bde9f71e60ca453ac96c8e39016ad6c` |
| 候选目录 | `.local/hospital-miniprogram/pending/` |
| 运行包页面数 | 17 |
| 候选生成时间 | `2026-08-25T04:08:39.181Z` |
| 当前 live 运行包 | `apps/miniprogram/dist/` 仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 原子发布 | 未完成；微信开发者工具占用 `dist/`，发布器收到 Windows `EBUSY` |

类型检查和 staging 构建已完成。发布器保留旧 live 运行包，并把新候选留在 pending；没有清空或半替换
`apps/miniprogram/dist/`。

## 2. 本轮广度迁移内容

选择就诊人页的“添加就诊人”入口现在使用固定 `patient-binding` 功能键进入统一状态页：

- 用户仍能从原位置点击入口，获得稳定的页面反馈，不再停留在页面内一次性弹窗；
- 当前不会调用建档、绑卡、协议签署、解绑或任何旧 provider 写入接口；
- 不提交身份证、卡号、医院患者号，不把当前微信用户直接当作新就诊人；
- 状态页明确记录查档、建档、绑卡、幂等、最终状态查询和撤回规则仍需 contract。

这次只是迁移入口闭环，不把“能进入状态页”记为绑定业务完成。既有患者目录读取、临床映射同步和显式切换
逻辑不变。

## 3. 自动化结果

```text
pnpm --filter @hospital/miniprogram typecheck 通过
pnpm --filter @hospital/miniprogram test 通过
250 pass / 0 fail / 2041 expect() calls
```

`pnpm --filter @hospital/miniprogram build` 的 TypeScript 检查和候选 staging 通过；最后替换 live 目录时因
微信开发者工具仍持有 `apps/miniprogram/dist/` 文件锁而安全失败。该失败是可恢复的发布阻塞，不是业务构建失败。

## 4. 发布与下一步

关闭微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

然后重新打开 `apps/miniprogram/dist/` 独立工程并生成新的二维码。真机只验收入口导航和关闭态，不触发患者绑定、
二维码、预约写入、支付、医保或 HIS 回写。下一批继续按病历、健康内容、问诊/互联网医院和便民能力分域盘点；
缺少 provider、临床审核、owner/权限和回滚证据的能力保持状态页。

## 5. 变更范围

本轮只修改新项目和迁移文档，没有修改旧 Python 项目、旧服务、服务器配置、MySQL、Redis，
也没有触碰另一会话负责的众阳自动化文件。
