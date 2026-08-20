# 下一阶段业务门禁执行板（2026-08-20）

> 本文是新会话继续工作的短入口，不替代各业务域的详细 contract、代码测试或真实验收记录。
> 当前服务端候选为 `0e360d3`，当前本地小程序候选为 `8f80b3e`，完整运行包来源为
> `8f80b3e30385fe3655f871673d8616cd2d31faaa`。小程序尚未上传线上。
>
> 本轮只维护新项目文档和执行顺序；不修改旧 Python 服务、不中断旧 `8001`、不写线上 MySQL/Redis，
> 也不触碰并行会话正在维护的众阳自动化代码。

## 1. 当前门禁状态

| 业务域 | 当前代码状态 | 当前能证明的事实 | 下一道真实证据 | 未满足时的处理 |
| --- | --- | --- | --- | --- |
| 微信登录与会话 | 已实现 | code 形状校验、session TTL、owner 解析和安全日志通过本地门禁 | 真机登录、`/me`、会话失效恢复的 HTTP 与日志同链 | 停止后续患者业务，不把扫码成功当作登录成功 |
| 患者目录与显式切换 | 已实现 | owner-scoped 目录、临床映射、失效选择和异步代际保护已覆盖 | 当前候选下真实同步、多患者切换、切换后页面/请求归属 | 旧患者残留、映射不一致或过期快照立即停止当前域 |
| 普通资料 | 读写已实现 | 字段白名单、版本更新、`null` 清空和 409 语义已覆盖 | 首次读取/更新、双设备冲突、真机页面与低敏日志 | 409 不自动覆盖，重新读取后再操作 |
| 预约历史/爽约 | 只读已实现 | 在线渠道 3、状态白名单、90 日窗口和 `missed` 派生规则已覆盖 | 当前 release 的 Provider、HTTPS、真机三层证据 | 不把未知状态推断为爽约；不开放全部渠道 |
| 门诊费用目录 | 只读已实现 | 待缴/已缴、元转分、30 日中国标准时间窗口和资源上限已覆盖 | 非空金额样例、当前 release 的 Provider、真机三层证据 | 不调起支付，不把空列表当作费用链路完成 |
| 报告目录/详情 | 代码骨架存在，Provider gate 关闭 | 多 Provider trace 有界聚合、owner/患者/TTL 校验已覆盖 | 医院确认的目录、详情、附件和授权 contract | 保持 `dependency-not-configured` 或安全错误，不展示伪造数据 |
| 门诊病历 | 未注册 | 旧端仅确认过调用路径，未确认字段与空/失败语义 | EMR/HIS contract、脱敏样例、页面验收 | 不把报告目录冒充病历，不新增兼容转发 |
| 新增/绑定就诊人 | 入口关闭 | 风险和 PB-01 至 PB-16 缺口已登记 | 查档、建档、绑卡、幂等、撤销和授权 contract | 保持迁移提示，不接受身份证替卡号或查档失败后继续建档 |
| 健康知识 | API 未挂载 | schema、导入器、发布/撤回边界已实现，但没有审核内容 bundle | 脱敏导出、责任确认、staging 发布演练和患者页面验收 | 不导入旧正文，不用 fixture 冒充生产内容 |
| 支付/医保/HIS | 最后专项 | 规则和文档基础存在，真实状态机未开放 | 微信支付、医保授权/结算、6201/6202/6301 等全链路合同 | 不因只读费用成功而打开支付或回写 |

## 2. 执行顺序

```text
真机微信会话
  -> 患者目录同步
  -> 用户显式选择就诊人
  -> 我的挂号 / 爽约记录
  -> 门诊费用只读
  -> 普通资料读写
  -> 报告 Provider 合同确认后单独验收
  -> 病历、绑卡和内容域按各自 contract 排期
  -> 支付、医保、退款和 HIS 回写最后专项
```

每个已开放只读域都必须在同一候选版本下同时取得：

1. 页面结果：截图或可复核的真机页面状态；
2. 客户端 HTTP：脱敏路径、状态码和 `traceId/requestId`；
3. 服务端日志：同链 `requested`、明确业务成功、HTTP `2xx` 和低敏 Provider 诊断。

只有三层证据属于同一会话、同一患者、同一时间窗口时，才能把该域从“代码已实现/待验收”改为“真实已验收”。
`ready 200`、模拟器页面、单个 HTTP `200`、历史 release 日志或空列表都不能替代这三层证据。

## 3. 统一停止条件

- session、owner 或患者目录无法确认；
- 切换患者后仍出现上一位患者的卡片、列表、请求参数或日志关联；
- Provider 返回字段、状态、时间、金额或引用超出已冻结 contract；
- 业务成功事件缺失，或同一关联链出现 HTTP 失败；
- 日志出现 code、token、AppSecret、Provider Authorization、姓名、完整卡号、身份证号、手机号、HIS `patId` 或原始报文；
- 未开放入口出现支付、医保授权、退款、预约写入、HIS 写入或伪造成功；
- 需要修改旧 Python 时无法先证明 `8001` 进程、监听和回滚边界不会受到影响。

## 4. 关联文档

- 真机操作与三层证据：[`miniprogram-real-device-acceptance-checklist-2026-08-19.md`](miniprogram-real-device-acceptance-checklist-2026-08-19.md)
- 只读业务不变量：[`readonly-business-chain-audit-2026-08-20.md`](readonly-business-chain-audit-2026-08-20.md)
- 当前候选来源：[`candidate-8f80b3e-local-build-2026-08-20.md`](candidate-8f80b3e-local-build-2026-08-20.md)
- 报告 Provider 门禁：[`report-readonly-contract-audit-2026-08-18.md`](report-readonly-contract-audit-2026-08-18.md)
- 病历准入草案：[`../migration/medical-record-directory-contract-draft.md`](../migration/medical-record-directory-contract-draft.md)
- 患者绑定准入草案：[`../migration/patient-binding-contract-draft.md`](../migration/patient-binding-contract-draft.md)
- 医保/支付最后专项：[`../migration/payment-contract.md`](../migration/payment-contract.md)
