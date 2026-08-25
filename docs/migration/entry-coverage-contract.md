# 迁移入口覆盖契约

## 目的

全量迁移阶段必须同时回答两个问题：

1. 旧端入口有没有稳定落点，用户是否会遇到 404 或点击无响应；
2. 这个落点是真实业务页面，还是仍在等待 Provider、临床、支付、患者绑定或外部入口材料。

`apps/miniprogram/src/services/legacy-page-catalog.ts` 是 64 个旧页面的唯一逐页事实源，
`apps/miniprogram/src/services/feature-navigation.ts` 是状态页业务 key 和安全文案的唯一事实源。
`migration-coverage.ts` 只负责把两者聚合给状态页展示，不复制台账和状态计数。

## 页面展示语义

状态页现在会展示：

- 迁移阶段：已接入原生页面、已接入安全子集或具体阻塞类型；
- 覆盖范围：该状态 key 对应的旧端入口数量；
- 下一步：需要收集的 contract、审核、回写或真实验收材料；
- 返回医疗服务：从任意阻塞入口回到微信原生共享 Tab 的首页。

“覆盖旧端入口”只证明导航闭环，不证明真实业务已经开放。页面仍然不会读取旧缓存、
调用未确认 Provider、打开任意 WebView 或发起支付。

## 维护规则

新增旧页面时，必须先补 `legacy-page-catalog.ts`，再补对应的 `FeatureKey` 或原生页面；
不能在页面里直接新增字符串状态。新增真实业务页面前，先删除对应状态页分支并同步：

```text
legacy-page-catalog.ts
feature-navigation.ts
migration-coverage.test.ts
业务 contract / API / 页面状态机 / 日志 / 验收文档
```

没有正式 Provider/HIS 材料、临床审核记录、支付回写状态机或外部主体协议时，入口继续
展示阻塞状态；这保证广度覆盖和真实业务准入不会互相污染。

## 自动化检查

```powershell
pnpm migration:audit
pnpm migration:breadth:audit
pnpm --filter @hospital/miniprogram test
```

其中迁移审计检查逐页台账、原生页面和旧仓库页面是否一致；入口广度审计检查 action、
状态 key、页面事件和四个主 Tab；覆盖聚合测试检查所有状态 key 均能生成稳定的阶段和下一步。
