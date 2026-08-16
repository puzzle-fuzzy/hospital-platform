# 首页迁移核对与未迁移清单

本文档以旧端 `G:\\fuck\\hospital\\hospital-app\\src\\pages\\index\\index.vue`、
`src/jsonData/homeNavData.json` 为基准，记录原生小程序首页的真实迁移边界。
“已接入”只表示新端有自己的页面和平台 API，不代表众阳、微信、医保或 HIS 的全部能力已经完成真实验收。

## 1. 就诊人卡片

| 旧端行为 | 新端处理 | 状态与边界 |
| --- | --- | --- |
| 默认展示患者姓名、`patId` 和“新增/更换就诊人” | 默认展示服务端脱敏患者目录第一项；已有目录进入独立选择页 | 已迁移；页面只保存平台 opaque `patientId` |
| 旧端通过 `patientInfoByUnionId` 返回 `thirdPatientId`、卡号、关系等原始字段 | Elysia 服务端解析 provider 映射后只返回 `id`、姓名、关系、脱敏卡号和来源 | 已迁移；provider 患者号、身份证、手机号不出小程序 |
| 首页“就诊人绑定”跳转旧 `patientChange` 页面 | 原生首页和其他业务页面统一跳转 `pages/patient-select/patient-select` | 已迁移；新增/绑定真实写入仍待医院建档契约 |
| 首页显示 `ID:patId` | 改为显示服务端生成的 `就诊卡：cardNumberMasked` | 已修复；内部 `patientId` 不进入可见 UI |

### 数据字段原则

- `patient.id` 是平台内部 opaque 引用，只能用于平台 API 的 owner-scoped 查询，不能作为用户可读 ID。
- `cardNumberMasked` 是服务端根据医院卡号生成的脱敏读模型；小程序不得自行拼接、反解或扩大展示范围。
- 页面切换就诊人只持久化 `selected_patient_id`，返回首页后重新匹配当前服务端目录；如果已有选择已经失效，
  必须保持未选中并提示用户进入选择页显式确认，不能自动回退到目录第一项。只有本地从未保存过选择时，
  才允许默认目录第一项。目录暂时为空时只清除页面展示上下文，不删除本地选择，避免恢复后被误判为首次进入。
- 首页的会话恢复、下拉刷新和患者同步共用“最后一次请求获胜”守卫；“我的”页的用户与患者目录并发读取也使用同一类守卫，旧响应不能覆盖当前患者上下文。
- 旧端的 `thirdPatientId`、`patId`、`medicalCardNo`、完整身份证号和手机号不作为小程序 contract 字段。

## 2. 就诊人二维码

旧端实现是把 `medicalCardNo` 拼接到第三方 `api.qrserver.com` URL，并在弹窗中显示完整卡号。这种实现不能迁移到新端：

1. 完整医疗卡号会进入第三方域名、URL 日志、缓存和图片请求链路；
2. 没有医院确认的扫码字段、有效期、签名、撤销和防重放规则，无法证明二维码能被院内系统正确识别；
3. 小程序不应该把 provider 标识或完整医疗标识交给前端，更不能用随机字符串伪造“可用”二维码。

当前原生首页保留二维码图标和点击入口，但明确提示“二维码暂未开放”，不发起外部二维码请求。

### 二维码正式开放前必须取得

- 医院/众阳确认的扫码协议：字段、编码、签名算法、版本和扫码方；
- 服务端生成接口：owner + 内部 `patientId` 校验、短 TTL、一次性或可撤销 token；
- 展示方式：服务端返回短期图片/短期二维码内容，前端不接触完整卡号；
- 失败与审计：过期、重复使用、跨用户访问、撤销和 provider 不可用时的错误码与日志；
- 真机在医院扫码设备上的识别证据。

在以上证据完成前，二维码状态保持未开放，不纳入支付或医保联调的快捷替代方案。

## 3. 首页入口迁移矩阵

| 旧入口 | 新端入口/页面 | 当前状态 |
| --- | --- | --- |
| 预约挂号 | `pages/hospital-list/hospital-list` → `pages/appointment-directory/appointment-directory` | 已恢复旧端医院卡片前置；科室/排班只读已接入，写号、锁号、费用和支付未开放 |
| 门诊缴费 | `pages/outpatient-payment/outpatient-payment` | 已接入费用只读；真实支付、医保授权、结算回写按用户要求最后处理 |
| 旧首页顶部“互联网医院”（旧代码实际跳转 `pagesB/hospital/hospitalList`） | `pages/hospital-list/hospital-list` → `pages/appointment-directory/appointment-directory` | 已恢复旧首页实际静态入口；这不等于外部互联网医院 web-view 已迁移，动态机构/院区仍未开放 |
| 门诊病历 | 首页原位置保留 | 未迁移；需要病历资源授权和脱敏 contract |
| 公众号轮播 | `pages/official-account/official-account` | 静态公众号通知说明已接入；二维码、关注状态和订阅消息授权未开放 |
| 报告查询 | `pages/report-directory/report-directory` | 已接入 30 天 LIS/PACS/ECG 摘要目录；详情只接受服务端 opaque 引用 |
| 智能导诊 | 首页原位置保留 | 未迁移；需要 AI 导诊服务、免责声明、审计和内容版本 |
| 陪诊/报告右侧快捷图 | 陪诊保留迁移提示；报告进入报告目录页 | 报告目录已补齐；陪诊未迁移 |
| 我的挂号 | `pages/appointment-records/appointment-records` | 已接入只读页面；预约历史仍依赖 provider 患者标识映射验收 |
| 就诊人绑定 | `pages/patient-select/patient-select` | 已接入目录、选择、刷新；真实新增/家属绑定未开放 |
| 意见反馈 | `pages/feedback/feedback` | 热点问题、客服电话和迁移提示已接入；真实反馈提交和客服工单未开放 |
| 住院、便民、健康服务 | 首页三组服务保留原位置；院内导航进入 `pages/hospital-navigation/hospital-navigation` | 静态医院卡片和静态院内地图已迁移；动态医院/院区、实时楼层/科室定位、健康内容和住院服务仍待逐域取得 contract |

## 4. 后续顺序

1. 先完成患者目录、切换患者、报告目录和预约只读的真机验收；
2. 取得二维码扫码协议后，再设计短期 token、审计和医院设备验收；
3. 逐项迁移门诊病历、医院列表动态能力、院内导航动态能力、健康百科/自测、住院服务和旧顶层 `pages/hospital/hospital.vue` 外部互联网医院，不共享旧 provider 万能代理；
4. 最后按现金支付 → 医保授权/结算 → HIS 回写处理费用链路。
