# 当前小程序全量闭环复核（2026-08-26）

## 结论

本次复核确认新项目的小程序入口、原生 Tab 路由、运行包边界和核心客户端测试保持一致；这证明当前候选具备继续进行真实验收的工程基础，但不等价于 Provider、真机或支付业务已经完成。

本记录只描述 `E:\__Super_Core__\hospital-platform` 的新项目，不修改、依赖或代表旧 Python 项目 `G:\fuck\hospital` 的状态。

## 已验证事实

| 检查项 | 结果 |
| --- | --- |
| 当前小程序候选 | live 为 `62cdb8f`（来源 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`）；当前无 pending 目录 |
| 原生页面与运行包 | 40 个页面；live 与 pending 根文件和来源指纹一致 |
| 主导航 | 4 个微信原生 `tabBar`，页面之间不重复渲染自定义 Tab |
| 导航审计 | 通过；40 个页面、30 个字面导航调用 |
| 患者展示审计 | 通过；扫描 80 个页面源文件 |
| 入口广度审计 | 通过；首页/我的 action、状态页和交互页面闭环 |
| 迁移边界审计 | 通过；34 个冻结入口门禁、64 个旧页面都有唯一落点 |
| TypeScript | 9 个 workspace 包全部通过 `tsc --noEmit` |
| Biome lint | 435 个文件通过，无自动修复 |
| 小程序核心测试 | 全量回归 `340 pass / 0 fail / 3726 expect()`；本候选新增预约请求运行时边界回归，既有共享患者会话边界、二维码会话门禁、健康规则版本和关闭态布局测试均通过 |

## 当前仍未通过的门

### 1. 发布基线未统一

线上新服务当前对应服务端 release `1bc8b0a8`，本轮门诊费用运行时配置边界已随新 API 整体发布；其他会话负责的
`packages/adapters/src/zhongyang-appointments.ts` 未被本轮修改。`release:baseline:audit` 已重新通过，不能因此扩大 Provider 或写入业务范围。

### 2. 真机证据仍为空

当前 `docs/release/device-evidence-62cdb8f8-pending.json` 的九个业务域仍为 `pending`。本地测试只能证明客户端状态机和响应校验，不足以证明微信真机、公网 HTTPS、Nginx、Elysia 日志和 Provider 请求号已经形成同一条证据链。

### 3. 健康百科仍不能发布

旧库导出的健康知识快照虽然结构审计通过，但仍有 133 个质量告警，且 `publicationState=not-approved`。因此健康百科页面继续保持服务端和页面双重关闭态；不能把旧表内容直接导入或展示为已审核医疗内容。

### 4. 高风险业务继续关闭

预约写入、取消、支付、医保授权、退款、HIS 回写、患者新增绑定、二维码 Provider 映射、报告 Provider 详情和外部 WebView 仍按迁移台账进入明确状态页或关闭态。

## 线上只读复核

本轮通过 inspection SSH 做了只读核对：

| 项目 | 结果 |
| --- | --- |
| 新 Elysia release | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新服务 | `hospital-platform-api-v2.service=active`，Bun 监听 `10.0.0.3:18081` |
| 旧服务 | Gunicorn 继续监听 `0.0.0.0:8001` |
| 报告业务事件 | 最近 24 小时未观察到 `report.directory.*`、`report.detail.*` 或 `report.detail_reference.*` |

这次核对没有重启服务、读取环境变量/令牌、写入 MySQL/Redis 或修改旧 Python 项目。报告事件为零只能说明当前窗口没有产生报告业务请求，不能解释为“患者没有报告”；结合报告配置仍关闭的事实，本轮不打开报告 Provider gate。

## 下一步准入顺序

1. 等预约适配器会话合入后，重新生成一个完整、可回滚的服务端候选，不拆半发布。
2. 在同一候选上重新通过 `release:baseline:audit`、构建、类型、lint 和运行包来源校验。
3. 以同一服务端候选和小程序候选重新发布配套运行包，再采集 A 批次九域真机证据。
4. 只有 A 批次证据链完整后，才进入健康内容审核 bundle、临床只读 contract 和外部入口 contract。
5. 支付、医保、结算、退款和 HIS 回写仍最后单独验收。

## 复核边界

- 本次没有 SSH 写入、服务重启、Nginx 修改、旧 Python 服务修改、旧数据库/Redis 修改或线上运行包替换。
- 当前工作树只保留用户已有的 `docs/obsidian/.obsidian/` 未跟踪目录，不纳入本次提交。
- 任何将上述“代码和静态门禁通过”描述成“业务已完成”的说法都属于证据越界。
