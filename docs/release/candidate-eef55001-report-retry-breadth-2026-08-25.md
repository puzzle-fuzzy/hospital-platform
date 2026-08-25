# 候选 eef55001：报告详情可恢复读取与广度迁移检查点（2026-08-25）

> 本记录只说明新项目本地候选和迁移边界，不代表已经发布微信运行包、线上 API 或完成真实业务验收。

| 项目 | 当前事实 |
| --- | --- |
| Git commit | `eef550012e071d2891f990035a9b40041f314e5d` |
| 小程序页面数 | 20 |
| 小程序测试 | `259 pass / 0 fail / 2525 expect()` |
| pending 运行包 | `.local/hospital-miniprogram/pending/` |
| pending 来源 | `eef550012e071d2891f990035a9b40041f314e5d` |
| live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被微信开发者工具占用 |
| 旧 Python 服务 | 未修改、未重启 |

## 本候选变更

- 报告详情错误态增加“重新加载”，不再要求用户退出页面才能恢复；
- 每次重试重新读取当前用户、患者目录和会话代际，并重新校验当前选择的就诊人；
- 重试继续使用服务端生成的 opaque `reportId`，不读取 Provider 原始报告号、卡号或患者敏感字段；
- 页面状态在重试前清空错误，旧临床读模型不会被错误态或跨患者响应复用；
- 64 个旧页面的业务状态分布不变，临床、患者绑定、外部入口、支付和医保没有被假页面“打开”。

## 验证结果

```text
pnpm --filter @hospital/miniprogram typecheck 通过
pnpm --filter @hospital/miniprogram test     259 pass / 0 fail / 2525 expect()
pnpm format:check                             通过
pnpm lint                                     通过
git diff --check                              通过
```

运行包构建已经完成 staging 和类型检查，但原子替换 `apps/miniprogram/dist/` 时因微信开发者工具持有文件锁返回 `EBUSY`；完整候选已保存在 pending，旧 live 运行包未被清空或半替换。

## 下一批并行队列

1. 释放开发者工具锁后发布 pending，并取得当前候选的微信页面、HTTP、Pino 和 Provider 低敏 requestId 同链证据；
2. 对预约、爽约、门诊费用、报告目录/详情和普通资料并行完成只读证据闭环；
3. 对门诊病历、住院、医生关系、问诊/电子导诊单按材料先到先冻结独立 contract；
4. 同步整理患者绑定、二维码、预问诊、随访、风险评估、锦旗/表扬信的协议和审核门禁；
5. 支付、医保、结算、退款和 HIS 回写仍放最后，不与只读页面共用成功语义。

任何批次缺少正式 contract、owner 映射、字段白名单、错误分类或真实证据时，继续保持 `blocked-*` 和稳定状态页，不用本地 fixture、空列表或旧接口转发宣称完成。
