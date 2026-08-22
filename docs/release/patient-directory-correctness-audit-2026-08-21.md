# 患者目录同步与显式选择正确性审计（2026-08-21）
> 当前服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `a64fe023bc34fe6e44f93846c39e202fe02d64a5`。本审计仍要求真实多患者/真机证据。

> 当前验收基线：服务端 `84370077024762d92050cf077c27f3c60302e8f8`；小程序运行包来源
> `a64fe023bc34fe6e44f93846c39e202fe02d64a5`（提交 `a64fe023`）。本文只记录代码级不变量，
> 不替代当前候选的真机、HTTP 和服务端日志三层证据。

> 本文只记录新项目当前代码和本地测试证据。它不代表新的 Provider、线上当前 release 或微信真机已经完成业务验收。
> 本轮不修改旧 Python 项目、旧数据库、旧 Redis，也不修改另一个会话正在维护的众阳自动化 adapter。

## 1. 审计范围

本轮沿着“微信会话 → owner 解析 → 众阳患者目录 → `patInfosFind` 临床档案映射 →
owner-scoped 快照 → 小程序显式选择 → 预约/报告/门诊费用只读入口”的链路复核以下不变量：

1. 小程序不能提交 `unionId`、Provider 患者号、卡号或任意 `userId`；owner 只能来自当前服务端会话。
2. 众阳目录 `thirdPatientId` 和档案接口 `data.patId` 必须分开保存，后者只能进入服务端用途专用的 `his-patient` 映射。
3. 同一个 owner/provider 的重复同步必须 replay 或返回处理中冲突，不能重复访问 Provider；跨页面不同幂等键也必须互斥。
4. 完整快照只能由已验证的 Provider 结果替换；歧义空数组不能把已有医院患者批量标记为失效。
5. 旧请求晚返回时不能覆盖新快照、重新激活已失效患者或恢复过期的临床映射。
6. 患者选择页只能保存平台内部 opaque `patientId`；已有选择失效时必须要求用户显式重新选择，不能静默切换到第一位。
7. 同步期间、会话代际变化或临床映射未确认时，页面不得把患者当作可查询上下文。
8. 日志只保留 trace、Provider request id、状态分类和数量等低敏字段，不记录 unionId、姓名、卡号、身份证、手机号、`patId` 或原始 Provider 报文。

## 2. 当前实现证据

| 链路位置 | 核心实现 | 复核结论 |
| --- | --- | --- |
| HTTP 鉴权 | `apps/api/src/plugins/request-authentication.ts`、`apps/api/src/modules/patients/index.ts` | 先认证再校验同步幂等头；owner 不从 query/body/header 读取 |
| 同步 service | `apps/api/src/modules/patients/service.ts` | 重新校验身份读模型、Provider 结果、平台生成 ID 和快照返回值；成功快照后的读失败不会伪造同步失败 |
| Provider 映射 | `packages/adapters/src/zhongyang-patients.ts` | 目录号与 HIS `patId` 分离；档案姓名/卡片归属不一致时整批 fail-closed；本轮不修改该文件 |
| 领域读模型 | `packages/domain/src/patients.ts` | `clinicalAccess=ready/unavailable` 显式表达临床映射是否可用；公共患者模型不含 Provider 号 |
| 内存仓储 | `packages/persistence/src/repositories.ts` | 按 owner/provider/Provider 患者号稳定复用内部 ID；完整快照处理失效和临床引用清理 |
| MySQL 仓储 | `packages/persistence/src/mysql-repositories.ts` | `0015/0016` operation ledger、owner 行锁、快照事务和用途专用引用查询均有运行时校验 |
| 小程序选择页 | `apps/miniprogram/src/pages/patient-select/patient-select.ts` | 同步完成且存在 ready 患者后才能点击；会话变化清理目录；失效选择不自动换人 |
| 小程序选择状态 | `apps/miniprogram/src/services/patient-selection-service.ts` | `empty/stale/unavailable/selected` 语义分离，首次进入才允许默认第一位 ready 患者 |

## 3. 本轮发现与处理结论

本轮没有发现可以在不猜测 Provider contract 的前提下安全修复的患者目录业务缺口，因此没有新增兼容转发、
没有把目录号回退成临床 `patId`，也没有放宽空响应、未知关系或临床映射失败的语义。

特别确认以下容易被误改的点：

- `patientId` 每次同步由 service 生成，但生产仓储按 owner/provider/Provider 目录患者号匹配已有记录，
  因此刷新不会无条件生成一套新的内部患者身份；回放和快照测试已覆盖稳定 ID。
- `directory_active` 的失效只由完整、通过校验的快照驱动；Provider 空响应在已有医院目录时被拒绝，
  不会把暂时故障解释成用户解绑。
- `his-patient` 是用途专用引用。目录同步缺少该引用时，预约、报告、费用服务只能得到 `unavailable`，
  不能回退到 `thirdPatientId` 或客户端缓存。
- 患者页面保留诊断用的旧列表不等于保留“当前患者”标记；同步失败、会话失效和代际变化分别有不同清理语义。

## 4. 本地验证结果

以下命令均在 `E:\__Super_Core__\hospital-platform` 执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/api test src/modules/patients/service.test.ts src/app.test.ts` | 62 pass，322 个断言 |
| `pnpm --filter @hospital/persistence test src/index.test.ts src/mysql-repositories.test.ts` | 46 pass，163 个断言 |
| `pnpm --filter @hospital/miniprogram test`（包含患者初始化、选择、同步、导航和全量验收） | 180 pass，1438 个断言 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个页面运行脚本生成，测试脚本不进入 `dist/` |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；运行包来源为 `a64fe023`，无 `*.test.js`/`*.spec.js` |
| `pnpm docs:audit` | 通过；384 个 Markdown 文档无断链 |

这些结果证明本地代码边界和测试夹具一致，但不能替代 Provider 返回样例、线上 trace、微信真机页面或多患者切换。

## 5. 仍然缺少的业务证据

患者目录 gate 仍不能标记为“真实完成”，缺口是：

1. 当前小程序候选 `a64fe023` 的真实微信扫码、登录、患者同步和页面结果三层同链证据。
2. 至少两位可用就诊人的显式切换证据：选择前后页面患者姓名/脱敏卡片、请求的内部患者上下文和服务端日志必须一致。
3. Provider 返回空目录、患者 inactive 后恢复、HIS 映射暂时失败等受控样例；不能用模拟器空列表替代。
4. Redis 会话 TTL、过期后重新登录和患者目录重新确认的真实运行证据。
5. 当前线上服务端与本地候选的版本来源对应关系；历史 release 的日志不能回填当前候选验收。

## 6. 下一步与停止条件

下一步仍按以下顺序执行：

1. 关闭旧的微信开发者工具增量会话，重新打开 `apps/miniprogram/`，确认 `miniprogramRoot=dist/`，
   普通编译并重新生成二维码。
2. 先只验收登录和患者目录；记录页面、HTTP `traceId/requestId`、`patient.directory.*` 低敏日志三层证据。
3. 有第二位患者时必须从“更换就诊人/选择就诊人”页面显式点击，禁止用首页默认第一位推断切换成功。
4. 患者链路证据稳定后再验收预约历史和门诊费用只读；普通资料首次写入与 409 冲突另行取证。
5. 任何患者响应出现 owner 不一致、临床 `patId` 复用错误、空数组无法判定、日志无法关联或页面患者与请求不一致，
   立即停止该域并回到 contract，不添加兼容分支。

病历、患者绑定/新增、二维码、预约写入、支付、医保、退款和 HIS 回写继续保持关闭。
