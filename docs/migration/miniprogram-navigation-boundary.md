# 小程序入口与共享底栏门禁

## 目的

迁移过程中页面数量会持续增加。页面“已经登记”不代表业务已经完成，但至少
不能出现注册页面缺少源文件、固定入口指向 404，或把四个主 Tab 当普通页面压入
页面栈的问题。

本项目最终使用微信原生 `tabBar`，四个主入口固定为：

- 医疗服务：`pages/index/index`
- 就诊：`pages/consult/consult`
- 互联网医院：`pages/hospital/hospital`
- 我的：`pages/my/my`

主 Tab 之间必须使用 `wx.switchTab`。普通业务页才使用 `wx.navigateTo`；不能用
`navigateTo`、`redirectTo` 或 `reLaunch` 打开主 Tab，否则会让底栏出现重复实例、
选中态丢失或页面生命周期闪动。

## 机器门禁

```powershell
pnpm miniprogram:navigation:audit
```

该审计只读取 `apps/miniprogram/src/app.json`、页面源文件、Tab 图标和 TypeScript
中的字面量导航调用，检查：

1. `app.json` 注册页面是否都有 `.json`、`.ts`、`.wxml` 和 `.wxss`；
2. 四个 Tab 是否唯一、已注册、使用原生 `tabBar` 且图标真实存在；
3. 固定字面量 URL 是否指向已注册页面；
4. 主 Tab 是否只由 `switchTab` 打开，普通页面是否误用 `switchTab`。

动态 URL 由具体导航服务的单元测试负责；本门禁不把 `feature-status` 的业务状态
误判为已完成。Provider、支付、临床审核和患者绑定仍由各自 contract 门禁控制。

## 与全量迁移的关系

这是一层入口覆盖护栏，不是业务完成证明。旧端 64 个页面仍以
`legacy-page-catalog.ts` 为逐页事实源；没有正式 contract 的页面继续落到统一状态
页。只有 contract、adapter、领域不变量、日志、自动化测试和真实链路证据齐全时，
才可以把状态页替换为真实业务页面。
