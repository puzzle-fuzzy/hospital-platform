# 小程序四主 Tab 导航架构审计（2026-08-24）

> 本文记录重制小程序的导航结构修正。旧项目 `G:\\fuck\\hospital` 仅作为只读对照，没有修改、重启或调用旧服务。

## 1. 发现的问题

旧端的四个主入口是微信 Tab 页面：

| 顺序 | 文案 | 旧端页面 |
| --- | --- | --- |
| 1 | 医疗服务 | `pages/index/index` |
| 2 | 就诊 | `pages/consult/consult` |
| 3 | 互联网医院 | `pages/hospital/hospital` |
| 4 | 我的 | `pages/user/user` |

重制端此前只把首页和“我的”各自写了一份看起来相同的底栏 WXML。首页点击“我的”使用 `wx.navigateTo`，于是“我的”被当成普通页面压入页面栈，底栏也变成了新页面自己绘制的一份。它带来三个结构性问题：

- 底栏不是四个主入口共享的状态，而是两个页面各自维护的副本；
- 页面栈会不断堆叠主入口，返回行为与微信 Tab 页面不一致；
- 激活态用首页/我的内部写死的 `index === 0/3` 推导，第二、第三个主入口无法获得同等的页面事实。

这不是单纯的 CSS 对齐问题，继续在两个页面复制样式只能延迟下一次不一致。

## 2. 当前修正方案

针对真机仍出现的闪动和选中态不稳定，重制端现在采用微信官方单实例
`custom-tab-bar` 结构，而不是页面级复制底栏：

```text
app.json
  └─ tabBar.custom = true
       ├─ pages/index/index       医疗服务
       ├─ pages/consult/consult    就诊
       ├─ pages/hospital/hospital  互联网医院
       └─ pages/my/my              我的

微信框架
  └─ 在四个 Tab 页面提供官方 custom-tab-bar 挂载点

共享组件 `src/custom-tab-bar/index.*`
  ├─ 根据当前页面 route 统一维护激活项
  ├─ 固定在窗口底部并处理安全区
  └─ 统一调用 switchTab，失败时回滚 selected
```

四项展示配置和路由仍唯一写入 `app.json.tabBar.list`，图标资源由共享组件的
唯一事实源 `constants/legacy-tabbar.ts` 投影。首页和“我的”不再包含
`legacy-tabbar` WXML、样式或页面级点击处理；普通业务页面也不会渲染这份组件。

### 为什么使用 `switchTab`

共享组件负责主 Tab 的点击展示和 `switchTab`，普通业务页仍使用 `navigateTo`，例如预约记录、患者选择和报告详情；登录失效回首页也复用 `switchTab`。业务代码不再自行实现页面级底栏，避免再次把 Tab 页面堆进普通页面栈。

## 3. 尚未迁移的两个主入口

“就诊”和“互联网医院”现在有正式的 Tab 页面，但只展示明确的迁移状态：

- [`apps/miniprogram/src/pages/consult/consult.ts`](../../apps/miniprogram/src/pages/consult/consult.ts)：不调用旧端 WebSocket，不猜测排队或就诊状态；
- [`apps/miniprogram/src/pages/hospital/hospital.ts`](../../apps/miniprogram/src/pages/hospital/hospital.ts)：不复制旧端未经当前域名、登录态、回跳和真机验收的外部 web-view 地址。

这两个页面的存在是为了保证主导航结构正确，不代表对应业务已经完成。后续必须分别冻结消息/队列 contract、外部域名和登录回跳验收，才能开放真实功能。

## 4. 全量导航审计结果

本轮检查了重制端所有 `wx.navigateTo`、`wx.reLaunch`、`wx.redirectTo` 和 `wx.switchTab` 调用：

- 主 Tab 路由只出现在 `app.json.tabBar.list` 和共享组件事实源中，由官方 custom-tab-bar 管理；
- 患者选择、预约、报告、反馈和资料页仍使用普通页面导航；
- 登录失效回首页使用 `wx.switchTab`，保持共享底栏生命周期稳定；
- 首页和“我的”不再自行维护底栏或激活态；
- 未发现其它页面复制四项 `legacy-tabbar` 结构。

## 5. 验收门禁

当前代码门禁要求：

1. `app.json.tabBar.custom` 必须为 `true`，且四项文案顺序为“医疗服务、就诊、互联网医院、我的”；
2. 四个 `pagePath` 必须同时注册在 `app.json.pages`；
3. 首页和“我的”不能包含 `legacy-tabbar`；
4. 运行包必须包含唯一的 `custom-tab-bar/` 组件，但不得包含页面级重复底栏；
5. 运行包构建必须包含四个 Tab 页面脚本和所有 `iconPath/selectedIconPath` 资源；
6. 真机需要分别点击四项，确认激活图标、页面 route 和返回行为一致；普通业务页返回时不能新增第二套底栏。

本轮没有修改线上服务、旧 Python 服务、数据库、Redis 或正式小程序发布包。
