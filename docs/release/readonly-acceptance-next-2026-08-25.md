# 当前候选只读业务验收手册（2026-08-25）

> 当前本地小程序运行候选：`7fc22fae975d207d66cd248de01ac0287492f800`（提交 `7fc22fae`）。开发者工具必须直接打开
> `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist\`，不能打开父目录、`src/` 或历史
> `mp-weixin` 工程。运行包已经通过 `runtime:verify`，四个主 Tab 使用微信原生 `tabBar`，
> `dist/` 不包含 `custom-tab-bar/`；本手册只覆盖代码和设备验收顺序，不把本地测试当作线上业务完成。

## 1. 本轮允许验收的范围

| 业务 | 允许验证 | 不得顺手触发 |
| --- | --- | --- |
| 微信会话与患者目录 | 登录、会话恢复、患者目录读取、显式切换、刷新 | 建档、绑卡、解绑、修改患者资料 |
| 预约历史 | 在线挂号/全部挂号读取、爽约记录派生筛选 | 锁号、预约下单、取消、支付 |
| 门诊费用 | `unpaid`/`paid` 只读目录和空态/错误态 | 创建支付订单、微信调起、医保授权、结算、退款 |
| 报告 | gate 关闭时的稳定“依赖未配置/暂未开放”边界 | 伪造报告数据、打开报告 gate、下载附件、报告解读 |
| 普通资料 | `GET /me/profile` 的安全默认值和字段校验 | `PUT`、真实资料写入、409 冲突，除非另有受控测试值授权 |

二维码、患者新增绑定、病历、支付、医保、HIS 写回和外部 WebView 不属于本手册的可用范围。

## 2. 开发者工具与真机入口

1. 关闭旧的 `src/`、父目录和历史 `mp-weixin` 工程，只保留 `apps/miniprogram/dist/`。
2. 清理开发者工具编译缓存后重新编译；如果工具仍显示旧页面脚本或旧图标，关闭项目并重新打开 `dist/`，不要通过继续刷新旧窗口解决。
3. 检查底部栏：四个主页面必须是 `pages/index/index`、`pages/consult/consult`、`pages/hospital/hospital`、
   `pages/my/my`；点击它们必须使用 `switchTab`，底部栏只允许由根 `app.json.tabBar` 声明，不能由页面 WXML
   或自定义组件复制；当前项的蓝色图标和文字由微信根据 `selectedIconPath` 自动维护。
4. 预览/真机扫码时记录运行包候选 `7fc22fae` 和微信开发者工具显示的项目根；当前二维码为
   `.local/hospital-miniprogram/tabbar-native-preview-7fc22fa.png`，不能把旧二维码或历史运行包证据归入本候选。

## 3. 设备操作顺序

按以下顺序操作，每一步都等页面状态收敛后再进入下一步：

1. 进入“医疗服务”，完成微信静默登录；确认页面先显示会话验证状态，随后才展示当前 owner 的患者目录。
2. 点击“更换就诊人”，确认进入独立患者选择页；点击已有患者后返回首页，确认首页患者卡片与选择页一致。
3. 点击“刷新就诊人”，确认加载期间不会把旧患者短暂显示成当前患者，也不会把失败显示成空目录。
4. 依次从首页进入“我的挂号”的“在线挂号”和“全部挂号”，确认标签切换与服务端查询范围一致；再进入爽约记录，确认不会自动弹出“选择就诊人”。
5. 进入门诊缴费，分别观察待缴和已缴两个只读列表；只验证脱敏展示、加载壳、空态和错误重试，不点击任何付款入口。
6. 进入报告查询，确认当前关闭 gate 的文案明确表示暂未开放，不出现“未查询到报告”的假空态。
7. 从四个主 Tab 互相切换多次，确认底部栏只有一份、选中图标随当前主页面变化、内容区域滚动而底部栏不滚动。

## 4. 日志证据

客户端只记录低敏 `requestId`、HTTP method/path、状态和错误码；服务端日志用同一请求上下文关联：

- HTTP 事件包含 `requestId`/`traceId`、method、path、statusCode 和结果类别；
- 患者、预约、费用和报告业务事件沿用同一 `traceId`，必要时记录低敏 `providerRequestId`；
- 不记录患者姓名、身份证、卡号、HIS `patId`、provider 原始 JSON、金额明细、token 或二维码原文；
- 页面“成功显示”不能替代 Provider 请求成功；只有客户端 requestId、服务端业务事件和受控 Provider 结果三者同链，才能进入真实只读验收记录。

如需执行服务端只读 smoke，必须使用 [`provider-directory-acceptance.md`](provider-directory-acceptance.md) 中的受控环境变量和 bundle；
不得把 access token、内部 patientId 或 provider 患者号写入仓库、命令历史或验收文档。`patient-sync` 仅在明确授权时执行，
它不是患者建档/绑卡接口。

## 5. 结果判定

| 证据 | 可宣称的结论 |
| --- | --- |
| 本地 typecheck/test/runtime:verify | 代码和运行包边界通过 |
| 页面截图或开发者工具模拟器 | 模拟器页面交互通过，不等于真机/Provider 通过 |
| 真机页面 + 客户端 requestId | 微信设备链路触发了对应平台 API |
| 服务端 Pino 同链事件 | 平台 API 和业务 service 已收到并记录该请求 |
| Provider 脱敏响应/请求号 | 仅能证明对应只读 Provider 能力；不能扩展到支付或写入 |

任何一层缺失，都必须在验收记录中写成“待补证据”，不能写成“业务已完成”。旧 Python 服务、旧数据库表和旧端口保持原状，
本手册不要求重启或修改旧服务。

## 6. 本轮 SSH 前置复核（2026-08-25）

本轮通过受控 SSH 只读取服务状态、监听端口、当前 release 指向和 readiness 响应，未读取或输出任何环境变量值、
微信密钥、数据库连接串、Redis 凭证、Bearer token 或患者标识：

| 检查项 | 结果 | 可证明的范围 |
| --- | --- | --- |
| `hospital-platform-api-v2.service` | `active` | 新 Elysia API 进程仍在运行 |
| 新 API 内网监听 | `10.0.0.3:18081` | 新服务有独立内网监听边界 |
| 旧服务监听 | `0.0.0.0:8001` | 旧服务端口仍在监听，本轮未停止或重启 |
| `/health/ready` | `database=ok`、`redis=ok`、`schema=ok` | 新服务基础依赖和 schema 就绪 |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` | systemd 当前指向的代码版本 |

