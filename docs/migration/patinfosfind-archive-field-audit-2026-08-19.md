# `patInfosFind` 患者档案字段级审计（2026-08-19）

> 状态：只读档案解析已进入新服务 adapter；二维码、建档、绑卡、预约写入、费用和医保仍不因本接口而开放。
> 本文只记录旧端源码事实、新端映射边界和待冻结契约，不保存真实患者姓名、身份证、手机号、卡号或令牌。

## 1. 接口真实职责

旧端通过 `src/api/modules/ZY.ts` 调用：

```text
GET /msun-middle-aggregate-patient/v1/patInfosFind
  ?type=3&cardNo=<医疗卡号>&patName=<患者姓名>
```

旧端的 `httpZy.ts` 会把旧平台登录后的用户 JWT 放入 Provider 请求的 `Authorization` 请求头。这个事实只能说明
旧端当时依赖了一个上游鉴权链，不能证明该 JWT 是新服务的 Provider 服务凭证；新服务不复制旧用户 JWT，也不把新平台
Bearer Token 转发给众阳。

旧端同时在 GET 请求中传入了 `params` 和 `data`。新 adapter 只使用 URL query 参数，因为 GET body 不是稳定的跨运行时
业务契约，不能让档案查询依赖浏览器或小程序对 GET body 的兼容行为。

该接口的业务作用是：

1. 按卡号和姓名在 HIS/众阳患者档案中查询患者主档案；
2. 返回档案主键 `data.patId` 以及该患者关联的卡片和档案属性；
3. 为预约历史、报告和门诊费用等临床只读查询提供 HIS 患者引用。

它不是微信登录接口，不是患者绑定接口，也不是医院二维码协议接口。

## 2. 关键字段边界

| Provider 字段 | 已确认的用途 | 新服务处理 | 是否进入小程序公共响应 |
| --- | --- | --- | --- |
| `data.patId` | HIS 患者主档案 ID，供临床查询使用 | 保存为 owner-scoped `providerReferences["his-patient"]` | 否 |
| `data.patName` | 档案返回姓名 | 若返回则必须和本次查询姓名一致 | 不直接透传 |
| `data.cardNo` / `medicalCardNo` | 档案卡号或医疗卡号 | 若返回则必须和本次查询卡号匹配；输入必须保持字符串 | 只返回服务端脱敏读模型 |
| `data.idCardNo` / `idcardNo` | 身份证卡号或档案身份证字段 | 仅用于敏感字段格式门禁和身份关联 | 否 |
| `data.phone`、联系人字段 | 患者/联系人联系方式 | 不进入患者目录最小模型 | 否 |
| `data.patCardVOList` | 患者关联的卡片记录集合 | 校验卡片结构、卡号和卡片项 `patId` 归属 | 否 |
| `patCardVOList[*].patId` | 卡片所属患者主档案 ID | 存在时必须等于顶层 `data.patId` | 否 |
| `patCardVOList[*].patCardId` | 单张卡片记录 ID | 不当作患者 ID，不进入内部临床引用 | 否 |
| `patCardVOList[*].patCardNo` | 单张卡片号码 | 只用于本次查询卡号一致性校验 | 否 |
| `cardTypeName`、`chargeClassName` | Provider 卡片/收费类别描述 | 暂不自行解释枚举或推导支付资格 | 否 |
| `hospitalId`、`orgId` | Provider 医院/机构维度 | 等待正式机构归属契约，不自行放行 | 否 |
| `invalidFlag`、`deadLockFlag`、`cardStatus` | 可能表示档案/卡片状态 | 因缺少正式枚举和业务规则，不自行推导“可用” | 否 |

特别要区分三个 ID：

- `patId` 是患者主档案 ID；
- `patCardId` 是卡片记录 ID；
- `patCardNo`/`medicalCardNo` 是卡号文本。

三者不能互换，更不能因为它们同时出现在一个响应中，就推断某一个字段是二维码载荷。

## 3. `patId` 的下游用途证据

旧端患者选择完成后会把档案查询返回的 `patId` 写入患者状态。旧端后续将它作为患者参数用于：

- 预约历史和预约记录查询；
- LIS/PACS/ECG 报告查询；
- 门诊病历/就诊记录查询；
- 门诊费用或结算相关查询；
- 陪诊、随访等仍待独立契约的业务。

因此，新服务采用两层引用：

```text
患者目录 thirdPatientId
        │
        └─ 通过卡号 + 姓名查询 patInfosFind
             │
             └─ data.patId → owner-scoped his-patient 映射
```

小程序只提交或保存平台内部的 opaque `patientId`；服务端按当前用户解析 `his-patient`，禁止回退到目录
`thirdPatientId`，也禁止让小程序提交 Provider `patId`。

## 4. 首页二维码的实际事实

旧首页 `src/pages/index/index.vue` 存在两个不同展示字段：

1. 顶部患者卡片的 `ID` 文本使用 `patientInfo.patId`；
2. 二维码计算属性读取 `patientInfo.medicalCardNo`，并把它拼到第三方二维码图片服务 URL。

所以源码只能证明“旧页面曾将医疗卡号交给第三方图片服务生成图片”，不能证明医院扫码使用 `patId`，也不能证明
该二维码符合医院设备的业务协议。旧端没有提供扫码字段定义、签名、有效期、防重放、撤销或扫码回执。

新端因此保持二维码关闭态：不把 `patId`、`thirdPatientId` 或完整卡号发送给第三方二维码服务，也不使用患者缓存 ID
伪造“可扫码”状态。二维码只有在医院提供正式扫码协议和测试设备后，才可以按“服务端短期引用 → 小程序展示 → 医院扫码
回执 → 真机验收”单独实现。

## 5. 新 adapter 的安全门禁

`packages/adapters/src/zhongyang-patients.ts` 当前执行以下规则：

1. Provider 包络必须明确 `success=true`，`data` 必须是对象；不能只看 `code=0000` 或存在 `patId`；
2. `data.patId` 必须是安全文本，不能接受已发生精度损失的 JSON 大整数；
3. 目录查询姓名和卡号先经过格式校验；卡号必须是字符串，避免前导零丢失；
4. 返回姓名存在时必须和查询姓名一致；
5. 返回顶层卡号或卡片数组时，必须包含本次查询卡号；
6. 卡片项存在 `patId` 时，必须和顶层 `patId` 一致；
7. 发现不一致时整批同步 fail-closed，不写入新的 `his-patient` 映射。

适配器只输出最小患者目录和内部临床引用；身份证、手机号、完整卡号、卡片数组和 Provider 原始响应不会进入公共
contract。Provider request id 可以用于排障，但原始请求 URL、请求体、Authorization 和原始响应不得进入日志。

## 6. 继续开放前的证据

在开放二维码、建档、绑卡或临床写入前，仍需取得并登记：

- `type=3` 的正式参数文档和鉴权方式；
- 单卡、多卡、无档案、同名、卡号不一致、卡片归属不一致的脱敏响应；
- `invalidFlag`、`deadLockFlag`、`cardStatus`、`hospitalId`、`orgId` 的正式枚举及处理规则；
- Provider 失败码、限流、超时和重试语义；
- 医院二维码的载荷、签名、TTL、扫码受众、一次性消费和回执协议。

在这些证据到达前，当前实现保持只读档案解析和 `his-patient` 内部映射，不扩展为患者绑定、二维码或支付能力。
