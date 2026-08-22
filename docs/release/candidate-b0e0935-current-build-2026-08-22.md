# 当前小程序候选 `b0e0935` 构建与真机准入记录（2026-08-22）

> 本记录是当前唯一小程序候选入口。它证明构建产物和开发者工具缓存边界，不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `49f74e0209778836db41bef6249758b4f590792a` |
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

## 4. 真机验收停止条件

重新生成二维码后，必须使用当前 `b0e0935` 运行包采集：页面结果、客户端 `/api/v2/` 请求与 requestId/traceId、服务端 Pino
低敏同链事件。缺少任何一层，都只能记录为 `pending`。微信登录、患者同步/切换、预约历史和门诊费用按既有 P0 手册逐域执行；
报告、患者绑定、病历、二维码协议、支付、医保和 HIS 回写继续关闭或最后处理。
