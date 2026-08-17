# 原生小程序个人中心与挂号页布局一致性修正（2026-08-18）

## 结论

已按旧端源码纠正原生“我的挂号”页的视觉边界：旧端
`pagesB/user/my_registration.vue` 使用 `default` layout，而
`src/layouts/default.vue` 不渲染底部导航。因此挂号记录页不应出现首页/“我的”页的四项底栏；
固定底栏只属于首页和“我的”页。

本次只修正页面结构、固定定位和安全区留白，不改变预约历史 API、状态筛选、患者 owner
校验、Provider 调用或任何预约写入能力。

## 代码变化

- `apps/miniprogram/src/pages/appointment-records/appointment-records.wxml`
  - 移除原生端额外添加的固定底部导航，恢复旧端 `default` 布局边界。
- `apps/miniprogram/src/pages/appointment-records/appointment-records.wxss`
  - 恢复旧端 `pb-20` 的 160rpx 底部留白；
  - 无记录状态不再为不存在的固定底栏额外预留安全区空间。
- `apps/miniprogram/src/pages/appointment-records/appointment-records.ts`
  - 移除不属于旧端页面的底栏数据、导入和事件。
- `docs/migration/personal-center-visual-contract.md`
  - 明确首页/“我的”页与挂号页的布局边界，防止再次把底栏误加到挂号页。

## 验证证据

在未修改用户已有 `apps/miniprogram/project.config.json` 的前提下：

- 小程序测试：92 项通过，884 个断言通过；
- 小程序 TypeScript：通过；
- 小程序构建：通过，14 个 `app.json` 页面脚本均生成；
- Biome format/lint、文档断链审计和全项目 `pnpm check`：通过；
- `git diff --check`：通过；
- 真机视觉：仍需在微信开发者工具/真机确认首页和“我的”页底栏位置，以及挂号页不出现额外底栏。

## 当前边界

本次没有开放挂号详情、预问诊、取消、退号、支付、医保或 HIS 写入。线上新 API
`52e9624` 的生产切换和旧 Python 服务共存证据仍以
[`52e9624-production-acceptance-2026-08-18.md`](52e9624-production-acceptance-2026-08-18.md)
为准；本次小程序包尚未单独发布。
