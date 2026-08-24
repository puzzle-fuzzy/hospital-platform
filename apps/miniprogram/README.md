# Native WeChat Mini Program

## Visual baseline

首页和报告详情按旧端页面逐项复刻，而不是重新设计：保留旧端的 710rpx 主宽度、580rpx
就诊人卡片、4 格业务入口、340rpx 轮播区、右侧快捷图片、门诊/住院/便民四列服务布局、
四 Tab 底栏以及报告页的蓝色标题、深蓝操作条、双 Tab 和底部复诊条。旧端使用的图标和图片
集中在 `src/assets/legacy-home/`，页面只引用本地副本，避免用字符图标或新的抽象图形替代原设计。

视觉复刻不等于开放业务能力：未完成的住院、便民、健康百科、支付、二维码、云影像和分享能力
只保留原位置并给出迁移提示，不新增虚假成功路径或 provider 直连。

这里保留原生微信小程序边界：WXML、WXSS、TypeScript 源码和微信原生 API；TypeScript 源码
通过仓库构建脚本编译为微信运行所需的 JavaScript，不引入运行时框架或自定义运行时适配层。

页面只能通过 `src/services/api-client.ts` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

微信开发者工具的 `project.private.config.json` 仅用于本机设置，已加入仓库忽略；项目公共配置和业务代码不保存 provider 密钥。

仓库内只能存在 `apps/miniprogram/project.config.json` 这一套微信项目配置。不要在 `src/` 下创建或恢复 `project.config.json`、`project.private.config.json`：嵌套配置会让开发者工具同时监听源码和 `dist/`，旧的增量页面图可能造成主 Tab 闪动、选中态丢失和页面脚本 404。若本机已经存在这两个文件，请先关闭开发者工具后删除，再重新打开 `apps/miniprogram/`。

打开项目时请选择 `apps/miniprogram/`，不要直接把 `apps/miniprogram/src/` 作为微信项目根目录。
公共配置中的 `miniprogramRoot` 指向构建生成的 `dist/`，源码仍位于 `src/`；这样开发者工具和真机
始终读取真实存在的 `.js` 页面文件，不依赖工具隐式编译 TypeScript。不要直接打开 `src/`，否则本机配置副本
可能覆盖公共配置并再次按纯 JavaScript 查找错误的源码目录。

公共 `project.config.json` 和本机 `project.private.config.json` 都必须把
`miniprogramRoot` 指向同一个 `dist/`，并保持 `compileHotReLoad=false`；本机配置还必须保持
`ignoreDevUnusedFiles=false`。运行目录使用
TypeScript 生成的 CommonJS 页面脚本，开发者工具的“未使用文件”分析可能无法识别页面脚本的间接
`require` 依赖；开启该选项会把实际存在的 `services/*.js` 从调试模块图排除，造成
`module ... is not defined`。热重载会在 `dist/` 替换或页面重新编译时制造短暂的底部导航闪动，
因此构建脚本会在公共配置和本机配置任一开启时直接失败，不能作为真机 Tab 共享行为验收依据。
修改源码后先执行构建，再在开发者工具中执行一次普通编译。

如果普通编译后仍出现底部 Tab 闪动、四项同时未选中、或页面看起来混入旧的
`static/tabbar` 资源，先不要修改页面代码。开发者工具可能保留了旧项目或旧增量
文件图；确认安全服务端口已经开启后，只重置本项目的文件缓存并重新打开本项目：

```powershell
Set-Location 'E:\__Super_Core__\hospital-platform\apps\miniprogram'
& 'D:\software\微信web开发者工具\cli.bat' cache --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --clean compile --port 25799
& 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
& 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
```

CLI 必须从 `apps/miniprogram` 目录执行；如果从 monorepo 根目录执行，微信工具可能额外
启动根目录 watcher，把 `.turbo/`、README 或 `src/` 的变化带入增量编译。若管理页仍保留
根工程、`src/` 或 `dist/` 的窗口，先执行一次 `quit` 关闭全部开发者工具窗口，再从上述目录
只打开这一套工程。随后在工具中执行一次“普通编译”。这两条命令只处理当前新项目的开发者工具文件
缓存，不删除仓库文件、不清理旧项目缓存，也不影响旧服务。验收时必须看到四项底栏
始终只有一份，当前项的图标和文字为蓝色；如果仍不一致，应先检查工具窗口标题和
项目根目录，再检查 `dist/build-info.json`，不能通过新增页面级底栏来掩盖缓存问题。

