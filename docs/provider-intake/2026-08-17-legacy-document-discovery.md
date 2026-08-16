# 旧项目接口材料补登记：目录发现与高风险边界

> 接收/复核日期：2026-08-17（Asia/Shanghai）
> 当前状态：`normalized`（已登记和标准化，未确认、未实现、未开放）
> 文档版本/发布日期：按原文件更新时间和文件名标注；其中医保规范文件版本为 `v1.3.35`、发布日期为 `2025-05-28`
> 适用环境：旧项目文档目录；不代表 sandbox、staging、production 或当前医院环境已经授权
> 业务范围：门诊待支付/结算、基础目录、用户资料、医保规范、微信医保支付，以及一个不属于 Provider contract 的内部组件说明

## 1. 发现来源与安全边界

本批材料是在旧项目 `G:\\fuck\\hospital\\hospital-app\\docs` 的只读盘点中发现的。它们此前没有进入新仓库的
Provider intake 台账，因此不能继续把发现前已登记的 19 个 `documentId` 视为旧项目文档的完整目录。

本记录只保存文件名、大小、更新时间、SHA-256 和脱敏后的业务分类，不复制 HTML、JSON、PDF 原文、接口样例、
患者标识、订单号、token、证书、签名原文或外部下载地址。原始文件仍由旧项目工作区管理；新仓库不因登记动作
获得 Provider 权限，也不因此改变任何线上 route 或 systemd 服务。

## 2. 文件证据指纹

| documentId | 原始文件 | 大小 | 原始更新时间 | SHA-256 | 分类 | 状态 |
| --- | --- | ---: | --- | --- | --- | --- |
| `zhongyang-outpatient-settlement-2.27.2.27-html-20260715` | `2.27.2.27.获取门诊结算信息.html` | 241989 bytes | 2026-07-15 16:46:16 | `270686FAA0DD87FAFDD6F6991B4E96C1E3BA84E89D21BA4BB5C0CCB5ECE16255` | 门诊结算/医保明细，高风险 | `normalized` |
| `zhongyang-outpatient-settlement-2.27.2.27-md-20260715` | `2.27.2.27.获取门诊结算信息.md` | 18511 bytes | 2026-07-15 16:46:16 | `130A7B2392CBB1C417C6E6C240082EF63F50B6B422A0B010A0D0D391EC975458` | 门诊结算/医保明细，高风险 | `normalized` |
| `zhongyang-department-info-2.1.9-20260715` | `2.1.9. 科室基本信息接口.html` | 101503 bytes | 2026-07-15 16:46:16 | `2FC2AD1BE5558FD610B07DE011B1E51786A5A0215939B74E2733505DE8385DAA` | 科室基础目录，潜在只读依赖 | `normalized` |
| `zhongyang-user-info-2.1.13-20260716` | `2.1.13. 用户信息接口.html` | 161714 bytes | 2026-07-16 10:50:42 | `FEDE973D596D9AE48C01A6CDC893387882BB313F9E11C314D7FCE0C8592E1642` | Provider 用户资料，潜在只读依赖 | `normalized` |
| `zhongyang-outpatient-unpaid-list-2.6.33-20260811` | `2.6.33. 获取门诊待支付列表信息(父子项目展开).md` | 6595 bytes | 2026-08-11 17:08:14 | `68FA1EF4A0DB8560A7BF00C288FDC511296C1B770E1540B3FE549318FDC1F474` | 门诊待支付列表，只读 | `normalized` |
| `shanxi-medical-insurance-spec-v1.3.35-20250528` | `山西省医疗保障信息平台定点接口规范_v1.3.35_20250528.pdf` | 2940864 bytes | 2026-07-15 16:46:16 | `B76EE624893DD6CB871AE81C85912F9DBE174922BA8C4E73E010FC8B058045D5` | 医保规范，高风险基础材料 | `normalized` |
| `wechat-medical-insurance-order-2025-12-04` | `xxx.md` | 39873 bytes | 2026-07-23 18:14:20 | `A1EDD2680CD22FEB423F4107D52137BBB6ED9A51456608C2DDD9813C88193EBB` | 微信医保支付订单，高风险 | `normalized` |

## 3. 已标准化事实与当前解释

### 3.1 门诊待支付列表：可用于核对当前只读 adapter

`2.6.33` 描述的接口为：

```text
GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records
```

材料提到 `patId`、起止时间、待支付/已支付状态和调用来源码等请求语义。当前新端
`packages/adapters/src/zhongyang-outpatient-payments.ts` 已按这条路径实现只读请求，并将待支付/已支付状态
映射到 Provider 的查询参数；现有单元测试也覆盖了路径、状态、来源码、金额从元到分的换算、稳定记录标识和
异常关闭。

这只能证明“文档与当前 adapter 的形状可以进行差异核对”，不能证明当前生产环境具备权限、字段版本完全一致、
Provider 返回可用数据，或患者端门诊缴费已经完成。下一步必须补充脱敏请求/响应 fixture、业务失败和超时样例，
再进行受控内网只读联调。

当前差异必须单独记录：旧端 `payment.ts` 和旧门诊缴费页面还使用过 `waitPayAmount`、`registerDept`、
`registerDoctor`，但本批 2.6.33 输出字段表没有冻结这些字段。新 adapter 暂时只在 adapter 内部读取这些候选字段，
并且只输出 `amountFen`、`departmentName`、`doctorName` 等公共白名单；这些候选字段不能进入 domain、日志、数据库或
支付编排。Provider fixture 未确认前，不能把 `waitPayAmount` 视为已确认的最终支付金额，也不能把旧端字段名当成新 contract。

