# 临床 Contract 材料包规范

> 本文适用于门诊记录、住院 episode、医生关系、问诊/电子导诊四条线。它只定义“收到正式材料后如何登记和校验”，不代表任何域已经确认或开放。

## 目的

旧端源码只能说明历史调用线索，不能直接作为新端 Provider contract。材料到达后，需要同时固定请求、成功/空、拒绝、超时、
owner 映射、字段白名单、脱敏规则和验收门；否则很容易先写一个兼容转发，后面再无法判断患者归属和错误语义。

材料包校验命令：

```powershell
pnpm clinical:packet:audit -- C:\secure\clinical\outpatient-records.packet.json
```

命令只输出域 ID、样例种类、字段数量、错误种类和验收门状态，不输出材料正文。材料包不应提交到公开仓库；`payloadLocation`
只能指向受控的外部材料库，不能是 `data:`、`inline:` 或 HTTP URL。

## 最小结构

| 部分 | 必须内容 | 约束 |
| --- | --- | --- |
| `domainId` | 四个临床域之一 | 不允许自定义通用 `clinical` 域 |
| `contractStatus` | `pending` | 工具不能把材料自行升级成 `confirmed` |
| `source` | documentId、SHA-256、版本、环境 | 只记录来源指纹，不保存原始报文 |
| `samples` | request、success-non-empty、success-empty、rejected、timeout | 每种恰好一份，正文放受控外部存储 |
| `ownerMapping` | 客户端输入和 Provider 身份边界 | 客户端只能提交 `platform-patient-id`，Provider 身份只能 server-only |
| `fieldAllowlist` | 字段名、公开策略、类型、空值语义、来源引用 | 没有白名单不能进入公共 response |
| `redactionRule` | response、logs、storage | 必须明确禁止患者身份、Provider ID、正文和原始报文泄露 |
| `errorMapping` | Provider 拒绝、超时等稳定错误 | 必须声明是否可重试和证据引用 |
| `acceptanceGates` | 越权、未知状态、日志链等 | 初始只能是 `pending`，证据到达后单独更新 |

## 不允许的材料

- 不在 JSON 中放原始请求体、原始响应体、Authorization、token、姓名、身份证号、手机号、卡号、`patId`、`patInHosId` 或医生内部 ID；
- 不把旧接口路径复制成新端公共路由；
- 不把 `contractStatus` 改成 `confirmed` 来替代 Provider 责任人确认；
- 不把成功空列表、HTTP 200 或测试 fixture 当成真实业务成功；
- 不因为一个临床域材料齐全就打开其他三个域、患者绑定、支付或医保。

## 放行关系

```text
材料包结构通过
  -> Provider/HIS 责任人确认
  -> contracts schema 与 adapter 脱敏测试
  -> owner 越权、错误/空态和日志测试
  -> API / 原生页面 / 真机三层证据
  -> 单域独立开放
```

当前四域仍保持 `normalized / unregistered`；统一状态见
[`clinical-read-models-2026-08-25.md`](../provider-intake/clinical-read-models-2026-08-25.md)，机器门禁见
[`../../tools/clinical-contract-packet-audit.mjs`](../../tools/clinical-contract-packet-audit.mjs)。