开发者工具“管理”页可能同时保留 `apps/miniprogram/`、其下的 `dist/`、其下的
`src/`，以及旧 `mp-weixin` 工程卡片。只能打开标题为 `miniprogram`、路径为
`E:\__Super_Core__\hospital-platform\apps\miniprogram` 的根工程；`dist/` 是它的
运行目录，不是另一个工程，`src/` 也不是可直接编译的微信项目。2026-08-24 的本机
历史本机复核已确认根工程页面路径为 `pages/index/index`；本轮针对真机仍出现的底栏闪动和
选中态消失，已收回到微信原生 `tabBar`，不再把主导航交给会随页面生命周期重建的自定义组件。
当前最新运行输入为
`a8191c4d`（完整 revision 写入 `dist/build-info.json`），
并额外隔离 `src/`/`scripts/` 源码监听、避免对当前 Tab 重复调用 `switchTab`，以及在会话恢复期间保持患者卡片高度稳定。
本候选的真实手机选中态仍需重新普通编译后复核；若工具标题或控制台来源 revision 不符合本候选，
先关闭错误工程并按上述缓存步骤重开，再进行真机预览。

四个主入口使用微信原生 `tabBar`，四项路由、图标、选中图标和顺序唯一声明在
`src/app.json.tabBar.list` 中，并显式设置 `custom: false`、`position: bottom`。
页面 WXML 不得复制一份底栏，也不得新增 `custom-tab-bar`；选中态由微信根据
`selectedIconPath` 统一维护，避免组件生命周期重建造成先显示“医疗服务”再切换到“我的”的闪动。
业务代码若需要程序化打开主 Tab，必须调用 `src/services/patient-navigation.ts` 的
`switchToPrimaryTab`（内部使用 `wx.switchTab`，当前页目标会安全 no-op），普通业务页才使用 `wx.navigateTo`。
主 Tab 页面使用 `disableScroll: true` 和独立 `scroll-view`；微信原生 `tabBar` 由微信固定
在内容视口之外，页面自身不绘制底栏，也不为自绘底栏额外预留高度，因此只有内容区域滚动。
后续替换图标时必须同时保留普通态和选中态两份实际不同的资源，并确保
`selectedIconPath` 不复用 `iconPath`；构建脚本会同时检查路径和文件字节。

