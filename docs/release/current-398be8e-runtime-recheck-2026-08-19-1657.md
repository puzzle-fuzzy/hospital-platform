# 398be8e 重启后运行层只读复核（2026-08-19 16:57 CST）

> 本记录只证明新旧服务和基础设施运行层状态，不代表微信真机、众阳 Provider、患者多选、预约历史、门诊费用或普通资料写入已经完成真实验收。

## 1. 复核范围

本次通过 SSH 对 `192.168.112.172` 执行只读检查，没有修改旧 Python 项目、没有写入 MySQL/Redis、没有重启任何服务，也没有调用众阳 Provider。

检查对象：

- 新服务 release：`398be8eca74d4f0245b88695056061ac43c7f860`；
- 新 API：`10.0.0.3:18081`；
- 旧 Python API：`0.0.0.0:8001`；
- systemd：`hospital-platform-api-v2.service`；
- 生产模式下的 live/readiness 和最近 15 分钟低敏业务日志关键词。

## 2. 当前证据

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 新 API service | `active` | 新服务正常运行 |
| 新 API enabled | `enabled` | 重启后仍由 systemd 管理 |
| 当前 release | `398be8e...` | `current` 指针未漂移 |
| 新 API 监听 | `10.0.0.3:18081` | 新服务监听内网地址 |
| 旧 Python 监听 | `0.0.0.0:8001` | 旧服务继续共存 |
| `GET /health/live` | `200` | 使用 `10.0.0.3:18081` 检查 |
| `GET /health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok` |
| 最近 15 分钟业务关键词 | 未发现新增匹配行 | 只能说明本窗口没有观察到事件，不代表业务未实现或 Provider 成功 |

## 3. 探针地址注意事项

新 API 当前绑定的是 `10.0.0.3:18081`，不是 `127.0.0.1:18081`。本次第一次使用回环地址检查时得到连接拒绝；随后改用实际绑定地址，live 和 ready 均正常。

因此后续 SSH 复核必须使用：

```text
http://10.0.0.3:18081/health/live
http://10.0.0.3:18081/health/ready
```

公网验收仍使用 `https://test-hp.meiyi.pro/api/v2`，不能用内网端口结果替代公网反向代理证据。

## 4. 业务结论

本次只确认运行层恢复并且新旧服务没有相互覆盖：

1. 旧 Python `8001` 未停止，旧服务边界未被修改；
2. 新 API `398be8e`、MySQL、Redis 和 schema readiness 正常；
3. 没有新增真实微信 session 或患者业务事件，因此不升级真机和 Provider 验收等级；
4. 下一步仍按“新小程序扫码登录 → 患者同步/显式切换 → 预约历史 → 门诊费用只读”的顺序取证；支付、医保、预约写入、二维码和 HIS 回写继续关闭。

## 5. 后续维护门禁复核

本次完整 `pnpm check` 首次发现发布基线测试仍把当前服务端写成历史 release `968af78`，而路线图、候选文档和生产事实已经统一为 `398be8e`。这属于验收测试与当前基线漂移，不是运行服务故障。

已在新项目 `tools/release-baseline-audit.test.mjs` 中将当前断言更新为 `398be8e`，并补充中文注释，明确每次原子切换都必须同步更新服务端 release、小程序短提交号和完整 sourceRevision 三项事实。该修正不改变 API、数据库、Redis、Provider 或旧 Python 行为。

修正后的证据：

- 发布基线定向测试：`7 pass / 0 fail`；
- 完整 `pnpm check`：退出码 `0`；
- 架构审计：`66` 条通过；
- 文档链接审计：`237` 个 Markdown 文档无断链；
- Turbo：`9` 个 workspace 的 typecheck、test、build 全部成功；
- 小程序构建：`14` 个 `app.json` 页面脚本均生成，来源仍为 `48ba22f`。
