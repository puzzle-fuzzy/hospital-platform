# `84fac75c` 新 API 生产切换验收记录（2026-08-22）

## 当前发布基线

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `84fac75ceeb2247b252cf7e160eedbda220378f8` |
| 小程序客户端候选 | `90fd783` |
| 小程序构建来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，切换前后仍为原 Gunicorn 进程 |
| Worker | `hospital-platform-worker-v2.service=inactive` |

本记录只描述新 Bun/Elysia API 的候选切换。旧 Python 服务、旧端口、数据库 schema、业务数据和
Redis 会话没有被本次发布流程修改；没有执行 migration、支付、医保、HIS 写回或 Provider 写入。

## 切换前候选门禁

- 本地 API、Worker bundle 由 `84fac75ceeb2247b252cf7e160eedbda220378f8` 构建；上传后远端 bundle checksum 与本地候选一致。
- 使用服务器现有受保护 `shared/api.env` 执行生产 preflight：MySQL、Redis、schema 和微信身份配置通过；支付保持 `disabled`，报告目录/详情保持 `disabled`。
- 在 `127.0.0.1:18082` 隔离启动候选，ready 连续 3 次 `200`；live、system-ping、未登录认证边界和关闭路由 smoke 全部通过。
- 隔离进程在切换前已停止，未接收公网流量。

## 原子切换与切换后验收

按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 在同一文件系统中执行
`current.next -> current` 原子替换，只重启 `hospital-platform-api-v2.service`。

- 切换前 `current`：`002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`。
- 切换后 `current`：`84fac75ceeb2247b252cf7e160eedbda220378f8`。
- 切换后新 API active，PID 更新为 `3794561`；旧 Python Gunicorn PID 与 `8001` 监听保持不变。
- 内网 `http://10.0.0.3:18081/health/live`、`/health/ready`、`/api/v1/system/ping` 均通过；ready 返回 `database=ok`、`redis=ok`、`schema=ok`。
- 公网 `https://test-hp.meiyi.pro/api/v2/health/live`、`/health/ready`、`/system/ping` 均返回 `200`。
- 公网未登录 `/api/v2/patients` 与预约历史路径均返回 `401`；没有携带患者、订单或 Provider 凭证。

## 当前业务边界

本次发布只让报告服务的详情引用时间窗口校验进入线上 bundle：仓储回写的 `createdAt`、`expiresAt`
必须与服务端生成的十分钟窗口完全一致，防止错误仓储实现延长短期详情能力。报告 Provider gate 仍关闭，
因此没有把报告真实数据或临床详情宣称为已验收。

真机微信登录、患者同步/切换、预约历史、爽约和门诊费用仍需按当前 `90fd783` 运行包取得页面、客户端
HTTP、服务端低敏日志三层证据。支付、医保、预约写入、HIS 回写和 Worker 继续保持最后专项。
