# 当前小程序候选 `b0e0935` 构建与真机准入记录（2026-08-22）

> 本记录是当前唯一小程序候选入口。它证明构建产物和开发者工具缓存边界，不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 小程序客户端 | `b0e0935` |
| 小程序构建来源 | `b0e093565493285e07fe549879f8b87eda649cc7` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |
| 真机业务状态 | 尚未取得当前 release 的三层同链证据 |

## 1. 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序定向测试 `205 pass / 0 fail / 1543 expect()`（以本轮实际命令输出为准）。

构建发布器把 `src/**/*.test.ts` 和 `src/**/*.spec.ts` 排除，并在 staging 发布前再次扫描 JS 文件；发现测试运行脚本会直接失败。
这条边界是有意设计的：`src/services/single-flight.test.ts` 只属于 Bun 测试输入，微信运行包只需要
`dist/services/single-flight.js`。

## 2. `single-flight.test.js` ENOENT 恢复

真机调试报错：

```text
ENOENT ... apps/miniprogram/dist/services/single-flight.test.js
```

对当前 `dist/` 的只读复核结果为：`single-flight.js` 存在，`single-flight.test.js` 不存在，全部 `*.test.js`/`*.spec.js`
为 0，源码和运行包也没有对测试文件的运行时引用。因此不能把测试文件手工复制到 `dist/`；那会让开发工具把测试代码当成
业务模块，并破坏构建与真机包隔离。

本轮已重新构建完整运行包，并通过微信开发者工具 CLI 依次执行：

1. 关闭 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 项目；
2. 清理该项目的 `compile` 缓存；
3. 重新打开同一项目根目录；
4. 保持 `project.config.json.miniprogramRoot` 为 `dist/`，再执行一次普通编译后生成新二维码。

这只修复开发者工具旧增量模块索引；若普通编译后仍出现同一错误，应再次确认打开的是新项目根目录，而不是旧 `mp-weixin`
项目，并重新核对 `dist/build-info.json`。不能修改旧项目，也不能因为工具缓存错误去改变业务 import。

## 3. 2026-08-22 当前预览命令观察

本轮使用当前项目根目录执行微信开发者工具 CLI 预览，输出目录在仓库外的临时目录，未把二维码或工具生成文件写入仓库。
CLI 最后返回了微信工具侧未细化的 `code 10 / 错误 undefined`，但同时实际生成了二维码图片和包大小信息：运行包大小为
`638959` 字节，图片文件存在，`single-flight.test.js` 仍未进入运行包。这个结果只能说明本机工具生成了预览产物，不能推断
微信预览上传、手机连接或业务请求已经成功；因此当前二维码和真机业务状态仍保持 `pending`。

若扫码后仍出现工具错误，应在开发者工具界面确认登录账号具有该 AppID 的预览权限，再对当前 `miniprogram` 项目执行一次
“普通编译 → 预览”。不要把测试脚本复制到 `dist/`，也不要切回旧 `mp-weixin` 项目。切换后线上低敏日志观察窗口只有健康探针，
没有 `auth.*`、`patient.*`、`appointment.*` 或 `outpatient.payment.*` 业务事件，所以目前没有可误判为业务失败的请求。

随后对线上 `49f74e0` 的 `08:23–08:30 CST` journald 做低敏聚合：`parseErrors=0`、`systemdWarningCount=0`，仅有
`http.request.completed=1` 且状态为 `200` 的基础设施请求；没有登录、患者、预约或门诊费用业务事件。该结果证明当前窗口
没有产生可用于三层验收的设备业务流量，不证明这些业务接口已经完成真机验收。

## 4. 2026-08-22 08:34 当前开发者工具窗口准入

复核发现开发者工具此前前台窗口标题为旧端 `mp-weixin`，其控制台内容不属于新端证据；本轮没有在该窗口继续操作。
随后通过 CLI/开发者工具界面打开并确认当前项目窗口标题为 `miniprogram`，资源树根目录显示 `MINIPROGRAM`，且包含
`dist/`、当前 `project.config.json` 和小程序源码目录。新窗口使用基础库 `3.17.1`，与当前运行包一致。

从新项目窗口执行“真机调试”后，开发者工具生成了代码包约 `619 KB` 的二维码，选择 `iOS` 和“局域网模式”，二维码在
`09:00` 前有效。这个结果证明当前新项目已经进入真机扫码前置状态，但不证明手机已连接、微信登录已完成或 Provider 已调用。
新项目控制台当前只出现未登录时访问 `/api/v2/me` 返回 `401` 的预期鉴权结果；没有把该结果计入业务成功，也没有读取或记录
旧窗口中的患者/Provider 日志。

## 5. 2026-08-22 08:34–08:41 只读业务观察

重新扫码并使用当前新项目窗口后，服务器端 `49f74e0` 的低敏 P0 聚合得到：

- 微信登录请求/成功各 `1` 次；
- 患者目录读取 `5` 次、同步成功 `2` 次；
- 预约科室目录请求/成功各 `1` 次，排班目录请求/成功各 `1` 次，排班快照持久化 `1` 次；
- HTTP 完成 `12` 次且均为 `200`；另有 `1` 次 `401`，属于扫码前未登录探测；
- `parseErrors=0`、`systemdWarningCount=0`。

开发者工具当前确认的是新 `miniprogram` 窗口，页面可以进入“选择就诊人”和预约排班两列目录；这仍然不是手机屏幕截图，
所以“真机页面层”保持 `pending`，不能只凭服务器事件把真机验收标记为完成。支付、医保、预约提交和 HIS 写回未触发。

本次聚合还发现 `correlation.missingCount=1`。源码复核确认原因是预约排班快照持久化日志没有继承 HTTP `traceId`，不是 Provider
业务失败；修正已提交为服务端候选 `c01b1af`，并补充成功/失败日志回归测试，但尚未部署线上。部署后必须重新取得一轮预约只读请求，
确认缺失关联计数归零，再把该链路升级为可维护证据。

## 6. 真机验收停止条件

重新生成二维码后，必须使用当前 `b0e0935` 运行包采集：页面结果、客户端 `/api/v2/` 请求与 requestId/traceId、服务端 Pino
低敏同链事件。缺少任何一层，都只能记录为 `pending`。微信登录、患者同步/切换、预约历史和门诊费用按既有 P0 手册逐域执行；
报告、患者绑定、病历、二维码协议、支付、医保和 HIS 回写继续关闭或最后处理。

