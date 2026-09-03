# 原生小程序反馈帮助页验收手册

本文只覆盖旧端 `pagesB/user/feedback.vue` 的静态帮助能力，不代表意见已经提交到客服系统，
也不代表客服电话和工作时间已经由新服务的受控配置管理。

## 迁移范围

| 旧端事实 | 新端证据 | 约束 |
| --- | --- | --- |
| 我的页进入意见反馈 | `pages/my/my.ts` 的 `feedback` action | 只能进入已注册的原生帮助页 |
| 意见反馈卡片 | `pages/feedback/feedback.wxml/.wxss` | 点击后保留旧端“跳转到意见反馈页面” Toast，不显示“提交成功” |
| 咨询电话卡片 | `feedback.ts` 的 `onConsultTap` | 必须用户确认后才调用 `wx.makePhoneCall` |
| 热点问题 | `HOT_ISSUES` 静态配置 | 只作为软件/流程说明，不作为医疗诊断结论 |

## 本地门禁

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm --filter @hospital/miniprogram build
```

构建后必须确认：

- `apps/miniprogram/dist/pages/feedback/feedback.js` 存在；
- `apps/miniprogram/dist/app.json` 注册 `pages/feedback/feedback`；
- 页面不调用旧 `/convenience`、`/system` 或任意 provider URL；
- 页面不写入反馈成功状态、不生成客服工单、不把患者标识提交给电话服务。

## 开发者工具/真机检查

1. 从“我的”点击“意见反馈”，确认页面显示两个咨询卡片和热点问题。
2. 点击“意见反馈”，确认只显示“跳转到意见反馈页面” Toast，不出现成功状态，也不发生实际提交。
3. 点击“咨询电话”，确认先弹出号码和工作时间；取消不会拨号，确认后才进入系统拨号。
4. 点击热点问题，确认同一时间最多展开一项，长文案不会一次性覆盖页面。
5. 断网打开页面，确认静态问题和布局仍可展示。

## 后续开放条件

真实反馈需要字段白名单、内容安全、限流、幂等键、客服工单状态、撤回/关闭语义、日志脱敏和管理端闭环；
电话号码与工作时间应改为受控配置。资料和真实接口证据到达前，不新增反馈提交 API，也不保留用户输入。
