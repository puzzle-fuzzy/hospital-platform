# 小程序患者目录 canonical 响应边界（2026-08-19）

## 结论

本轮只收紧原生小程序接收患者目录 JSON 的运行时边界，不修改患者 Provider、Elysia API、MySQL、Redis、旧 Python
服务或线上 release，也不打开新增/绑定家属能力。

患者目录读取和患者目录同步现在都必须经过同一个 `requirePatientListData`：

- `total` 必须等于完整 `items` 数量；
- 每条记录必须是唯一、有限且无控制字符的内部 opaque `patientId`；
- `displayName` 必须是有界展示文本；
- `relationship` 只能是 `self/spouse/child/parent/other`；
- `cardNumberMasked` 必须符合服务端脱敏形状，允许固定哨兵 `未绑定`，不允许完整卡号；
- `source` 只能是 `hospital-his/legacy-record`，`clinicalAccess` 只能是 `ready/unavailable`。

任何一条记录不符合约束都会整批返回 `provider-response-invalid`，不会降级成空目录、默认切换到第一位患者，或把部分坏数据继续交给选择页、预约、报告和门诊费用页面。
校验后重新投影白名单字段，未来网关意外附加的 Provider 患者号等字段不会进入页面模型。

## 分层边界

小程序校验只负责防止协议错配或损坏 JSON 进入渲染层，不能替代服务端的 owner 隔离、HIS 映射、脱敏和权限判断。
只有服务端返回并经本轮临床映射确认的 `clinicalAccess=ready` 患者，才可能被患者选择状态机选中；目录存在不等于可查询。

患者选择仍遵守既有规则：首次没有本地选择时才允许默认第一位 ready 患者；已有选择失效、映射不可用或目录同步失败时，必须进入 stale/unavailable 等明确状态，不能静默换人。

## 证据与未开放项

- `dashboard-service.test.ts` 覆盖未知关系、未知来源、未知临床访问状态、完整卡号、首尾空白姓名、重复 ID 和非法 ID；
- 原生小程序定向测试 146 项、1167 个断言通过，TypeScript 类型检查通过；
- 本轮没有执行真实 Provider 请求、真机多患者切换或患者新增绑定，因此不能把本地校验通过宣称为真实患者业务验收；
- 预约写入、报告详情、门诊费用详情、微信支付、医保、退款和 HIS 回写继续保持关闭。
