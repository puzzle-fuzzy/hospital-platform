# 候选 `13f597ea`：我的挂号、门诊缴费与未切换边界审计（2026-08-24）

> 本记录对应当前本地 Git `main` 的候选修正，不代表线上已经切换。候选已上传并通过生产配置 preflight、隔离端口运行时 smoke 和产物校验；由于服务器 `ps` 会话执行受控 systemd 操作仍需要 sudo 密码，本轮没有把 `current` 指向该候选，也没有继续重启服务。

## 一、版本与运行边界

| 项目 | 当前事实 |
| --- | --- |
| 本地候选 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 候选目录 | `/home/ps/code/hospital-platform/releases/13f597ea9ee3f65b9be858117826d948339d904a` |
| 线上当前 release | `6db3217bd3c990b009571ffd85b7da55d9ea7338` |
| 新 API | `10.0.0.3:18081`，继续运行 |
| 旧 Python API | `0.0.0.0:8001`，继续运行，未修改业务代码 |
| Worker | `inactive`，未启动 |

候选上传的 API/Worker bundle 已与本地 SHA-256 对齐。候选在 `127.0.0.1:18082` 使用真实生产环境变量启动过，`live`、连续 `ready`、系统 ping、未登录 `401` 和关闭路由 `404` 均符合预期；临时进程和 `18082` 监听已清理。

候选切换停止的原因是发布脚本无法使用 `sudo -n` 完成 systemd 操作。之后已恢复 `current` 指向线上原 release，并复核新 API readiness 和旧 Python `8001` 监听仍正常。这个状态不能写成“候选已部署”。

## 二、“我的”页面对照结论

旧端事实源为 `G:\\fuck\\hospital\\hospital-app\\src\\pages\\user\\user.vue` 与 `src\\jsonData\\userNavData.json`。三组标题均为“我的订单”，入口顺序如下：

1. 我的挂号、我的问诊、门诊病历、电子导诊单；
2. 我的医生、爽约记录；
3. 意见反馈、智能客服、医保电子凭证。

新端 `apps/miniprogram/src/pages/my/` 已保持上述分组、顺序、文字和本地图标；顶部背景使用 `<image>`，避免微信渲染层拒绝 WXSS 本地 `background-image`；底部导航使用固定视口定位并为安全区预留空间。患者管理仍进入独立选择页，不把首页或“我的”页面的当前用户直接当作就诊人。

未迁移入口继续显示明确的迁移提示，不伪造旧端 WebView、医生关系、医保小程序或反馈写入成功。门诊缴费不属于旧端 `userNavData.json` 菜单，仍从首页“门诊缴费”入口进入，避免为了“看起来完整”改变旧版信息架构。

## 三、门诊缴费对照结论

新端门诊缴费页已保留旧版关键布局边界：

- 顶部说明区；
- 就诊人行和院区行；
- 待缴费/已缴费双标签；
- 费用卡片、日期和金额展示；
- 患者切换、错误态、空态和本地“加载更多”。

当前实现只查询 owner-scoped 的费用读模型，服务端统一使用 `Asia/Shanghai` 计算窗口，状态固定为 `unpaid|paid`，金额以整数分传输并在渲染层拆分为元。点击费用记录只提示“支付流程正在迁移中”，不会调用 `wx.requestPayment`，也不会触发医保授权、结算、退款或 HIS 写回。

旧端页面仍包含支付、医保和退费文案；这些文案不能原样复制到新端，因为当前新端没有经过正式授权、订单、回调和回写 contract。真实非空 Provider 样例、费用详情和真机三层证据仍待补齐，空列表不能被解释为“没有业务问题”。

本轮又补充了 API 集成回归：在线范围请求继续携带日期窗口；`scope=all` 只携带完整历史范围，路由不会接受客户端的
`requestChannel`，也不会把在线日期窗口误带入全部历史查询。该回归只使用内存 Provider，不代表线上候选已经切换。

## 四、下一步

1. 继续在本地完成已开放只读页面的逻辑审计和测试，不扩大到支付、医保、病历、患者绑定、二维码或 HIS 写回；当前预约范围 HTTP 集成边界已锁定。
2. 若要让 `13f597ea` 进入线上，先由服务器管理员恢复窄权限 sudoers 或人工执行仅针对新 API 的切换；切换前后必须再次核对旧 Python `8001`。
3. 候选真正切换后，重新生成正确小程序运行包并取同一版本的手机页面、客户端 requestId、服务端 Pino 三层证据；旧 release 或历史二维码不能替代当前证据。

## 五、相关代码与文档

- 预约历史范围：`apps/api/src/modules/appointments/`、`packages/adapters/src/zhongyang-appointments.ts`、`apps/miniprogram/src/pages/appointment-records/`。
- 我的页面：`apps/miniprogram/src/pages/my/`。
- 门诊缴费：`apps/api/src/modules/outpatient-payments/`、`packages/adapters/src/zhongyang-outpatient-payments.ts`、`apps/miniprogram/src/pages/outpatient-payment/`。
- 运行路线图：`docs/roadmap-next-phase.md`。
