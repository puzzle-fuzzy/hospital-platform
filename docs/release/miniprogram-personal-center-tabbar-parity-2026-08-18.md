# 原生小程序个人中心底栏一致性修正（2026-08-18）

## 结论

已修正原生“我的挂号”页与旧端公共布局之间的视觉差异：旧端
`pagesB/user/my_registration.vue` 使用 `default` layout，因此除了“我的”页之外，
挂号记录页也会固定展示四项底部导航。原生页现在直接复用
`constants/legacy-tabbar.ts`，第 4 项“我的”保持激活态。

本次只修正页面结构、固定定位和安全区留白，不改变预约历史 API、状态筛选、患者 owner
校验、Provider 调用或任何预约写入能力。

## 代码变化

- `apps/miniprogram/src/pages/appointment-records/appointment-records.wxml`
  - 增加固定底部导航，图标和文案与首页/“我的”页共用同一份常量；
  - 未迁移的 Tab 继续显示迁移提示，首页仍通过 `reLaunch` 返回。
- `apps/miniprogram/src/pages/appointment-records/appointment-records.wxss`
  - 增加 130rpx 业务栏和安全区样式；
  - 无记录/加载状态额外预留底栏空间，避免固定栏覆盖状态内容。
- `apps/miniprogram/src/pages/appointment-records/appointment-records.ts`
  - 增加页面级底栏事件，不与“在线挂号/全部挂号”筛选事件混用。
- `docs/migration/personal-center-visual-contract.md`
  - 明确旧端继承公共布局的“我的挂号”页也属于固定底栏契约。

## 验证证据

在未修改用户已有 `apps/miniprogram/project.config.json` 的前提下：

- 小程序测试：92 项通过，886 个断言通过；
- 小程序 TypeScript：通过；
- 小程序构建：通过，14 个 `app.json` 页面脚本均生成；
- Biome lint：通过；
- `git diff --check`：通过；
- 真机视觉：仍需在微信开发者工具/真机确认底栏实际位置、图标垂直居中和安全区表现。

## 当前边界

本次没有开放挂号详情、预问诊、取消、退号、支付、医保或 HIS 写入。线上新 API
`52e9624` 的生产切换和旧 Python 服务共存证据仍以
[`52e9624-production-acceptance-2026-08-18.md`](52e9624-production-acceptance-2026-08-18.md)
为准；本次小程序包尚未单独发布。
