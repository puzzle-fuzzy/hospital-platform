# Admin 管理端：医保参保余额查询

独立 React + Ant Design 管理端，放在现有小程序项目同级。它复用旧服务的账号密码登录和
`POST /api/v1/common/mbs-fsi/1101`，只查询人员参保信息，不创建订单，也不会进入
6201、6202 或任何支付流程。

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

默认访问 `http://127.0.0.1:18083`。生产环境使用 `.env.example` 中的变量配置旧服务地址、监听
地址和端口，建议只监听回环地址并通过 Nginx 提供 HTTPS。

浏览器只访问本项目的同源 `/api`；Bun 服务端代理仅开放验证码、登录、退出和 1101 四个固定
入口，不接受任意上游路径。账号密码、访问令牌、身份证号和医保返回内容不会写入应用日志，登录
状态只保存在当前标签页的 `sessionStorage`。
