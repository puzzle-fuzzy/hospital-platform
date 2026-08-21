# 普通资料服务版本后置条件审计（2026-08-22）

## 结论

本轮发现并修复了普通资料 service 的一个业务一致性缺口：MySQL 仓储已经在事务内
要求成功回读版本为 `expectedVersion + 1`，但 service 层此前只验证返回对象的普通
读模型字段，没有验证返回版本一定属于本次更新。现在 service 也执行同一后置条件，
版本漂移按现有 `user-profile-conflict` / HTTP 409 语义 fail-closed，不再记录
`user.profile.updated` 或返回 200 成功。

本轮没有修改旧 Python 服务、线上 Nginx、MySQL/Redis 数据或生产 release，也没有
执行真实资料写入。

## 1. 原问题

资料更新链路的正确顺序必须是：

```text
当前会话 owner + expectedVersion
  -> service 输入校验
  -> 仓储条件更新
  -> 返回 canonical 资料快照
  -> 校验返回 version == expectedVersion + 1
  -> 记录 updated 并返回 200
```

修复前最后一个箭头缺少 service 级门禁。虽然当前 MySQL 实现已经在事务中使用
`FOR UPDATE` 和严格版本判断，但仓储接口是可替换的；未来回放任务、测试替身或新
持久化实现如果返回后续并发版本，service 会把另一请求的快照误认为本次写入结果。

## 2. 修复内容

- `apps/api/src/modules/profile/service.ts`
  - 新增 `normalizeUpdatedProfile`；先复用普通资料读模型白名单校验，再确认版本严格
    等于 `expectedVersion + 1`。
  - 版本不匹配抛出既有 `UserProfileVersionConflictError`，进入低敏
    `user.profile.conflict` 日志和 409 响应；不会进入 `user.profile.updated`。
  - 中文注释说明 MySQL 事务保障与 service 运行时后置校验的分层原因。
- `apps/api/src/modules/profile/service.test.ts`
  - 新增仓储错误返回后续版本的回归场景，确认冲突语义和日志事件正确。
- `docs/migration/user-profile-contract.md`
  - 将 `expectedVersion + 1` 后置条件写入普通资料不变量。

## 3. 本地验证

| 检查项 | 结果 |
| --- | --- |
| 普通资料 service 测试 | `16 pass / 0 fail / 64 expects` |
| API 全量测试 | `204 pass / 0 fail / 846 expects` |
| 全仓工具测试 | `40 pass / 0 fail / 103 expects` |
| 全仓类型检查 | 9/9 通过 |
| 全仓测试 | 9/9 通过；小程序 `197 pass`、持久化 `93 pass` |
| 架构/迁移/Provider/文档/发布基线 | 全部通过 |
| 全仓构建 | 9/9 通过；小程序 14 个页面运行脚本完整 |

这些结果只证明新仓库当前候选的代码和模拟持久化边界；真实 MySQL 双会话并发、微信
真机资料首次写入、旧版本 409 和服务端日志链仍需在当前 release 上单独取得证据。

## 4. 下一步

真机候选重新编译并扫码后，先完成微信登录和患者显式切换，再使用同一账号验证：

1. “我的 → 个人资料”首次 GET 返回安全默认值或已保存快照；
2. 一次合法 PUT 返回新的 canonical 资料和递增版本；
3. 使用旧版本再次 PUT 返回 409，页面退出可编辑态并要求下拉刷新；
4. 服务端日志同一 trace 同时包含 requested、updated 或 conflict，以及最终 HTTP 状态，
   且不出现 userId、昵称、邮箱或原始请求体。

支付、医保授权、退款、HIS 回写、患者新增绑卡、二维码真实协议和报告附件继续保持
后置关闭状态。