随后按本手册启动当前 release 的只读 smoke。runner 在发送第一个业务 HTTP 请求前以
`configurationReason=access-token-missing` 停止；因此本轮没有发出患者目录、预约历史、门诊费用或 Provider 请求，
也没有产生可供关联的业务 `requestId`。这不是“患者数据为空”、不是“Provider 拒绝”，更不是新服务业务链路已验收。

真实验收的下一前置条件是：由运维人员在单次进程环境中临时注入一个短时有效的平台 Bearer 会话和对应的内部
opaque `patientId`，运行结束后销毁；严禁把它们写入 `shared/api.env`、常驻 systemd 环境、Git、命令历史、日志或聊天。
凭据注入完成后，必须重新执行本手册的完整顺序，并同时保存客户端 requestId、服务端同链日志和受控 Provider 脱敏结果。

## 7. 本轮服务端只读工具 staging（2026-08-25）

为执行上述真实只读 smoke，本轮没有替换服务端 `current`，而是在服务器新建了独立的
验收工具目录：

```text
/home/ps/code/hospital-platform/releases/82c5e9e34775e4078fc891625a4b94110dde4451-readonly
```

该目录由当前运行 release 的只读 API/Worker bundle 复制而来，仅额外放入
`tools/provider-smoke-secure.ts`。本轮复核结果如下：

| 检查项 | 结果 |
| --- | --- |
| 新 API `current` | 仍为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 旧 Python | `0.0.0.0:8001` 继续监听 |
| 验收 wrapper | 已存在，远端 SHA-256 与本地 `21dfd669...` 一致 |
| 真实业务 smoke | 尚未启动，未注入 token/patientId，未发出业务请求 |

受控终端执行入口如下；`<短时凭据>` 不得通过命令参数、聊天、文件、systemd 或 shell history
传递，wrapper 会在交互式 TTY 中隐藏读取：

```bash
set -a
. /home/ps/code/hospital-platform/shared/worker.env
set +a
HOSPITAL_API_BASE_URL="https://test-hp.meiyi.pro" \
HOSPITAL_API_PREFIX="/api/v2" \
/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/82c5e9e34775e4078fc891625a4b94110dde4451-readonly/tools/provider-smoke-secure.ts" \
  --bundle \
  "/home/ps/code/hospital-platform/releases/82c5e9e34775e4078fc891625a4b94110dde4451-readonly/apps/worker/dist/provider-directory-smoke.js"
```

默认只读能力不包含 `patient-sync`、支付、医保、预约写入、退款和 HIS 写回。执行结束后，验收
记录必须同时保存客户端 `requestId`、服务端 `traceId`/业务事件和 Provider 脱敏请求号；任一层缺失，
只能记录为“待补证据”。