当前首页已经完成最小纵向切片：健康检查、`wx.login()` 换取服务端会话、会话恢复、服务端归属的就诊人列表和显式的就诊人同步。
首页默认使用服务端目录第一位患者，但点击顶部“更换就诊人”会进入独立的
`pages/patient-select/patient-select` 页面；选择页把当前选择的 opaque `patientId` 写入
`selected_patient_id`，返回首页后由 `onShow` 恢复，并清空上一位患者的报告和挂号记录状态。
首页卡片只显示 `displayName` 和服务端生成的 `cardNumberMasked`，不会把内部 `patientId`、众阳患者号或完整医疗卡号作为用户可见 ID。
选择页允许展示迁移遗留记录，便于用户核对姓名和脱敏卡号，但只有服务端返回
`clinicalAccess=ready` 的患者可以被选中；缺少 `his-patient` 映射的记录标记为“暂不可查”，
不会被默认选中，也不会静默切换当前患者。刷新完成前选择页保持不可返回状态，避免预约、挂号记录、报告或门诊费用页面使用未确认的临床上下文。
新增/绑定就诊人仍未开放，因为当前平台只具备真实的目录同步契约，不能在小程序侧伪造绑定成功。
页面只负责状态和交互事件；会话生命周期集中在 `src/services/session-service.ts` 和 `src/services/api-client.ts`，
其中并发登录请求使用单飞机制，日期窗口和患者/预约/报告
读模型编排集中在 `src/services/dashboard-service.ts`。新增页面应优先复用领域服务，不要在 WXML 页面里直接拼接 provider 参数。
`wx.login()` 不会弹出头像/昵称授权框；登录成功后首页会显示“微信已登录”，头像昵称不属于当前医疗登录契约。
登录后如果本地没有患者映射，页面会主动执行一次服务端患者目录同步；同步失败必须按配置或 provider 错误提示，不能展示假患者。
同步按钮只调用平台 API 的 `POST /patients/sync`；生产前缀由 `app.ts` 的 `apiPrefix=/api/v2` 注入，
本地 API 使用默认 `/api/v1`。unionId 从服务端会话解析，provider 患者号只在服务端映射表内使用。
首页的“预约挂号”入口会进入 `pages/appointment-directory/appointment-directory`，只调用平台 API 的
`GET /appointments/departments` 和 `GET /appointments/schedules`，日期范围由客户端限制为未来 7 天展示；
“我的挂号”进入 `pages/appointment-records/appointment-records`，按当前选择的内部 `patientId` 查询当前日前后各 90 天记录；
“爽约记录”单独查询过去 90 天，并只展示服务端归一化的 `missed` 状态。两页都保留本次完整查询结果，首批只渲染 10 条，
“加载更多”只展开本地已取得的数据，不代表 provider 分页。
“我的挂号”继续复刻旧端的全宽就诊人/院区行、在线/全部标签、灰色列表背景、预约状态图标、卡片操作按钮和院内导航弹窗；
点击挂号卡会给出“挂号详情暂未开放”提示，因为当前只读 contract 没有稳定的详情引用，不能用列表索引拼接旧端详情 URL。
预约目录按旧版“两列级联”复刻：左侧科室独立滚动，右侧只加载当前科室，再按日期分组并以每次 12 条的方式展示号源；
两页只读展示服务端规范化结果，预约写入、锁号、取消和支付尚未开放。
首页的“门诊缴费”进入 `pages/outpatient-payment/outpatient-payment`，按当前内部 `patientId` 查询门诊待缴/已缴摘要；
“我的”进入 `pages/my/my`，提供就诊人管理、挂号记录和门诊缴费入口，并固定底部导航栏。门诊费用页面当前只接入查询，
点击费用记录不会伪造支付，也不会把 provider 订单号、医保字段或支付凭证交给小程序；一次完整查询结果首批只渲染 10 条，
“加载更多缴费记录”只展开本地已取得的数据，不代表 provider 已支持分页。
首页报告入口进入独立的 `pages/report-directory/report-directory`，只调用平台 API 的 `GET /reports`，传入平台内部 `patientId` 和有限日期范围；服务端负责解析众阳患者号，目录页按 10 条批次展示，避免报告较多时一次性渲染。
本期只读 LIS/PACS/ECG 摘要；服务端已准备 gated LIS 详情的 opaque 引用客户端方法，
报告目录现在只在存在服务端 `reportId` 时进入原生详情页，详情页只展示白名单检测项；默认 gate 关闭时保持摘要只读，真实 provider 详情、文件下载和体检报告仍未开放。
旧端曾把完整 `medicalCardNo` 拼接到第三方二维码 URL；新端不会复用该实现。二维码只有在医院确认扫码字段、签名、短 TTL、撤销和真机设备验收后，才由服务端生成短期引用。
`api-client.ts` 已封装 `requestWechatPrepay(orderId, idempotencyKey)`，只接收服务端生成的
`payParams`；`launchWechatPayment` 只把白名单字段交给 `wx.requestPayment`，调起成功和取消都不会直接更新业务状态。
页面仍需在订单状态为 `cash_pending` 时调用它，支付最终结果必须重新读取服务端订单状态。
同时可用 `getWechatPrepay(orderId, idempotencyKey)` 读取 `not_started/pending/ready/unknown`，避免网络重试时把未知结果误报为失败。
以上只是支付领域的服务端参数与客户端安全边界封装，不代表小程序已经开放支付页面、微信支付、医保授权或结算回写；当前门诊费用仍为只读查询。
后续按业务门禁推进：微信登录/就诊人选择 → 预约目录与挂号记录 → 门诊费用只读 → 普通资料读写 →
报告 Provider contract 和只读验收 → 病历、患者绑定与健康内容等独立 contract → 支付、医保、退款和 HIS 回写最后专项。

线上默认请求 `https://test-hp.meiyi.pro`，业务前缀为 `/api/v2`。本地开发时把 `app.ts` 的 `apiBaseUrl`
改为 `http://127.0.0.1:3000`，把 `apiPrefix` 改为 `/api/v1`；健康检查同样必须经过版本前缀，线上地址是
`/api/v2/health/live`，避免落到旧服务根路径产生 404。
客户端当前只注册 `/api/v1` 和 `/api/v2` 两个公共前缀。`apiPrefix` 来自运行配置或本地缓存时，未知版本（例如
`/api/v999`）不会按正则继续拼接；本地 HTTP 回退到 `/api/v1`，公网 HTTPS 回退到 `/api/v2`。这样可以清理
旧版本缓存造成的刷新 404，同时避免把一个尚未注册的 API 版本误当作兼容接口。新增公共版本时必须同步修改
`src/services/api-client.ts`、服务端反向代理、公共 API 文档和真机验收记录。
客户端只允许本机 `localhost/127.0.0.1` 使用 HTTP，其他地址必须使用 HTTPS。完整登录启用、日志检索和真机验收
请阅读 [`docs/wechat-auth-login.md`](../docs/wechat-auth-login.md)。
小程序始终只接收平台会话，不接收 openid、session_key、医保凭证或商户配置。

