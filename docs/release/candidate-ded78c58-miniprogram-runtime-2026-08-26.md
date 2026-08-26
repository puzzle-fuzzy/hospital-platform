# 小程序运行包候选 `ded78c58`（2026-08-26）

## 当前结论

本候选包含预约历史客户端范围契约收紧：在线和全部挂号请求都显式发送
`scope=online|all`；在线请求必须携带日期窗口，全部请求不携带日期窗口。
页面仍然分别请求两个服务端只读范围，爽约记录仍只接受服务端明确的 `missed`。
本轮没有打开预约写入、取消、支付、医保、报告 Provider、临床或外部会话能力。

候选已完成 TypeScript 编译、页面边界校验、运行包依赖校验、来源指纹写入和
`runtime:verify:pending`。由于微信开发者工具仍持有 `dist/` 文件锁，原子发布
尚未执行；旧的 live 运行包被保留，候选位于
`.local/hospital-miniprogram/pending/`。

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `ded78c58c53923ecf5232a8035b3e790e5959216`（`ded78c58`） |
| 页面数量 | 40 |
| 小程序回归 | `329 pass / 0 fail / 3632 expect()` |
| pending 校验 | `runtime:verify:pending` 通过 |
| 当前 live | `02dbf10419740d96c4445493df019021ac22bcfa`，未覆盖 |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，未因本候选修改 |
| 旧 Python 服务 | `8001` 保持共存，未修改、未停止 |

## 候选包含的业务边界修正

- `dashboard-service` 对在线预约历史和爽约查询显式生成 `scope=online`；全部挂号保持独立的 `scope=all` 查询。
- `api-client` 使用联合类型固定两种 query 形状，并由单独的 query 构造器回归编码结果。
- 页面不把在线响应本地复制成全部历史；本地分页只影响渲染窗口，不改变服务端读模型。
- 文档和发布基线记录以完整 sourceRevision 绑定候选；尚未取得真机页面、客户端 requestId、服务端 traceId 和 Provider 请求号的完整证据。

## 当前仍未通过的门

线上服务端 release 之后仍存在未整体发布的服务端运行时代码，且包含另一会话维护的
预约适配器；`release:baseline:audit` 必须继续 fail-closed。支付、医保、预约写入、
取消、退款、HIS 回写、二维码 Provider 和临床/外部业务继续保持关闭。

九个真机证据域需要在该候选原子发布后重新生成二维码并逐项取证；代码回归和 pending
运行包校验不能替代真实微信、公网、服务端日志和 Provider 同链证据。
