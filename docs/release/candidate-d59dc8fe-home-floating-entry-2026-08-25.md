# 小程序候选 `d59dc8fe`：首页悬浮客服入口收口（2026-08-25）

> 本候选在 `2f4b136f` 的广度入口覆盖基础上，修正首页右下角悬浮客服入口仍只弹 Toast 的问题。它已完成 staging 构建，但没有替换被微信开发者工具占用的 live `dist/`；本次没有修改旧 Python 服务、服务器配置、MySQL、Redis 或线上微信小程序。

## 候选边界

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `d59dc8fe1369cfb251710c6b6fcf6447857c9448` |
| 已验证 staging | `.local/hospital-miniprogram/pending/` |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 页面数量 | 17 |
| 小程序测试 | 249 pass / 0 fail / 2010 expect() |
| 测试脚本 | 0 |
| 发布结果 | staging 和类型/测试门禁通过；替换 live 时收到 Windows `EBUSY`，pending 已保留 |

## 本次修正

首页悬浮客服按钮现在复用固定的 `smart-customer` 状态 key，进入统一迁移状态页；不再停留在首页只显示一次 Toast，也不打开旧端未验收的 WebView。这样首页所有可见的未完成入口都具备一致的可解释落点。

这仍然只解决入口覆盖和交互反馈，不代表智能客服业务、外部域名、登录态隔离或客服会话已经迁移完成。

## 发布操作

关闭微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布成功后再从新的 `dist/` 生成二维码；当前旧 live 运行包和旧二维码不能证明本候选。