开发者工具的 `sdkreport` 排查结论：当前新旧项目源码、构建产物和配置中均未发现 `sdkreport` 文件或业务引用，
因此不新增无依据的忽略规则。若开发者工具在本机生成同名诊断文件，应保留在工具本地目录，不复制到 `src/`、`dist/`
或 Git 提交中；真正需要忽略的本机配置仍由 `project.private.config.json` 负责。

构建小程序时必须使用 `pnpm --filter @hospital/miniprogram build`，该命令执行 TypeScript 类型检查、CommonJS
JavaScript 生成，并动态校验 `app.json` 的每个页面同时存在 `.json/.wxml/.wxss/.ts` 以及最终的 `.js`；
同时验证 WXML/WXSS/JSON 和 `src/assets/` 完整。微信开发者工具必须打开
`apps/miniprogram/`，由公共 `project.config.json` 将 `dist/` 作为运行根目录；不要直接打开 `src/`。

如果开发者工具最近打开记录经常恢复到旧项目，Windows 可以使用工具自带的 CLI 明确指定项目根目录：

```powershell
<微信开发者工具安装目录>\cli.bat open --project E:\__Super_Core__\hospital-platform\apps\miniprogram
```

首次使用 CLI 前，在开发者工具“设置 → 安全”中开启“服务端口”。命令的 `--project` 必须指向
`apps/miniprogram/`，不能指向 `dist/`、`src/` 或旧项目的 `mp-weixin`；公共配置会继续把 `dist/`
作为实际运行根目录。部分旧版工具在打开项目后仍会输出一次 `TypeError: d.on is not a function`，
但只要窗口标题为 `miniprogram` 且资源管理器显示新项目根目录，就应以窗口实际项目为准，并手动执行一次“编译”。

### 真机调试前验证运行包

如果微信开发者工具提示 `pages/xxx/xxx.js` 不存在，先在仓库根目录执行：

```bash
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

`runtime:verify` 只读检查 `src/app.json` 注册的全部页面，以及 `dist/` 中对应的
`.js/.json/.wxml/.wxss` 文件；它不会修改文件。开发者工具必须打开
`apps/miniprogram/`，并保持 `project.config.json` 的 `miniprogramRoot` 为 `dist/`。
不要把 `src/` 作为小程序根目录，也不要只上传单个页面目录，否则会重新出现页面
脚本缺失、页面 404 或模板/样式不一致的问题。
构建还会生成 `dist/build-info.json`，其中只有 schema 版本、完整 Git 提交号、
页面数量和构建时间。开始真机验收前应检查 `sourceRevision` 是否与验收候选提交一致；
`runtime:verify` 在 Git 工作树中会自动把该指纹与最近一次影响小程序运行输入的提交对照；验证脱离 Git 的归档包时，
请设置 `HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION` 为完整 40 位提交号。指纹不一致时
必须重新构建，不能继续导入开发者工具；
该文件不包含密钥、会话、就诊人或服务商数据。
若刷新后仍请求旧地址或提示 `.js` 文件缺失，先重新执行构建并在开发者工具中重新导入 `apps/miniprogram/`，再确认 `src/app.ts` 中的 `apiBaseUrl/apiPrefix`；
如果错误路径包含 `dist/services/*.test.js` 或其他 `*.test.js`，先关闭当前真机调试和开发者工具，再执行一次 `pnpm --filter @hospital/miniprogram build`，重新打开 `apps/miniprogram/` 后再“编译/真机调试”。这是开发者工具增量缓存指向旧测试产物的表现，不应在 `src/` 或 `dist/` 中手工补测试脚本；构建与 `runtime:verify` 都会阻止测试脚本进入运行包。
构建与 `runtime:verify` 还会扫描运行包中的相对 `require`；若出现 `single-flight.test.js` 等缺失模块引用，会在发布前直接报告引用方，不能用复制测试脚本的方式绕过。
如果构建输出 `dist/ is locked by WeChat DevTools` 或 Windows 的 `EPERM/EBUSY`，说明开发者工具仍持有 `dist/` 文件句柄：先停止真机调试，关闭所有指向该项目的开发者工具窗口，等待 `wechatdevtools.exe` 完全退出后再重新执行构建。构建失败会保留上一份完整 `dist/`，不要在工具仍运行时手工删除或移动该目录。
代码配置优先于旧的本地缓存，不会再拼出 `/api/v1/api/v2/...`。
