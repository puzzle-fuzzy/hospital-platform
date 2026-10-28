# `miniprogram-pay` 退役说明

## 当前状态

自 2026-09-17 起，`apps/miniprogram-pay` 不再是项目的现行业务入口，也不再用于医保、混合支付或自费支付的开发、验收和发布。2026-10-28 已将该目录从仓库删除；历史代码和流程只保留在本说明、`docs/miniprogram-pay-*` 旧文档与 git 历史中。

现行支付流程以 `apps/miniprogram`、`apps/api`、`apps/worker` 及其当前 API/Provider/HIS 合同为准。新增需求、缺陷修复、环境调整、运行包构建、3090 发布和真机验收均不得再以 `miniprogram-pay` 为目标。

## 维护边界

- 该目录已删除：不恢复、不重建，也不把它的医保或支付链路复制进任何后续项目。
- 不为该历史项目配置新的医保、微信支付或 Provider 环境变量。
- 不把该项目的构建产物、运行包或测试结果当作当前版本发布证据。
- `docs/miniprogram-pay-*`、旧流程图和旧分支索引仅保留追溯用途，不是现行流程的官方参考。
- 查询支付问题时，优先检查主小程序、API、Worker、当前服务端日志和实际 Provider/HIS 证据；除非明确进行历史考证，不再排查该项目。

## 删除记录（2026-10-28）

删除前按原"后续删除条件"完成了一次独立清理，未与支付业务修复或发布混做：

- 确认 CI/发布脚本、工具链和文档链接不再引用 `apps/miniprogram-pay`；README 的模块表、目录树和历史流程段落已改为"已删除"表述，指向该目录内部文件的链接已移除。
- `pnpm-lock.yaml` 已随 workspace 成员移除刷新。
- 历史 commit、发布记录、`docs/miniprogram-pay-*` 流程文档和旧分支索引继续保留。
- 同日删除 `apps/miniprogram-settlement-demo` 演示端；它未被任何文档、脚本或工具链引用。
