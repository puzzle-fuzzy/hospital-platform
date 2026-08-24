# 挂号记录卡片与查询状态容器修正（2026-08-24）

## 本轮目标

本轮只处理原生小程序的展示层和入口状态边界，不新增预约、取消、退号、支付、医保或 HIS 写入能力；旧 Python 服务、线上 API、MySQL 和 Redis 不在本轮修改范围内。

用户反馈集中在三点：

1. “我的挂号”列表卡片信息层级偏重，和旧端科室、医生/院区、日期时段、号序、操作的阅读顺序不一致；
2. 从“我的”进入“爽约记录”时，异常状态不应自动打开“选择就诊人”模块；只有页面内已有患者条上的“更换就诊人”才允许进入选择页；
3. 查询从“正在加载”收敛到图片空态时，不能因图片和操作文案重新挂载造成卡片高度或滚动位置跳动。

## 代码调整

### 1. 挂号卡片恢复旧端层级

`apps/miniprogram/src/pages/appointment-records/appointment-records.wxml/.wxss` 当前采用：

- 顶部左侧为科室，右侧为服务端归一化状态；“预约挂号”降为辅助文案，不再独占一行；
- 第二层仅在有数据时展示医生和院区，并用轻分隔线承托上下文；
- 日期、时段和号序改为旧端式紧凑信息块，取消偏重的蓝色整块背景，避免视觉焦点从就诊时间移开；
- 继续保留“预问诊 / 院内导航”按钮位置和旧端触摸反馈；
- 只在存在 `serialNumber` 时展示号序，避免缺少号序时出现空白行。

爽约页复用同一张卡片层级，只把状态替换为明确的 `已爽约`，不在客户端重新解释 Provider 状态。

### 2. 爽约记录不自动打开患者选择

`apps/miniprogram/src/pages/my/my.ts` 的 `missed-appointments` 入口继续使用只要求已验证平台会话的专用导航；它不调用 `navigateToPatientScopedPage`，因此没有当前患者时也先进入爽约页，由页面展示本页错误/空态。专用函数和 URL 断言位于 `patient-navigation.ts` 与验收测试中，避免后续入口重构时误复用普通患者门禁。

`apps/miniprogram/src/pages/missed-appointments/missed-appointments.wxml` 不包含患者选择器模块，也没有“点击这里选择就诊人”的空态动作。查询期间显示的是不可点击的患者骨架，只为预留患者快照空间；查询成功后，用户主动点击已提交的“更换就诊人”卡片才调用统一患者选择导航。这个限制由 `apps/miniprogram/scripts/acceptance.test.ts` 和 `patient-navigation.test.ts` 双重门禁覆盖。

### 3. 查询状态复用固定外壳

预约记录、爽约记录、报告目录、门诊费用、患者选择、普通资料、报告详情和预约目录均使用 `query-state-shell` 固定空间；加载、错误和合法空结果的内部内容在同一个外壳内切换。预约记录和爽约记录进一步让状态外壳与记录列表共用外层容器，减少列表背景、内边距和状态卡片互相替换造成的滚动抖动。

这解决了两个不同问题：

- `height/min-height` 保证图片、提示和恢复动作不会把状态卡片继续撑高；
- 同一个 WXML 外壳减少微信渲染层在 `wx:if/wx:elif` 交替挂载时的滚动位置抖动。

错误状态仍优先于空结果，Provider、会话、持久化和依赖未配置不能被显示成“暂无记录”。

## 回归门禁

本轮代码提交前应执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm exec biome check apps/miniprogram/src/pages/appointment-records/appointment-records.ts apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts apps/miniprogram/scripts/acceptance.test.ts
pnpm docs:audit
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

本轮已完成：小程序回归测试 `229 pass / 0 fail / 1708 expect()`，TypeScript、Biome、文档链接审计通过；
构建和运行包校验通过，`apps/miniprogram/dist/build-info.json.sourceRevision` 为
`356705e41852e585b07296c5e6e3dec52bce1381`，14 个页面入口存在，运行包中的测试 JS 为 0 个。
它只是运行包来源证明，不代表已经上传线上或完成真机三层业务验收。

## 未完成边界

- 当前本地候选仍未切换线上，线上小程序运行包和服务端 release 以 `docs/README.md` 的当前基线为准；
- 真实微信真机页面、客户端 requestId、服务端低敏日志三层证据仍需在对应候选上重新采集；
- 挂号详情、预问诊、预约写入、取消、退号、支付、医保授权和 HIS 回写继续关闭，不能用本轮视觉修正替代业务契约验收。
