# 旧 FastAPI 调度任务静态盘点

> 盘点日期：2026-08-31（Asia/Shanghai）。
>
> 本文只读取 `G:\\fuck\\hospital` 源码和随仓库提交的初始化字典，没有启动旧服务、
> 连接旧数据库/Redis 或读取生产 `app_job` 记录。因此“源码中可注册的任务”与“生产中
> 当前启用的任务”必须分开，不能用前者替代后者。

## 1. 启动链路

旧服务在 `app/plugin/init_app.py` 的 FastAPI lifespan 中按以下顺序启动后台能力：

1. `SchedulerUtil.init_system_scheduler()` 启动 APScheduler；
2. 从数据库读取 `app_job`，对每条记录先删除同 id 的内存任务，再重新注册；
3. 创建常驻 `plugin_payment_reconcile_loop` asyncio task；
4. 服务关闭时取消支付恢复 task，再关闭调度器。

这意味着仅检查 Python 文件不能知道生产到底启用了多少个任务；数据库中的 `app_job`
记录和实际配置必须在切换前单独导出、脱敏和核对。

## 2. 静态可注册任务清单

| 来源 | 任务/能力 | 触发方式 | 当前迁移判断 | 证据 |
| --- | --- | --- | --- | --- |
| `app.module_task.scheduler_test` | `job` | 由 `app_job.func` 动态引用 | 演示函数，不迁移 | `app/module_task/scheduler_test.py` |
| `app.module_task.scheduler_test` | `async_job` | 由 `app_job.func` 动态引用 | 演示函数，不迁移 | `app/module_task/scheduler_test.py` |
| `app.api.v1.module_common.yunhealth_settle.reconcile` | `plugin_payment_reconcile_loop` | 应用启动即常驻，每 `YUNHEALTH_PLUGIN_RECONCILE_INTERVAL_SECONDS` 秒轮询 | 支付/HIS 最后批次；新 Worker 暂无等价云健康/HIS 回写恢复器 | `app/plugin/init_app.py`、`app/api/v1/module_common/yunhealth_settle/reconcile.py` |
| `app.api.v1.module_application.job` | `app_job` 动态任务管理 | 数据库记录决定是否启用；支持 date/interval/cron | 后台管理不迁移到患者小程序；切换前必须盘点实际启用记录 | `app/core/ap_scheduler.py`、`app/api/v1/module_application/job/model.py` |

### 2.1 动态任务的允许范围

旧 `SchedulerUtil.add_job()` 只会把 `func` 拼接为 `app.module_task.<func module>`，
因此 `sys_job_function` 中的 `scheduler_test.job` 是初始化字典里的演示项，不代表线上
一定存在对应 `app_job`。调度器支持三种触发器：

- `date`：指定日期；
- `interval`：五段秒/分/时/天/周表达式；
- `cron`：六或七段 cron 表达式。

生产盘点至少要保留：任务 id、名称、启用状态、函数引用、触发器、开始/结束时间、
jobstore、executor、参数是否存在、最近/下次运行时间和负责人。参数值可能含敏感信息，
导出时只保留“存在/长度/固定分类”，不能直接把 `args`/`kwargs` 原文写入文档或日志。

## 3. 支付恢复循环的迁移影响

`plugin_payment_reconcile_loop` 会扫描“微信预支付已创建但云健康/HIS 未完成回写”的
插件订单，调用云健康完成接口；它不是普通 `app_job` 记录，也不会出现在 APScheduler
任务列表。新平台目前只有微信通知、查单和人工复核边界，没有对应的云健康/HIS 插件恢复
handler，因此不能把新 Worker 的普通 outbox 重试当作等价替代。

在支付/HIS 批次开启前，必须逐项确定：

1. 旧循环停止前的候选订单快照和对账结果；
2. 新恢复器或人工处置的责任边界；
3. 重复回写、超时、退款中和 Provider 不确定状态的处理；
4. 旧端只读窗口、回滚方式和恢复演练证据。

## 4. 受控服务器盘点命令

以下命令应在旧服务服务器的受控只读 shell 中执行；不要把输出直接贴入聊天、Git 或
日志。命令只读取任务元数据和数量，不读取任务参数原文：

```sql
SELECT
  id,
  name,
  status,
  trigger,
  jobstore,
  executor,
  func,
  start_date,
  end_date,
  CASE WHEN args IS NULL OR args = '' THEN 0 ELSE 1 END AS has_args,
  CASE WHEN kwargs IS NULL OR kwargs = '' THEN 0 ELSE 1 END AS has_kwargs,
  created_at,
  updated_at
FROM app_job
ORDER BY status DESC, id ASC;
```

盘点完成后，为每条启用记录填写以下去向之一：`退休`、`继续留在旧系统`、`改写到新
Worker`、`需要业务负责人确认`。只有所有记录有去向、负责人、停用/切换时间和回滚方案，
才能关闭本项外部工作。

## 5. 当前结论

- 已完成旧仓库源码和初始化字典的静态任务盘点；
- 已确认演示函数不应被误迁移；
- 已确认支付恢复循环是独立于 APScheduler 的支付/HIS 运行时能力；
- 旧数据库实际启用记录、任务参数的敏感性、业务负责人和切换窗口尚未取得证据；
- 在这些证据到齐前，新 Worker 不启动支付/HIS 恢复循环，相关 gate 保持 `not_configured`
  或 `not_ready`。
