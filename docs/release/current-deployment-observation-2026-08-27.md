# 当前部署与运行观察（2026-08-27）

> 本记录对应本轮用户确认“当前没有会话正在运行”后的部署核验。它只记录新项目的运行层事实，
> 不把健康探针、构建成功或公网路由成功写成微信真机、Provider、支付或医保业务成功。

## 1. 小程序运行包

| 项目 | 结果 |
| --- | --- |
| 构建入口 | `pnpm --filter @hospital/miniprogram build` |
| 类型检查 | 通过 |
| live 运行包 | `apps/miniprogram/dist/` |
| 来源指纹 | `0be59f966de2c3a0861cb44e9a526a1ef557f6c7` |
| 页面数量 | 40 |
| 运行包门禁 | `runtime:verify` 通过 |
| pending 目录 | 不存在；本次提交没有小程序运行时代码变化，因此没有新的 pending 候选 |

构建器识别到当前提交只包含文档/迁移工具变化，沿用了已经通过验证的运行来源
`0be59f96`。这不是跳过构建：本次仍重新完成 TypeScript 检查和运行包完整性校验，
但没有为了改变来源指纹而制造没有运行时差异的候选包。

开发者工具下一次验收仍应打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\`
工程，并由其 `project.config.json` 使用 `dist/` 作为 `miniprogramRoot`；不要打开 `src/`，
也不要把测试脚本复制进 `dist/`。

## 2. 服务端共存核验

本轮通过 `ps@192.168.112.172` 的受控只读 SSH 检查确认：

| 项目 | 结果 |
| --- | --- |
| 新 API release | `1107a78a47ac2fbe0557958251d66da9effc66de` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | 仍监听 `0.0.0.0:8001`，5 个 Gunicorn 进程仍在 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 依赖 readiness | database、redis、schema 均为 `ok` |

由于服务端运行时代码相对线上 release 没有变化，本轮没有执行新 API 重启，也没有修改旧服务。
没有写入 MySQL/Redis，没有调用 Provider、支付、医保或 HIS 回写。

## 3. 公网运行层 smoke

通过 HTTPS 正常证书校验访问 `https://test-hp.meiyi.pro/api/v2`：

| 路径 | HTTP | 结果 |
| --- | ---: | --- |
| `/health/live` | 200 | `status=ok` |
| `/health/ready` | 200 | database/redis/schema 均为 `ok` |
| `/system/ping` | 200 | 新 API 响应 |

以上只证明新 API 入口和依赖就绪。九个真机证据域仍为 `pending`，后续必须从当前 live
运行包重新普通编译、生成二维码，并分别保存页面状态、客户端 `requestId`、服务端低敏日志
和适用的 Provider 请求号。

## 4. 后续操作

1. 现在可以在微信开发者工具中重新打开正确的 `apps/miniprogram` 工程并普通编译。
2. 编译前确认 `project.config.json` 的 `miniprogramRoot` 为 `dist/`；编译后以
   `dist/build-info.json` 的完整来源指纹核对当前候选。
3. 生成新二维码后，按“微信登录 → 患者目录/显式切换 → 预约只读 → 报告只读 → 门诊费用只读”取证。
4. 没有手机会话时保持证据清单为 `pending`，不能用本地测试或公网 health smoke 代替真机结果。
