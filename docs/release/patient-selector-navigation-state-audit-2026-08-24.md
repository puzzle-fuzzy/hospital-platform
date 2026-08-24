# 患者选择页导航状态审计（2026-08-24）

## 结论

本轮修正了一个只在跨页面患者同步并发时出现的原生小程序状态机缺口：统一患者选择页入口虽然会阻止第二个导航，
但旧调用方没有消费“导航没有发生”的事实，可能把爽约页留在“正在打开就诊人选择”状态。

现在导航函数返回明确的 `PatientSelectorNavigationResult`：

- `navigated`：微信 `navigateTo` 已经发起，调用方可以保持跳转中的短暂状态；
- `waiting-for-session` / `redirected-to-login`：会话门禁没有打开选择页，调用方必须结束本地跳转等待；
- `sync-in-flight`：当前会话已有患者同步，调用方必须结束跳转等待并允许用户稍后重试。

爽约页只在结果为 `navigated` 时保留跳转状态。收到其他结果时会清除
`redirectingToPatientSelector`；同步阻塞显示“就诊人正在同步，请稍后重试”，会话变化显示“登录状态已变化，请重新加载”。
这保证了“入口被业务门禁拦截”不会被渲染成永久 loading，也不会把同步中的重复操作放行。

## 验证证据

在本地候选代码上完成：

- `pnpm exec bun test src/services/patient-navigation.test.ts`：8 项通过，16 个断言通过；
- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm exec biome lint apps/miniprogram/src/services/patient-navigation.ts apps/miniprogram/src/services/patient-navigation.test.ts apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts apps/miniprogram/scripts/acceptance.test.ts`：通过；
- `git diff --check`：通过。

这是代码级候选证据，不是生产或真机证据。当前候选尚未替换线上小程序包，旧 Python `8001`、Bun `18081`、数据库、Redis 和线上 release 均未修改；支付、医保、预约写入、退款和 HIS 继续关闭。

## 后续验收

候选发布后，真机应按以下顺序观察：患者目录同步期间从首页或“我的”连续点击更换就诊人、进入爽约页再点击选择就诊人；页面应结束等待并显示可重试提示，
同步完成后再次点击应正常进入选择页。验收需同时保留小程序行为、API requestId 和服务端日志证据，不能只凭本地测试宣称完成。
