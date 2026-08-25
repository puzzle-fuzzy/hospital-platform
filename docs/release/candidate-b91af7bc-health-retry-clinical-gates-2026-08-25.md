# 候选 b91af7bc：健康百科重试与临床批次门禁（2026-08-25）

## 1. 候选来源

| 项目 | 结果 |
| --- | --- |
| Git commit | `b91af7bc597a8ba66fcfe303cc3af0f1cdde6948` |
| 小程序页面数 | 20 |
| 小程序测试 | `259 pass / 0 fail / 2525 expect()` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 来源 | `b91af7bc597a8ba66fcfe303cc3af0f1cdde6948` |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 旧 Python 服务 | 未修改、未停止，仍不属于本候选发布范围 |

## 2. 本候选变更

### 小程序

- 健康百科症状查疾病结果页增加固定高度错误态和“重新加载”；
- 疾病/药品详情页增加固定高度错误态和“重新加载”；
- 重试只复用页面已保存的症状 ID 或内容 opaque ID，不从错误文案、旧 Provider 参数或任意外部 query 重新拼接请求；
- 页面类型检查和原生小程序测试全部通过。

### 迁移文档

- 新增四个临床只读域的独立合同门禁：门诊记录、住院信息、我的医生、我的问诊/电子导诊；
- 明确四域不能共用 `patId`、万能 `/clinical`、预约历史或通用 WebView；
- 明确正式 Provider/HIS 材料、字段白名单、越权样例、日志和回滚证据是各域独立放行条件。

## 3. 发布验证

源码构建已经完成类型检查和 staging 生成，但替换 live `dist/` 时收到微信开发者工具文件锁 `EBUSY`。构建脚本已保留
完整候选在 pending 目录，并保持旧 live 目录完整；没有删除、清空或覆盖当前开发者工具正在使用的运行包。

因此以下结论成立：

- `b91af7bc` 是已验证的本地候选，不是当前真机运行包；
- 需要关闭占用 `apps/miniprogram/dist/` 的开发者工具窗口和真机调试会话后，执行
  `pnpm --filter @hospital/miniprogram runtime:publish-pending`；
- 发布后再执行 `pnpm --filter @hospital/miniprogram runtime:verify`，并从新运行包重新编译/扫码；
- 在发布前，不能把旧二维码、旧 `dist` 或当前服务端日志当作本候选的真机业务证据。

## 4. 业务边界

本候选没有打开健康内容正式发布、临床问卷、病历、住院、医生、问诊、二维码、患者绑定、预约写入、支付、医保、
结算、退款或 HIS 回写；没有修改旧 Python 项目、旧服务、线上 MySQL、Redis 或另一会话负责的众阳预约适配器。
