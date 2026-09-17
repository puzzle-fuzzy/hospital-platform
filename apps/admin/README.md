# 高平市人民医院管理端：实时日志与支付查看

独立 React + Ant Design 管理端，放在现有小程序项目同级。账号密码登录保留现有兼容入口；登录后提供“实时日志”和“查看支付”两个只读菜单，不发起医保参保查询、1101 查询或任何支付请求。

“实时日志”直接以终端形式展示安全调用元数据，并每 2 秒自动更新：接口、事件、时间、状态、耗时、trace/request ID、Provider 操作和错误分类。它不展示请求或返回原文。

“查看支付”按北京时间日期复用 `pnpm payment:day` 的支付流程识别和“每次调用独立入参/返回、重试单独保留、缺失即不完整”的证据组织方式。支付流程按开始时间归属到当天；查询前后各读取 30 分钟边界，跨凌晨的接口仍保留在原流程并标记为“前一日边界/次日边界”。只有能通过关联号或唯一时间线归属的记录才会进入流程，无法唯一归属的记录会被排除并提示。点击某个实际传输接口的 `i` 按钮后，服务端才在受控窗口内还原该次调用的入参和返回，并校验 chunk、UTF-8 字节数和 SHA-256；原文不会进入支付日汇总响应、数据库或 Worker ingest。

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
