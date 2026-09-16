# 高平市人民医院管理端：接口调用日志

独立 React + Ant Design 管理端，放在现有小程序项目同级。账号密码登录保留现有兼容入口；登录后仅提供“接口调用日志”菜单，不发起医保参保查询、1101 查询或任何支付请求。

日志列表查看新服务 API 与 Worker 上送的安全调用元数据：接口、事件、时间、状态、耗时、trace/request ID、Provider 操作和错误分类。读模型默认有界，API 重启后会清空；点击带关联号的单条记录后，管理端会在服务端 journald 的窄时间窗口内受控还原请求/返回原文，最多展示 300 条，并校验 chunk、UTF-8 字节数和 SHA-256。原文不会写入日志读模型、数据库或 Worker ingest，也不支持无条件批量导出。

## 本地运行

```bash
pnpm install
pnpm --filter @hospital/admin typecheck
pnpm --filter @hospital/admin test
pnpm --filter @hospital/admin build
pnpm --filter @hospital/admin start
```

默认访问 `http://127.0.0.1:18083`。生产环境使用 `.env.example` 中的变量配置旧登录服务和日志读取地址、服务间令牌；API 还需要配置 `ADMIN_LOGS_INGEST_TOKEN`，Worker 需要使用同一个内部 ingest 地址和令牌（`ADMIN_LOGS_INGEST_URL`、`ADMIN_LOGS_INGEST_TOKEN`）。建议只监听回环地址并通过 Nginx 提供 HTTPS。

浏览器只访问本项目的同源 `/api`；Bun 服务端代理仅开放验证码、登录、退出和日志查询固定入口，不接受任意上游路径。日志代理只发送独立的 `X-Admin-Token`，不会把新服务令牌下发浏览器。账号密码、访问令牌和日志原文不会写入日志读模型；原始日志只在已登录管理会话的单条详情中按关联号读取，登录状态只保存在当前标签页的 `sessionStorage`。
