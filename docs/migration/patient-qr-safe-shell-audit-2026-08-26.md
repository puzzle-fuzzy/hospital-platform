# 首页就诊人二维码迁移审计（2026-08-26）

## 结论

旧端确实存在“就诊人二维码”入口，但旧实现不是医院可验收的二维码协议：它把 `medicalCardNo` 直接拼到第三方 `api.qrserver.com` 的 URL 中。这个实现没有医院签名、有效期、一次性使用、撤销和扫码方校验，不能原样迁移到新小程序，也不能把 `patId` 的字段名称误当成已确认的扫码载荷。

本轮只迁移了入口视觉和安全状态，不宣称真实二维码已完成：

- 首页仍从已确认的当前就诊人入口打开居中弹层，保持旧端 `520rpx` 卡片、`360rpx` 预览区域和关闭交互的视觉关系；
- 弹层只展示当前页面已经确认的姓名和脱敏就诊卡号；
- 预览区域明确显示“待开放”，不生成二维码、不访问第三方二维码服务、不把 `medicalCardNo`、`patId` 或任何患者标识外发；
- 当前患者对象必须同时满足最近一次会话验证有效、临床映射可用和 storage 显式选择一致，旧缓存不能单独开放入口；
- “查看迁移说明”仍进入统一 feature-status 页面，后续只替换弹层内部的安全 payload，不改变患者上下文门禁。

## 旧端证据

只读检查文件：`G:\fuck\hospital\hospital-app\src\pages\index\index.vue`。

旧逻辑在 `patientQrUrl` 中读取 `patientInfo.medicalCardNo`，再构造：

```text
https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=<medicalCardNo>
```

旧端注释写的是“只需要包含 patId 信息”，但实际变量是 `medicalCardNo`。这说明字段语义与实现已经不一致，不能拿这段代码作为医院扫码协议的事实来源。

## 新端改动

| 文件 | 作用 |
| --- | --- |
| `apps/miniprogram/src/pages/index/index.ts` | 增加患者上下文门禁、安全展示状态和关闭/说明事件；清理患者上下文时同步清空弹层字段 |
| `apps/miniprogram/src/pages/index/index.wxml` | 保留旧端居中弹层结构，使用本地占位图和明确的待开放提示 |
| `apps/miniprogram/src/pages/index/index.wxss` | 固定遮罩与弹层，不进入页面滚动区，也不与原生 TabBar 争夺布局 |
| `apps/miniprogram/src/types.ts` | 为首页数据增加显式的二维码安全壳状态和脱敏展示字段 |
| `apps/miniprogram/scripts/acceptance.test.ts` | 固定临床映射、显式选择、无第三方二维码 URL 和安全壳渲染门禁 |

## 真实二维码的准入材料

后续如果医院确实需要扫码业务，必须先拿到并记录以下 contract，再替换“待开放”壳：

1. 扫码场景、扫码方系统和最终使用的医院字段；
2. 服务端签名算法、密钥归属、有效期、nonce/一次性消费和撤销策略；
3. 服务端生成接口的 owner/患者绑定校验，以及日志中仅记录低敏 requestId 的规则；
4. 真机成功、过期、重复使用、切换患者、退出登录和服务端拒绝证据；
5. 出现协议不完整或第三方依赖未确认时，继续保持 fail-closed。

因此二维码属于“入口已迁移、真实能力仍阻断”的状态，不影响其他批次继续广度迁移。支付、医保和临床写入能力仍按原计划最后处理。

## 验证与发布边界

- 小程序回归：`288 pass / 0 fail / 3229 expect()`；
- TypeScript：`apps/miniprogram` 下 `pnpm exec tsc --noEmit` 通过；
- 代码提交：`896a83cf`，已推送 `origin/main`；
- pending 运行包：`.local/hospital-miniprogram/pending/`，来源 `896a83cfb9d8b4350664cfe97f8bee643cbca434`，20 个页面；
- `runtime:verify:pending` 通过；
- 原子发布因微信开发者工具锁定 `apps/miniprogram/dist/` 返回 `EBUSY`，因此没有覆盖当前 live `dist`，也没有产生真机验收证据；
- 旧 Python 服务、旧数据库、旧 Redis、线上服务和另一会话负责的众阳预约适配器未修改。
