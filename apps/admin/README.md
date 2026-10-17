# 高平市人民医院管理端：实时日志与支付查看

独立 React + Ant Design 管理端，放在现有小程序项目同级。账号密码登录保留现有兼容入口；登录后提供“支付数据”和“实时日志”菜单。支付数据页合并展示服务端已落库的普通支付订单和医保订单；医保订单提供“医保 + 微信一并退费”入口，由服务端一次编排 6203 和微信 APIv3 现金腿。

“实时日志”直接以终端形式展示安全调用元数据，并每 2 秒自动更新：接口、事件、时间、状态、耗时、trace/request ID、Provider 操作和错误分类。它不展示请求或返回原文。

“支付数据”首先按服务端已落库订单展示支付时间、业务、就诊人、下单用户、订单号、金额分项、支付状态和已有退款台账摘要。就诊人和下单用户仅展示服务端提供的名称 `patientDisplayName`、`orderUserDisplayName`；未关联就诊人显示“未关联”，未设置用户昵称显示“未设置”。下单用户指创建订单的平台用户，不代表实际微信付款人。患者和用户 ID、身份证号、卡号、支付凭证、微信调起参数、`out_trade_no` 和 Provider 上下文不会返回浏览器。页面下方仍按北京时间日期复用 `pnpm payment:day` 的支付流程识别和“每次调用独立入参/返回、重试单独保留、缺失即不完整”的证据组织方式。支付流程按开始时间归属到当天；查询前后各读取 30 分钟边界，跨凌晨的接口仍保留在原流程并标记为“前一日边界/次日边界”。日汇总阶段只读取支付业务事件，随后按每笔订单的关联号定向读取 raw 传输记录，避免整天无关原始报文超过 journald 查询上限；只有能通过关联号或唯一时间线归属的记录才会进入流程，无法唯一归属的记录会被排除并提示。点击某个实际传输接口的 `i` 按钮后，服务端复用受控订单快照并校验 chunk、UTF-8 字节数和 SHA-256；原文不会进入支付日汇总响应、数据库或 Worker ingest。

## 本地运行

```bash
pnpm install
pnpm --filter @hospital/admin typecheck
pnpm --filter @hospital/admin test
pnpm --filter @hospital/admin build
pnpm --filter @hospital/admin start
```

默认访问 `http://127.0.0.1:18083`。生产环境使用 `.env.example` 中的变量配置旧登录服务和日志读取地址、服务间令牌；API 还需要配置 `ADMIN_LOGS_INGEST_TOKEN`，Worker 需要使用同一个内部 ingest 地址和令牌（`ADMIN_LOGS_INGEST_URL`、`ADMIN_LOGS_INGEST_TOKEN`）。建议只监听回环地址并通过 Nginx 提供 HTTPS。

浏览器只访问本项目的同源 `/api`；Bun 服务端代理仅开放验证码、登录、退出、日志、支付查看和固定的退费后端入口，不接受任意上游路径。医保订单退费只发送一条整笔聚合命令，管理员不能从页面分别发起医保腿或微信腿；普通纯微信订单仍不在此聚合入口中处理。退费代理只发送独立的 `X-Admin-Refund-Token`，不会把新服务令牌下发浏览器。账号密码、访问令牌和日志原文不会写入日志读模型；原始日志只在已登录管理会话的单条详情中按关联号读取，登录状态只保存在当前标签页的 `sessionStorage`。

医保聚合退费的同源入口是 `POST /api/refunds/medical-insurance`，服务端固定转发到新 API 的隐藏 Admin 路由；请求只包含订单号和可选退费原因，退费单号、6203 凭证、微信 `out_trade_no` 和两腿状态均由服务端处理。状态查询使用 `GET /api/refunds/medical-insurance/{refundNo}`。
