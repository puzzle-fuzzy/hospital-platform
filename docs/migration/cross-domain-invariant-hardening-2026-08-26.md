# 跨业务共用领域不变量加固（2026-08-26）

> 本轮不是打开新的患者业务，而是把 B/C/D/E 四条迁移线共用的时间、状态和运行时输入边界收紧。
> 旧 Python 服务、旧数据库、旧 Redis、线上进程和另一会话维护的众阳预约适配器均未修改。

## 本轮处理的问题

### B：健康内容发布时间

健康内容的审核时间参与发布审计和版本排序，不能只用 `Date.parse()` 判断。只带日期或不带
时区的字符串会被 Bun、staging 和生产按不同本地时区解释，导致同一 bundle 的审计顺序不稳定。

现在 `validateHealthKnowledgePublication()` 与 staging 导入器都要求带 `Z` 或显式偏移的
RFC3339 时间；不符合格式的内容在领域层拒绝，不会进入 repository 或患者端响应。

### C：临床只读结果

四条临床线继续共享结果摘要，但不共享病历、住院、医生或导诊条目字段。摘要不变量保持：

| 状态 | 数量 | 错误码 |
| --- | ---: | --- |
| `ready` | 大于 0 | 无 |
| `empty` | 0 | 无 |
| `rejected` / `unavailable` | 0 | 必须有固定错误码 |

因此“尚未查询”“超时”“权限拒绝”不能伪装成合法空列表，也不能覆盖上一份已经确认的临床快照。

### D：患者与便民写入命令

患者写入状态机的转换函数同时被未来 worker、仓储恢复和 API 组合根使用，不能只相信
TypeScript 联合类型。归一化/推进遇到未知状态时返回 `state-invalid` 领域校验错误；
可判定函数返回 `false`，后继状态查询返回空集合，不会抛出无法分类的 `TypeError`。

这仍然不代表新增就诊人、协议同意、签名、问卷、锦旗或表扬信已经开放；具体业务必须继续
使用自己的字段白名单、患者归属、同意、撤回和 Provider contract。

### E：外部入口短期会话

外部会话消费时间固定为：

```text
issuedAt <= now < expiresAt
```

- 签发前消费返回 `not-yet-valid`；
- 到期消费返回 `expired`；
- `consumedAt` 必须位于签发时间与过期时间之间；
- `revokedAt` 不能早于签发时间；
- `Invalid Date` 在消费和撤回入口统一转换为 `timestamp-invalid`，不让 `NaN` 参与有效期判断。

消费仍返回新对象，真实持久化时必须使用条件更新保证一次性消费；本轮没有注册外部 API、生成
URL、打开 WebView 或写入 Redis/MySQL。

## 代码与验证

涉及代码：

- `packages/domain/src/knowledge.ts`
- `packages/domain/src/external-entry-session.ts`
- `packages/domain/src/patient-write-command.ts`
- 对应三个领域测试文件

已执行：

```powershell
pnpm --filter @hospital/domain test -- external-entry-session.test.ts patient-write-command.test.ts knowledge.test.ts
pnpm --filter @hospital/domain typecheck
pnpm format:check
git diff --check
```

本轮定向测试结果为 `22 pass / 0 fail / 67 expect()`；这些结果只证明领域不变量和运行时校验，
不替代 Provider、临床审核、真机或生产证据。
