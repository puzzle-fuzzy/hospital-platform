# patInfosFind 档案身份一致性收紧（2026-08-19）

> 状态：规则已随新 API release `968af78` 部署并通过运行层验收；旧 Python 服务、生产数据库、Redis 和公网路由未修改。

## 1. 为什么需要二次校验

`patInfosFind` 使用 `type=3`、`cardNo`、`patName` 查询档案，并返回临床使用的
`data.patId`。`patId` 不能直接由患者目录的 `thirdPatientId` 推导，也不能只因为
响应带有 `success=true` 就认为它一定对应当前目录患者。

如果 Provider 在异常数据、同名患者或卡片关系不一致时仍返回了一个合法的 `patId`，
服务端直接写入 `his-patient` 映射，后续预约、报告或门诊费用就可能读取到错误患者的
临床数据。这是身份绑定错误，不能依赖页面显示或下游接口再次纠正。

## 2. 当前实现边界

档案接口的正式字段契约还没有冻结，因此当前采用兼容但 fail-closed 的规则：

1. 始终要求包络 `success=true`、`data` 为对象，并且 `data.patId` 是安全文本；
2. 如果响应包含 `patName`，必须与本次查询姓名一致；
3. 如果响应包含顶层卡号，或包含 `patCardVOList` 卡片列表，返回的卡片集合必须包含
   本次查询卡号；明确返回空数组，或卡片项全部缺少可比卡号，也视为无法关联并拒绝；
4. 如果 `patCardVOList[*].patId` 存在，必须与档案顶层 `patId` 一致；
5. Provider 省略姓名/卡片字段时暂时保持最小兼容，不凭空扩大正式契约；
6. 字段格式错误、姓名不一致、卡号不一致、卡片归属不一致或卡片列表结构异常，整次患者同步失败，
   不写入新的临床映射；错误响应只保留稳定错误类型和 Provider request id，不携带查询姓名、
   卡号或原始档案。

这条规则只校验“本次查询对象和返回档案是否一致”，不会根据 `invalidFlag`、
`deadLockFlag`、`cardStatus`、`hospitalId` 或 `orgId` 自行推导档案是否有效。上述状态
必须等待 Provider 的正式枚举和脱敏样例后另行冻结。

## 2.1 旧端源码复核结论

本次对照旧项目 `G:\fuck\hospital\hospital-app` 的源码，得到以下可复核事实：

1. `src/api/modules/ZY.ts:19` 通过 `type=3`、卡号和姓名调用
   `patInfosFind`；旧端同时传了 query 和 GET body，但新 adapter 只依赖 query，避免依赖
   浏览器对 GET body 的非标准兼容行为。
2. `src/types/ZY.ts:54,81-82` 只声明了 `patCardVOList`、`cardStatus` 和
   `cardStatusName` 的数据形状，没有给出状态枚举或患者可用性规则。
3. 旧端患者选择/首页流程没有以 `invalidFlag`、`deadLockFlag` 或 `cardStatus` 作为
   患者可选门禁；旧端出现的 `invalidFlag` 筛选位于医保科室资料，不是患者档案状态，不能
   反向推导患者档案规则。
4. `src/pages/index/index.vue:22` 将档案/患者对象中的 `patId` 作为普通页面 ID 展示，
   但 `src/pages/index/index.vue:204-206` 生成二维码时读取的是 `medicalCardNo`，并将其
   送到外部二维码图片服务。这个事实只证明旧二维码使用医疗卡号，不证明医院扫码协议就是
   医疗卡号，也不证明 `patId` 可以用于二维码。

因此，新端保留两条独立边界：`patInfosFind.data.patId` 只作为服务端的
`his-patient` 临床引用；`invalidFlag`、锁定状态、卡片状态和机构归属在没有正式 Provider
枚举前不参与“可用患者”判断，也不进入小程序公共响应。若后续拿到正式契约，应新增独立的
`archiveEligibility` 校验和脱敏测试，未知状态必须 fail-closed，不能直接改写当前
`his-patient` 映射规则。二维码仍需单独冻结字段、签名、TTL、防重放和扫码回执。

## 3. 代码与测试证据

- adapter 在 [zhongyang-patients.ts](../../packages/adapters/src/zhongyang-patients.ts) 中完成可选身份字段校验；
- 测试覆盖姓名/卡号不一致时拒绝绑定、卡片列表不包含查询卡号时拒绝绑定、19 位字符串 `patId`、
  超出安全整数范围的数字 `patId` 和敏感字段不进入公共结果；
- 定向测试结果：15 项通过，38 个断言；Biome 检查通过；
- 这只证明本地 adapter 行为，不证明当前生产 Provider 已返回同样字段，也不等同于真实微信、
  真机或预约/报告/费用业务验收。

## 4. 继续开放前的证据

在把该规则提升为正式 Provider 契约前，还需要收到脱敏样例并登记版本、环境、来源指纹和
Provider request id，至少覆盖：

- 正常单卡档案；
- 多卡档案，包含医疗卡和身份证卡；
- 姓名一致但卡号不一致；
- 作废、锁定或卡片非正常档案；
- 医院/机构不匹配；
- 无档案、同卡多档案和临时失败。

二维码仍然不能从 `patId` 或 `patCardVOList` 推导。医院扫码字段、签名、TTL、防重放和
扫码回执没有冻结前，二维码继续保持关闭态。
