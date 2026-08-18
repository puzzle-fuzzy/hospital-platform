# 预约历史状态观察（9acdaf2）

更新时间：2026-08-18 14:55-14:57 CST

本文记录 `9acdaf2` 当前 release 的预约历史只读观察，用来解释小程序“在线挂号”空态和服务端返回数量的差异。
它不是微信真机验收、Provider 写入验收，也不代表预约、支付、医保或 HIS 已开放。

## 1. 来源与共存边界

| 项目 | 已核对结果 |
| --- | --- |
| 本地提交 | `9acdaf2`，中文提交 `补充预约记录状态分布日志` |
| 服务端当前 release | `/home/ps/code/hospital-platform/releases/9acdaf2` |
| 新 API | `10.0.0.3:18081`，生产模式，`database/redis/schema=ok` |
| 旧 Python API | `0.0.0.0:8001` 继续监听，本轮未停止、重启或修改 |
| 小程序运行包 | `sourceRevision=9acdaf2`，14 个注册页面及脚本已核对 |

候选 release 的 8 个运行产物 SHA-256 与本地构建产物一致；真实生产 env preflight、隔离 runtime smoke 和原子切换均通过。
隔离进程在验收后已回收，线上只保留新 API 的正常 systemd 进程。

## 2. 页面、HTTP 与日志三层证据

- 配对微信开发者工具进入 `pages/appointment-records/appointment-records`，当前“在线挂号”标签被选中。
- 预约记录请求返回 HTTP `200`；当前 release 日志中对应 `appointment.records.synced` 的低敏字段为
  `itemCount=60`、`statusCounts={cancelled:60}`，没有把患者或 Provider 标识写入本文。
- 在线挂号的业务筛选会排除规范化后的 `cancelled` 状态，因此 60 条已取消记录被过滤后显示“暂无挂号记录”是正确结果，
  不是接口 404、登录失效或页面丢数据。
- “全部挂号”没有把渠道 3 的结果直接复用。它需要独立的 `requestChannel=4` Provider contract；在字段、状态、排序、分页和
  真实样本均未冻结前，页面继续 fail-closed 显示迁移提示，避免把部分数据冒充完整历史。
- 当前 release 的预约历史 P0 业务门禁通过：请求 1、成功 1、失败 0；日志解析错误 0、systemd warning 0。

## 3. 下一步与停止条件

1. 先取得并核对 `requestChannel=4` 的 Provider 文档和真实只读响应，明确状态映射、排序、分页及空结果语义。
2. 在不写入测试预约、不影响旧服务的前提下，取得自然产生的非取消预约样本，再做页面、HTTP、日志三层交叉验收。
3. 多就诊人切换、失效恢复、Redis TTL、报告目录、预约写入、支付、医保和 HIS 回写仍是独立任务；没有对应 contract 和真实证据时保持关闭。

本记录只证明“当前在线标签对全量已取消数据的筛选行为正确”。真机、公网分域、支付和医保验收仍未完成。
