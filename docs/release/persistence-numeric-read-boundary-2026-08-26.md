# MySQL 数值读模型边界复核（2026-08-26）

## 结论

本轮只收紧新 Elysia 服务的 MySQL repository 读模型，没有修改旧 Python 项目、旧 Gunicorn、线上配置、
MySQL 数据、Redis 或任何 Provider 调用。修正的目标是防止运行时异常值经过 JavaScript 隐式数字转换后进入
患者、预约和支付内部状态机。

## 发现的问题

部分列在 TypeScript 中允许 `number|string`，但旧实现直接使用 `Number(value)`，或者直接把数据库返回的
`version`/`query_attempts` 交给领域对象。虽然正常的 mysql2 行通常只有 number 或十进制字符串，
但 repository 是运行时边界，不能把这个假设当成校验：

- `Number([])` 和 `Number(false)` 可能得到 0；年龄 0、排班 0 号源和某些计数在领域层是合法形状，坏行会因此
  被伪装成正常数据。
- 预支付 claim 对数据库字符串版本直接执行 `row.version + 1` 时，会出现 `"3" + 1 === "31"`，条件更新和
  返回快照的版本事实不一致。

## 本轮处理

`packages/persistence/src/mysql-repositories.ts` 新增严格的 `safeDatabaseInteger` 边界：

- number 必须是非 NaN、非 Infinity 的安全整数；字符串必须是十进制数字且转换后仍是安全整数；其它运行时
  类型全部拒绝。
- 金额、号源、普通资料、患者同步操作、支付订单和预支付尝试统一使用该边界，并为每个字段设置最小值。
- 预支付 claim 先把版本归一化为 number，再同时用于 `WHERE version = ?` 和返回版本递增。

这仍然不是支付开放，也不是医保验收；支付、医保、HIS 回写和真实 Provider 业务继续保持原有关闭闸门。

## 回归证据

- `pnpm --filter @hospital/persistence test`：109 pass / 0 fail / 649 expect
- `pnpm --filter @hospital/persistence typecheck`：通过
- 新增回归：普通资料拒绝数组年龄、预支付字符串版本正确递增、预约快照拒绝数组号源。
- 旧服务和线上服务：本轮未连接写入、未重启、未部署。

后续仍需按当前迁移路线继续完成低风险只读域的真实小程序、客户端 requestId、服务端 Pino trace 和 Provider
低敏 requestId 四方证据；本修正只证明本地持久化边界，不替代真机或生产业务验收。
