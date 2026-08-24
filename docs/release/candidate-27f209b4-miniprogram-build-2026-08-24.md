# 小程序候选 `27f209b4` 运行包记录（2026-08-24）

> 本记录描述本轮客户端代码修正后的本地运行包候选。它尚未替换线上当前真机基线，也不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。
> 当前线上服务端仍是 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；客户端与服务端继续采用分层发布。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 客户端提交 | `27f209b4` |
| 小程序构建来源 | `27f209b44d20ecd991ac283e4a8194ce8f18b63f` |
| 本地构建时间 | `2026-08-24` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本候选的业务修正

本轮只修正医院列表“去挂号”入口：

1. 首页正常路径继续由已验证会话进入医院列表；
2. 医院列表被深链、历史页面栈或开发者工具直接打开时，点击“去挂号”先执行安全的 `/me` 会话恢复/验证；
3. 会话验证失败按“登录已失效”和“登录服务暂不可用”区分提示，不把 `401` 伪装成预约目录空态；
4. 验证成功后才进入现有预约科室/排班只读目录，不触发患者同步、预约创建、锁号、支付或 Provider 写入；
5. 重复点击在本页面内被 `registerLoading` 阻断，避免重复导航和并发会话验证。

医院列表仍然只是单院区静态卡片。动态机构目录、院区选择、坐标路线和外部互联网医院 WebView 没有因本修正而开放。

## 静态与外部入口边界

| 入口 | 当前事实 | 未开放内容 |
| --- | --- | --- |
| 公众号说明 | 静态文案和本地通知图标 | 二维码、关注状态、订阅授权和发送结果 |
| 意见反馈 | FAQ、客服电话和用户确认后的拨号；反馈按钮仍是迁移提示 | 工单写入、附件、客服处理状态和受控配置 |
| 院内导航 | 本地静态地图、`aspectFit` 和预览 | 楼层定位、科室实时路线和地图服务 |
| 首页二维码 | 入口保持关闭/迁移提示，不外发卡号或 Provider 患者号 | 短期 token、签名、TTL、防重放、扫码回执 |
| 外部 WebView | 没有任意 URL 或旧 token exchange 入口 | 固定 audience、origin allowlist、短期会话和回调 |

旧页面名称“互联网医院”当前仍映射到已核对的静态医院列表，不等于外部互联网医院服务已经迁移。

## 门禁结果

```text
pnpm --filter @hospital/miniprogram typecheck       通过
pnpm --filter @hospital/miniprogram test            223 pass / 0 fail / 1651 expect()
pnpm --filter @hospital/miniprogram build           通过
pnpm --filter @hospital/miniprogram runtime:verify  通过
```

构建输出 `apps/miniprogram/dist/build-info.json.sourceRevision` 为完整的
`27f209b44d20ecd991ac283e4a8194ce8f18b63f`；运行包没有测试脚本、workspace 裸依赖或缺失的相对模块。

## 真机与发布边界

本候选尚未生成新的真机二维码，也没有部署客户端运行包。若要验收本修正，必须：

1. 关闭当前真机调试并重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`；
2. 确认 `miniprogramRoot=dist/`，普通编译后核对 `build-info.json.sourceRevision`；
3. 生成新的二维码，再从“医院列表 → 去挂号”验证深链会话恢复和预约目录入口；
4. 只记录页面状态、客户端低敏 `requestId` 和服务端低敏事件，不记录微信 code、openid、Authorization、患者正文或 Provider 原文。

在新的二维码和三层证据产生前，线上真机验收入口仍以既有 `13f597e` 候选记录为准。本轮没有修改旧 Python 项目、线上数据库、Redis、反向代理或并行会话维护的众阳文档自动化。
