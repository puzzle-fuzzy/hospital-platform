# 会话、就诊人上下文与预约记录只读审计（2026-08-17）

本文记录当前代码候选对“登录状态恢复 → 就诊人选择 → 我的挂号/爽约记录”链路的只读审计。
它只证明代码、单元测试和文档契约的一致性，不把本地测试或页面骨架当作线上 Provider、Redis 或真机业务验收。

## 1. 审计范围

- 小程序会话恢复、微信一次性 code 单飞和 401 重试；
- 患者目录的默认选择、显式切换、失效选择和同步完成门禁；
- “我的挂号”和“爽约记录”的患者上下文、日期窗口、状态筛选和大列表渲染；
- API 认证边界、结构化日志和敏感字段禁止进入日志的规则。

本次没有修改线上服务、旧 Python 服务、数据库、Redis、Provider、支付或医保配置，也没有使用真实账号执行写入。

## 2. 已确认的代码不变量

### 2.1 会话恢复

1. 小程序只通过 `wx.login` 获取一次性 code，并提交到平台 `/auth/wechat`；openid、session_key 和 provider 凭证不进入小程序。
2. 登录请求在进程内单飞，首页、患者同步和业务页并发时不会各自消费一次性 code。
3. 受保护请求遇到 `401 unauthorized` 时最多重新登录并重试一次；并发请求已经取得新 token 时，旧请求复用新 token，不能清除新会话。
4. Redis 会话读取失败保持为 `503 dependency-not-configured`，不能误降级成登录失效；这样页面不会把基础设施故障错误展示为永久退出。
5. 服务端 `/me` 只返回平台内部用户引用。微信身份、患者号和 provider 原始字段不返回客户端。

对应实现：

- `apps/miniprogram/src/services/api-client.ts`
- `apps/miniprogram/src/services/session-service.ts`
- `apps/api/src/modules/auth/service.ts`
- `apps/api/src/plugins/request-authentication.ts`

### 2.2 就诊人上下文

1. 小程序本地只保存 opaque `patientId`，不保存完整卡号、身份证或 provider 患者号。
2. 只有“没有历史选择”的首次目录读取才允许默认第一位患者。
3. 已保存患者从当前 owner 目录消失时进入 `stale`，必须由用户进入选择页显式重选，不能静默切换到第一位患者。
4. 患者同步或临床映射确认进行中，选择页撤销“当前”标记并禁止返回调用页；只有完整同步成功后才允许选择。
5. 首页、我的、预约记录、爽约、报告和门诊费用页使用页面实例级请求守卫；页面栈中的旧响应不能覆盖新患者上下文。
6. 进程级患者同步协调器只负责减少重复请求，服务端 owner、幂等键和租约仍是最终一致性边界。

对应实现：

- `apps/miniprogram/src/services/patient-selection-service.ts`
- `apps/miniprogram/src/services/patient-sync-coordinator.ts`
- `apps/miniprogram/src/services/page-instance-state.ts`
- `apps/miniprogram/src/pages/patient-select/patient-select.ts`

### 2.3 我的挂号与爽约记录

1. 预约历史查询覆盖中国标准时间前后各 90 天，不能因为只读过去窗口而漏掉未来预约。
2. 爽约页只接受服务端已经归一化的 `missed` 状态；未知状态不能由小程序猜成爽约。
3. “在线挂号/全部挂号”只过滤当前已获取的安全读模型，不重新透传 provider 渠道参数，也不因为切换标签再次请求 provider。
4. 页面首屏每次只渲染 10 条，后续“加载更多”只展开当前响应，不伪造 provider 分页或改变事实总数。
5. 日期、上午/下午/晚上和状态文案均在展示边界转换；列表索引只用于 WXML diff，不是预约号、详情引用或写入凭证。

对应实现：

- `apps/miniprogram/src/services/dashboard-service.ts`
- `apps/miniprogram/src/services/appointment-record-view.ts`
- `apps/miniprogram/src/pages/appointment-records/appointment-records.ts`
- `apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts`

### 2.4 日志边界

服务端请求日志保留 `requestId`、`traceId`、方法、路径、状态码、耗时和低敏错误分类；provider 失败只保留
provider 名、操作名、请求号、状态码和可重试性。日志不写入 Authorization、微信 code、openid、unionid、
session_key、患者身份证、手机号、provider 原始报文、支付签名或密钥。

对应实现：

- `apps/api/src/plugins/request-logging.ts`
- `apps/api/src/modules/auth/service.ts`
- `packages/observability/src/index.ts`

## 3. 本轮门禁结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/miniprogram test` | 76 pass，0 fail，712 个断言 |
| `pnpm --filter @hospital/api test` | 97 pass，0 fail，476 个断言 |
| `pnpm docs:audit` | 106 份 Markdown 文档，无断链 |

测试证明代码边界、错误码映射、owner 隔离、页面异步守卫和日志脱敏规则保持一致；它们不等于真实微信、Redis、
Provider 或真机验收。

## 4. 未验证项与停止条件

以下项目仍不能标记为完成：

- 线上 Redis `hospital:session:*` 的实际 TTL 聚合、过期后 401 和真机失效恢复；
- 第二位真实就诊人、多患者切换、患者 inactive/recovery 和跨患者业务查询隔离；
- 真实“我的挂号” Provider 状态映射、未来预约、爽约结果与页面三层证据；
- 真实门诊费用待缴/已缴、金额、空列表和患者切换；
- 普通资料首次写入、真实 409 冲突和真机资料页；
- 报告 Provider 只读 gate、二维码医院扫码协议以及预约写入、支付、医保、退款和 HIS 回写。

在获得专用测试账号、第二位可验证患者，或运维提供只允许对 `hospital:session:*` 做 `SCAN/TTL` 聚合的短时
最小权限身份前，不执行真实资料写入、不修改 Redis ACL、不公开 TTL 接口，也不把单患者或 HTTP 200 观察推导为
多患者和业务完成。任何 Provider 字段、状态、金额或 owner 事实缺失时，立即停止该业务域并回到 contract intake。

## 5. 下一步

优先取得以下任一安全前置：

1. provider/运维提供的专用 staging 微信账号、第二位测试患者和可回收测试资料，用于资料 PUT、409、患者切换及预约/费用只读验收；或
2. 运维提供短时、最小权限、只输出数量与 TTL 最小值/最大值的 Redis 审计方式，完成会话 TTL 证据后立即撤销。

前置满足后按“会话 TTL → 多患者切换 → 普通资料 PUT/409 → 我的挂号 → 门诊费用”的顺序逐域留证；支付、医保和 HIS
继续最后处理。
