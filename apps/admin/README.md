# 高平市人民医院管理端：医保参保余额查询

独立 React + Ant Design 管理端，放在现有小程序项目同级。账号密码登录暂时保留旧服务
兼容入口；参保查询已经切换到新服务的独立 Admin 接口
`POST /api/v2/admin/insurance/1101`（服务端实际路由为 `/api/v1/admin/insurance/1101`）。
它只查询人员参保信息，不创建订单，也不会进入 6201、6202 或任何支付流程。

登录后左侧“接口调用日志”菜单可查看新服务 API 与 Worker 上送的安全调用元数据：接口、事件、时间、状态、耗时、trace/request ID、Provider 操作和错误分类。读模型默认有界，API 重启后会清空；需要请求参数或返回原文时，必须按 traceId 从服务端受控原始日志导出，不通过浏览器菜单批量暴露。

## 查询能力

- 身份证：`mdtrt_cert_type=02`
- 电子凭证：`mdtrt_cert_type=01`
- 社会保障卡：`mdtrt_cert_type=03`，同时要求 `card_sn`
- 展示 1101 返回的全部 `insuinfo`，包括险种代码、参保状态、`balc`、参保地区、单位和 `PSN_NO`
- `PSN_NO` 是 1101 返回字段，不伪装成当前网关不支持的直接查询入参；页面提供可选返回核对

## 本地运行

```bash
pnpm install
pnpm --filter @hospital/admin typecheck
pnpm --filter @hospital/admin test
pnpm --filter @hospital/admin build
pnpm --filter @hospital/admin start
```

默认访问 `http://127.0.0.1:18083`。生产环境使用 `.env.example` 中的变量分别配置旧登录服务、
新服务 Admin 查询地址、日志读取地址和服务间令牌；API 还需要配置
`ADMIN_LOGS_INGEST_TOKEN`，Worker 需要使用同一个内部 ingest 地址和令牌
(`ADMIN_LOGS_INGEST_URL`、`ADMIN_LOGS_INGEST_TOKEN`)。建议只监听回环地址并通过 Nginx 提供 HTTPS。

浏览器只访问本项目的同源 `/api`；Bun 服务端代理仅开放验证码、登录、退出、1101 和日志
查询两个固定入口，不接受任意上游路径。查询代理只发送固定的 `X-Admin-Query-Token`，日志
代理只发送独立的 `X-Admin-Token`，不会把新服务令牌下发浏览器。账号密码、访问令牌、身份证号
和医保返回内容不会写入日志读模型，登录状态只保存在当前标签页的 `sessionStorage`。
