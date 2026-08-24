# `4da9cc09` 本地原生 TabBar 与只读业务验收手册（2026-08-24）

> 本手册只用于下一轮本地候选验收，不代表候选已经发布到线上。线上仍使用小程序运行包 `13f597e` 与服务端 release `28a5c0c1`；本地候选必须重新编译、重新生成二维码，不能复用线上或旧开发者工具缓存。

## 1. 候选来源和安全边界

| 项目 | 值 |
| --- | --- |
| 页面代码候选 | `4da9cc093c2b510bf8b48ff2c589df9302c367e0` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 运行包来源 | `dist/build-info.json.sourceRevision` 应为 `4da9cc093c2b510bf8b48ff2c589df9302c367e0` |
| 页面入口 | 16 个，四个主 Tab 为医疗服务、就诊、互联网医院、我的 |
| 服务端配套 | 线上 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，本轮不切换 |
| 旧服务 | Python `8001`，本轮不修改、不停止、不重启 |

本地候选使用微信原生 `tabBar` 统一持有四个主 Tab 和选中态；路由、普通图标和选中图标只来自 `app.json.tabBar.list`，不再存在 `custom-tab-bar` 组件或页面级自绘底栏。四个主 Tab 同时关闭页面级滚动，内容只在各自 `scroll-view` 内滚动。主 Tab 的程序化跳转由 `switchToPrimaryTab` 强制使用 `wx.switchTab`，不会把主入口压入普通页面栈。“就诊”和“互联网医院”虽然已经是正式页面入口，但具体未迁移业务仍显示迁移状态。普通业务页面仍可使用 `navigateTo`，会话失效后的 `reLaunch` 仍是有意的安全回首页行为，不能把这两类导航混为同一问题。

四个主 Tab 的页面内容使用独立 `scroll-view`，微信原生 TabBar 固定在视口底部并由系统处理安全区；真机验收时应看到只有内容区域滚动，底栏不能随页面内容移动。

本轮明确不执行：预约下单、取消预约、详情/预问诊、支付、医保授权/结算、退款、患者新增绑定、二维码扫码协议、病历详情/附件、外部 WebView 和 HIS 写回。

## 2. 编译前门禁

