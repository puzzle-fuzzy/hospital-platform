# 小程序候选 `5a2214e7`：二级入口迁移状态路由（2026-08-25）

## 候选事实

| 项目 | 结果 |
| --- | --- |
| 源码提交 | `5a2214e7be1f558994e108f63caed38a887626ff` |
| 页面数量 | 17 个注册页面 |
| 类型检查 | 通过 |
| 小程序全量测试 | 250 pass / 0 fail / 2028 expect() |
| staging 构建 | 通过，pending 运行包已生成 |
| live 发布 | 未切换；微信开发者工具锁定 `dist/`，安全保留旧 live |
| pending 位置 | `.local/hospital-miniprogram/pending/` |

## 本候选处理范围

本轮按“先铺全入口、再深入真实 contract”推进，处理的是页面导航闭环，不开放新的外部业务：

- 预约目录点击号源进入固定的“预约下单”迁移状态页；
- 我的挂号点击卡片进入固定的“挂号详情”迁移状态页；
- 预约记录中的预问诊入口进入固定的“预约前预问诊”迁移状态页；
- 报告详情中的云影像、分享、复诊入口分别进入固定状态页；
- 状态页目录继续使用代码内 `FeatureKey`，不接受旧端 URL、Provider ID、患者号或任意跳转参数。

这些入口仍然不会锁号、创建预约、提交问诊、访问第三方影像、生成分享链接、创建复诊或发起支付。状态页是迁移边界的可解释落点，不代表业务已经完成。

## 发布边界

构建时 `apps/miniprogram/dist/` 被微信开发者工具占用，发布器在原子替换阶段收到 Windows `EBUSY`。发布器没有删除或覆盖旧 live，已将本候选保留在 pending。关闭开发者工具及真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新打开 `apps/miniprogram/dist/` 独立工程并重新编译、扫码；旧 `fcc6630e` 运行包不能作为本候选的真机证据。旧 Python `8001`、线上服务、MySQL、Redis 和另一会话负责的众阳自动化均未修改。