### 3.2 科室与用户资料：可能是动态目录依赖，不直接开放

材料分别指向 Provider 的科室基础信息和用户信息接口。它们可能影响医院/科室/用户映射，但当前迁移目标仍然是
owner-scoped 患者上下文和已冻结的只读业务，不允许因为发现基础目录接口就直接把 Provider 用户资料、科室全量数据
暴露给小程序。

在实现前必须确认调用方、权限、分页/排序、缓存时效、机构边界、字段脱敏和与现有医院/科室主键的映射；否则只保留
为待确认 contract，不注册公共 route。

### 3.3 门诊结算与医保规范：高风险，继续保持最后阶段

`2.27.2.27` 的内容涉及门诊待结算信息、结算主单和明细等结算/医保数据；山西医保规范是更高层的基础材料。
它们不能被降级成普通费用详情接口，也不能用来推导金额、医保结果、结算状态或 HIS 回写顺序。

在 Provider/院方没有确认鉴权、金额单位、状态终态、幂等、回调/查单、失败补偿和 HIS 写回责任之前，以下能力继续
关闭：结算创建、支付下单、医保授权/结算、支付查单、关单、退款、结算完成和 HIS 回写。

### 3.4 `xxx.md`：微信医保支付材料，禁止按文件名忽略

文件名不具备业务语义，但内容识别为微信医保支付订单相关材料，包含支付订单创建方向、域名/请求头和敏感字段
保护边界等高风险信息。它必须按照微信支付与医保的独立 contract 处理，不能与普通微信登录或门诊待支付列表
共用万能参数，也不能把原始密钥、证书、加密值或完整样例复制到新仓库、日志和小程序。

这份材料只完成接收登记，当前不代表微信支付/医保授权已经配置或可调用；支付和医保 gate 仍关闭。

### 3.5 `PatientHospitalSelector.md`：内部 UI 说明，不进入 Provider 台账

同目录的 `PatientHospitalSelector.md` 是患者/医院选择组件的内部前端说明，没有 Provider endpoint、鉴权或业务状态
契约，因此没有作为第 8 个 Provider 文档登记。它属于旧端 UI/组件盘点范围，仍由
[`legacy-client-infrastructure-boundaries.md`](../migration/legacy-client-infrastructure-boundaries.md) 和页面迁移清单
负责，不应被误报为 Provider 文档缺失。

## 4. 当前冻结边界

- 当前只允许继续验证门诊待支付列表的只读 adapter 与脱敏 fixture；不允许从文档直接打开费用详情或支付 route。
- 不把 Provider 返回的 HTTP 200、支付调起成功、6201/6202 结果或医保接口响应直接映射为患者端最终成功。
- 不从 Provider 文档样例中提取患者号、身份证号、卡号、订单号、token、证书、签名原文或完整回调进入日志和 contract。
- 不修改旧 Python 服务、旧端口、旧数据库表语义；新端仍通过 `/api/v2` 和独立 `api-v2` systemd 边界演进。
- 在取得 Provider/院方确认及受控请求证据前，本文所有材料保持 `normalized`，不注册公共 route、不部署支付/医保能力。

## 5. 必须补齐的确认项

| 编号 | 缺口 | 实现前证据 |
| --- | --- | --- |
| DISC-01 | 旧目录材料是否为当前 Provider 版本、适用医院和生产环境 | Provider/院方确认人、版本、环境和有效期 |
| DISC-02 | 2.6.33 请求字段、状态枚举、分页和金额字段是否与当前环境一致 | 脱敏请求/响应 fixture、业务失败和超时样例 |
| DISC-03 | 科室/用户资料的权限、机构范围、分页和 owner 映射 | 目录 contract、脱敏字段表和只读受控响应 |
| DISC-04 | 2.27.2.27 与医保规范的金额、状态、结算和 HIS 顺序 | 结算状态机、金额守恒、查单/回写失败补偿确认 |
| DISC-05 | 微信医保订单的签名、证书、加密、回调验签和幂等边界 | 独立支付/医保 contract、受控环境成功/失败/重复样例 |

## 6. 下一步执行顺序

1. 先用 `2.6.33` 对照当前 outpatient read-only adapter 和测试，记录字段/状态差异，不增加公共接口。
2. 将科室/用户资料作为目录依赖进行 contract diff；只有 Provider 确认 owner、机构范围和字段脱敏后，才决定是否实现内部 adapter。
3. 将 `2.27.2.27`、医保规范和 `xxx.md` 合并到支付/医保最后阶段的材料清单，继续等待真实环境、鉴权和状态证据。
4. 收到新的 Provider 文档或脱敏 fixture 后，为每个 endpoint 单独建立 contract 卡片、错误码、状态机、日志和验收项；未解决差异时保持 `normalized`。
5. 完成 contract diff 后再决定下一批可迁移业务，禁止以“文档已登记”替代 Provider、生产、公网和真机验收。

本记录只证明旧项目目录发现材料已经进入新仓库的证据台账，不证明任何接口已授权、已联调、已部署或已完成真机验收。