在微信开发者工具中关闭旧的真机调试窗口，导入正确项目。若以前打开过 `src/`，
必须关闭该旧窗口，不要在原窗口上继续编译：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram
```

重新执行：

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

必须确认：

1. `build-info.json.sourceRevision` 与上表一致；
2. `dist/app.json` 的 `tabBar.custom` 必须为 `false`，`position` 必须为 `bottom`，`dist/custom-tab-bar/` 必须不存在，四项均有 `iconPath` 和 `selectedIconPath`；
3. `dist/pages/consult/consult.js|json|wxml|wxss` 和 `dist/pages/hospital/hospital.js|json|wxml|wxss` 均存在；
4. `dist/` 不得包含 `custom-tab-bar/`、`*.test.js` 或 `*.spec.js`；四个主 Tab 的页面配置必须为 `disableScroll:true`；
5. 普通编译无页面脚本缺失或 `single-flight.test.js` ENOENT；出现旧测试脚本路径时停止，不向 `dist/` 手工复制文件。

如果开发者工具提示 `dist/app.json` 注册了页面但找不到 `pages/consult/consult.wxml`，先关闭当前小程序窗口和真机调试，再重新执行构建与 `runtime:verify`。不要直接删除 `dist/`：构建脚本会先在项目外 staging 目录完成完整产物，再原子替换，避免开发者工具监听到半套运行包。

## 3. 四 Tab 页面验收

从首页依次点击四个底部入口，每次记录页面截图和当前页面 route：

1. 医疗服务 → `/pages/index/index`；
2. 就诊 → `/pages/consult/consult`；
3. 互联网医院 → `/pages/hospital/hospital`；
4. 我的 → `/pages/my/my`。

每个页面必须满足：

- 底部导航只有一份，固定在底部并包含四项；
- 当前项图标、颜色和文字与旧端一致，首次进入“我的”时不能先闪出“医疗服务”的蓝色激活图标；
- 点击“我的”不会产生普通页面栈的新副本，不会出现页面内容下方再嵌一套底栏；
- 从任意主 Tab 切到另一个主 Tab 使用 `switchTab` 语义，普通业务页的 `navigateTo` 不作为主 Tab 证据；
- 切回已访问过的 Tab 后，激活项与当前 route 一致。

若开发者工具允许执行页面脚本，可用只读方式观察：

```js
getCurrentPages().map((page) => page.route)
```

主 Tab 切换后只能看到微信 Tab 页面栈语义，不应因点击“我的”多出一个同内容普通页面。

## 4. 患者和只读业务顺序

必须先完成微信登录和 `/me` 当前 owner 证明，再进入以下步骤。每一项都要同时保存：

- `page`：页面截图和低敏观察摘要；
- `client`：方法、无查询参数的公共路径、状态码、客户端 `requestId`；
- `server`：同一链的 Pino `traceId`、业务事件和成功/失败计数；
- `providerRequestId`：仅记录低敏 Provider 请求号；无 Provider 请求时写“不适用”。

| 顺序 | 页面动作 | 允许的业务事实 | 停止条件 |
| --- | --- | --- | --- |
| 1 | 进入选择就诊人并刷新 | 目录同步完成后才能点击；关系 `other` 只展示“其他”；卡号只展示服务端脱敏值 | 未完成同步却可返回业务页、目录跨账号残留、卡号未脱敏 |
| 2 | 明确点击另一位已存在就诊人 | 返回后首页、“我的”和患者范围页面都使用新选择；不能仅以 storage 改变作为成功 | 页面仍显示旧患者、业务请求带旧患者或选择页自动静默换人 |
| 3 | “我的挂号”在线/全部 | 在线和全部是两个服务端范围，分别请求；空数组是合法业务结果，不是接口失败 | 把在线结果复制成全部、取消记录被错误删除、错误态落入空态 |
| 4 | “爽约记录” | 只筛选服务端明确的 `missed`；进入页面不自动弹出选择就诊人 | 仅因无当前患者就弹选择模块、把未知状态算爽约 |
| 5 | 门诊费用待缴/已缴 | 只读查询；切换状态重新查询；账单点击只显示迁移提示，不调用支付 | 出现 `wx.requestPayment`、医保授权、订单创建或金额由前端计算 |
| 6 | 普通个人资料 | GET 可记录只读结果；PUT/409 仅在获得专用测试资料授权后执行 | 未授权写入真实资料、资料失败清理已确认患者、冲突自动覆盖 |

## 5. 日志与脱敏规则

服务端只读查看当前时间窗口的新 API 日志，不能把旧 Python 日志或历史 release 事件回填到本候选。只保留：

- `event`、`method`、无查询参数的 `path`、状态码；
- 客户端 `requestId`、服务端 `traceId`、Provider 低敏 requestId；
- `patientCount`、`fieldCount`、`persisted` 等低敏计数/状态。

禁止保存微信 code、token、Authorization、openid、session_key、完整身份证、完整卡号、手机号、患者姓名和 Provider 原文。日志找不到同一 requestId/traceId 时，页面看起来成功也只能记为待验收。

## 6. 代码级审计结论

- 主 Tab 使用微信原生 `tabBar`，四项在 `app.json.tabBar.list` 中声明，由框架统一维护选中态；
- 患者、预约、报告、费用列表使用 `id`、`viewKey`、`departmentId`、`scheduleId` 等对应的稳定键；未发现把普通业务页误当主 Tab 或复制底栏的同类结构；
- 个人资料的 contract 只允许昵称、性别、年龄、邮箱和版本，头像、手机号、实名、身份证、微信身份和患者绑定仍不属于该接口；
- 现有代码/测试证明的是 contract 和状态机，不证明真实微信 Provider、真机页面或线上当前小程序已经完成。

## 7. 回退与停止

遇到来源指纹不一致、旧页面脚本缓存、患者跨账号显示、旧记录覆盖新选择、Provider 字段/状态未冻结、支付/医保请求或日志无法脱敏，立即停止本轮验收并回到 `pending`。不通过修改旧 Python、清理 Redis、改变数据库 schema 或添加万能转发来“修复”现场；线上只允许按新 API 发布手册回滚新 API，旧 Python `8001` 保持不动。
