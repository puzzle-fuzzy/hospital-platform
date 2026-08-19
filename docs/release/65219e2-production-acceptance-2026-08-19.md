# `65219e2` 生产切换与患者档案引用边界

> 记录时间：2026-08-19
> 状态：新 Elysia API 已切换；旧 Python 服务保持共存。Provider 业务和微信真机验收仍未完成。

## 1. 本次切换范围

- 旧服务 `0.0.0.0:8001` 未修改、未停止，继续由原 systemd/进程提供旧 API。
- 只发布并重启 `hospital-platform-api-v2.service`，没有重启 Worker，没有执行数据库迁移，
  没有清理 Redis，也没有修改旧 Python 项目。
- 生产 `current` 从 `b7c9451` 原子切换到 `65219e2`；候选目录先在独立端口完成验证，
  再切换软链接并重启新 API。
- 新 API 仍监听 `10.0.0.3:18081`，公网入口为 `https://test-hp.meiyi.pro/api/v2`。

## 2. 发布前证据

本地 `pnpm check` 和 `pnpm build` 通过：架构 66 条规则、文档 217 份无断链、9 个包类型检查、
API 163 项、小程序 160 项、Worker 51 项、持久化 76 项测试通过，9 个构建产物成功。
患者 adapter 定向测试为 86 项通过、0 项失败；覆盖 19 位字符串 `patId`、不安全数字精度拒绝、
完整档案包络白名单和敏感字段不进入公共模型。

上传到生产的构建产物按 SHA-256 校验一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `AA3F0AA43C8D182D3837EEA66D482B7532DD61E35AE3D7620758638E60B42077` |
| `apps/worker/dist/index.js` | `28ED16524FC2AD021D4406528B794A434B928156B102545A973C5C89F0FBFF65` |
| `apps/worker/dist/preflight.js` | `63D6F7658620FCCE3BFEA146990C42D6A0B7EDB742798AF351AEFDD6EAE57859` |
| `apps/worker/dist/provider-directory-smoke.js` | `8486A5668B6155A7523FE2DCBE4D285C028AC5D013108D80898B03172B7A01FE` |
| `apps/worker/dist/api-runtime-smoke.js` | `EE24F42C4B667B1D8E08BAB341C1D34D409E0BAF7A1896C446D0261D8E76ABFF` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008A3EA05133767C077246ECD5C5DE000CA5FEA0307A1920B36276DA` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `D9105036E23B1807A7A0503C589EA9BBDBA5938D9DFA9218DDD15021FA7F3771` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `08E0406E23BE04C7F266B67D5A4327827FC347433A90E6B7E137AC0A1AD60127` |

生产 preflight 使用真实 `shared/api.env` 通过，结果包含：

- `environment=production`；
- MySQL、Redis、schema probe 通过，预期 migration marker 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置完整；
- 微信支付、报告目录和报告详情保持显式关闭。

## 3. 候选与切换后的运行证据

候选先以 `127.0.0.1:18082` 启动，连续 readiness 采样通过；runtime smoke 结果为：

- health live：HTTP 200；
- health ready：HTTP 200，连续 3 次采样通过，database/redis/schema 均正常；
- system ping：HTTP 200；
- 未登录患者接口：HTTP 401，符合认证边界。

候选随后正常 SIGTERM 退出，没有留下 `18082` 残留进程。原子切换并重启新 API 后再次确认：

- `hospital-platform-api-v2.service=active/running`；
- `current -> releases/65219e2`；
- `10.0.0.3:18081` 仍由新 API 监听，`0.0.0.0:8001` 仍由旧 Python 服务监听；
- 内部 readiness 的 database/redis/schema 均为 `ok`；
- 公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 均 HTTP 200；
- 公网未登录 `GET /api/v2/patients` 返回预期 HTTP 401；
- `current.next` 没有残留。

新 API 启动日志明确打印 `environment=production` 和 `runtimeMode=production`，并记录依赖探针、
身份状态及业务 gate；日志只保留低敏 request/trace 关联字段，没有打印微信密钥、会话密钥、完整卡号、
身份证号、手机号或 Provider 原始档案。

## 4. `patInfosFind` 与二维码的边界

旧端患者链路已确认：

```text
patientInfoByUnionId.thirdPatientId / medicalCardNo / patientName
    -> patInfosFind(type=3, cardNo, patName)
    -> data.patId
    -> 预约、报告、门诊费用等临床 Provider 请求
```

`data.patId` 是 HIS 临床档案引用，应按字符串保存；19 位字符串不能转成 JavaScript `number`，否则会发生
精度损失。新端只在服务端 owner-scoped 的 `his-patient` 映射中保存和使用它，不返回给小程序。

该字段不是旧首页二维码的载荷。旧端顶部文字 `ID` 使用过 `patId`，但二维码图片和弹窗编号读取的是
`medicalCardNo`；旧端还把完整医疗卡号拼到第三方二维码图片 URL。新端因此没有把 `patId` 猜作二维码，
二维码继续关闭，等待医院确认扫码字段、签名、短 TTL、防重放、撤销和扫码回执协议。

## 5. 尚未完成的验收

本次切换不代表以下能力已经真实完成：

- 使用真实微信账号完成新的真机登录、患者刷新和多就诊人切换；
- 使用当前线上 `65219e2` 取得新的 Provider `patInfosFind` 业务响应并完成三层证据关联；
- 预约记录、爽约记录、门诊费用的真实 Provider/公网/真机闭环；
- 报告目录与详情、门诊病历、二维码、挂号写入；
- 微信支付、医保授权/结算、HIS 回写和退款。

下一步仍应按“新小程序候选来源 → 真机扫码 → 登录 → 患者同步/显式切换 → 预约记录 → 门诊费用 →
报告”的只读顺序取证；支付、医保和 HIS 写回最后处理。

回滚只允许针对新 API：按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 将
`current` 指回 `b7c9451` 并只重启 `hospital-platform-api-v2.service`，不得停止旧 Python `8001`。
