> 当前小程序配套运行包来源（2026-08-28）：本地 live 运行输入为 3f8274ec5435779c0603ce8475a4f4e86d292cbd（提交 3f8274e）。本行只锁定当前候选，历史段落保留用于追溯。

# 当前执行检查点（2026-08-28）

> 本文是 2026-08-28 的当前事实入口，优先于同一仓库中更早生成的候选交接记录。它严格区分本地源码、运行包、线上服务和真实业务证据，避免把“本地测试通过”误写成“线上或真机验收完成”。

## 当前版本边界

| 对象 | 当前事实 | 结论 |
| --- | --- | --- |
| 新 Elysia API 线上 release | `5738a71e0bcddaa8849106754baf5b296427bed7` | 已完成 preflight、隔离 smoke、原子切换和公网 runtime smoke |
| 旧 Python 服务 | 继续监听 `0.0.0.0:8001` | 本轮未修改、未停止 |
| 本地小程序源码候选 | `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`（`1bc5bf6`） | 当前工作树候选 |
| 小程序运行包 | live/pending 校验输入均为 `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916` | 38 个页面、4 个原生 Tab |
| 线上小程序运行包 | 历史来源 `13f597ea9ee3f65b9be858117826d948339d904a` | 新候选尚未上传微信线上版本 |
| 线上数据库、Redis、旧 Python | 仍使用现有线上配置 | 本轮未写入 |

## 本轮实际完成

1. 患者范围页面在同一会话、同一就诊人刷新期间保留稳定的患者卡片，避免 Provider 或持久化暂时失败时先闪成“未选择就诊人”；会话失效、账号切换和患者切换仍会清理旧患者，不能复用旧 `patientId`。
2. 运行时预检清单同步了临床/报告等尚未确认 Provider contract 的关闭态依赖，防止页面入口存在就被误认为业务已经开放。
3. 核心中文注释、错误语义、结构化日志和对应回归测试保持在新项目内；没有改动旧仓库。

## 已验证证据

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram test`：356 pass、0 fail、3826 个断言。
- `pnpm typecheck`：9 个 workspace 全部通过。
- `pnpm test`：9 个 workspace 全部通过。
- `pnpm docs:audit`：当前工作树文档无断链（数量以命令当次输出为准）。
- `pnpm --filter @hospital/miniprogram runtime:verify`：38 个页面和根运行文件通过。
- `pnpm --filter @hospital/miniprogram runtime:verify:pending`：pending 运行包通过。
- 小程序候选构建曾在目录未被占用时通过；随后再次执行全仓聚合构建时，微信开发者工具锁定了 `apps/miniprogram/dist`，构建器已停止覆盖并保留 pending 候选。这是本地工具文件锁，不是业务服务 503。候选发布后，当前 live `dist` 已通过 `runtime:verify`，线上新 API 已切换为本表顶部的 `5738a71e`。

## 当前迁移台账

旧端 64 个入口当前统计为：`replaced=8`、`partial=23`、`surface-only=23`、`blocked-payment=7`、`blocked-provider=1`、`blocked-external=1`、`excluded=1`。

| 批次 | 当前状态 | 下一步 |
| --- | --- | --- |
| A 只读已确认业务 | `awaiting-evidence`，代码可取证 | 从 `1bc5bf6` 运行包生成二维码，采集九个真机业务域的页面、客户端 `requestId`、服务端同链日志和 Provider 低敏请求号 |
| B 健康内容 | `awaiting-reviewed-bundle` | 等待审核后的正式内容 bundle，不导入 fixture 代替审核 |
| C 临床只读 | `awaiting-provider-confirmation` | 单独取得正式 Provider contract、字段、权限和失败语义 |
| D 患者/便民写入 | `awaiting-patient-contract` | 先确认患者归属、幂等、撤回和回滚规则 |
| E 外部入口 | `awaiting-external-contract` | 确认外部小程序/WebView 的 appId、域名、隐私和回退方案 |
| F 支付/医保/HIS 回写 | `last-batch` | 最后冻结金额、订单状态机、幂等、医保授权和补偿流程 |

## 开发者工具锁定处理

发现 `wechatdevtools.exe` 仍持有 `apps/miniprogram/dist` 时，不杀进程、不删除 live 目录、不强行覆盖。正确顺序是：

1. 在微信开发者工具中关闭当前小程序项目或结束对应编译会话。
2. 确认目录锁释放后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`。
3. 再执行 `pnpm --filter @hospital/miniprogram runtime:verify`，核对 `build-info.json` 的 `sourceRevision` 为 `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`。
4. 重新打开 `apps/miniprogram/dist/`，普通编译后再生成真机二维码。

在第 4 步之前，不能把微信开发者工具当前页面或旧二维码当作 `1bc5bf6` 真机证据。

## 下一步执行顺序

1. 使用 [`device-evidence-1bc5bf6-pending.json`](../release/device-evidence-1bc5bf6-pending.json) 从当前 live 候选重新开始 A 批次九域真机取证，先验证共享原生 Tab、微信登录全局资料、患者显式切换，再验证预约历史/爽约和门诊费用只读。
2. 对每个 A 批次域建立页面表现、客户端 `requestId`、服务端 trace/Pino 日志、Provider 低敏请求号四方关联；只要任一层缺失，保持 `pending`。
3. A 批次证据完成后，再按 B→C→D→E→F 进入下一批次；医保、微信支付和 HIS 写回继续最后处理。

本检查点不授权部署新 API，也不改变旧 Python 服务。线上发布仍须单独经过 preflight、隔离 smoke、原子切换和公网运行时验证。
