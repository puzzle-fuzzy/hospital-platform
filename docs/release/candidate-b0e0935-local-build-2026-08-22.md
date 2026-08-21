# 未部署候选 `b0e0935` 本地构建记录（2026-08-22）

> 这是患者卡号公共 contract 收紧后的本地候选，不是线上 release。线上服务端仍为
> `7181e99e3a352244102f5591279528b3b66332c9`；在完成新 API 原子发布并重新生成真机包前，
> 不得把本记录当作线上或真机业务验收证据。

## 候选来源

| 项目 | 结果 |
| --- | --- |
| 本地服务端提交 | `b0e09356` |
| 小程序运行包来源 | `b0e09356` 对应的完整 Git 提交 |
| 生产服务端 release | `7181e99e`，未因本轮本地提交自动改变 |
| 小程序页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 测试运行脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在，符合运行包边界 |

## 本轮变更

公共 `PatientSchema` 新增标准 JSON Schema 卡号脱敏 pattern：最多保留前五位和后四位，
中间至少有一个 `*`，或使用 `未绑定` 哨兵。领域层、众阳 adapter 和小程序边界仍保留各自
的运行时复核，避免只依赖 HTTP schema。

合成 15 位卡号 `123456789012345` 的展示结果为：

```text
12345******2345
```

本轮没有调用众阳、没有重同步线上历史患者快照、没有写 MySQL/Redis，也没有修改或重启旧
Python 服务。历史快照中的 `******7890` 不能反推出被隐藏的前五位，必须在真实 Provider
卡号可用时受控同步。

## 本地门禁

- contracts：`3 pass / 0 fail`；
- domain：`69 pass / 0 fail`；
- adapters：`107 pass / 0 fail`；
- 小程序：`205 pass / 0 fail`；
- Worker：`53 pass / 0 fail`；
- API：最新定向运行 `205 pass / 1 fail`；唯一失败是 `P0 acceptance documents share the current release baseline`，
  因 `b0e09356` 尚未部署而按设计阻断，业务测试本身没有新增失败；
- 文档断链、Biome、lint、9 个 workspace typecheck/test/build：通过；
- 小程序 `build` 和 `runtime:verify`：通过，来源为 `b0e09356`。

根 `pnpm check` 的 release-baseline 项按设计阻止通过，因为 `packages/contracts/src/index.ts`
尚未进入线上 `7181e99e`；API 测试中的当前 release 一致性断言也因此保持失败。这是未部署
候选的真实状态，不应通过修改基线文档绕过。

## 2026-08-22 07:26 本地发布产物复核

API 与 Worker 均使用仓库构建脚本生成，没有在 release 目录临时安装 workspace 依赖：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `889a2bb7b059c8417e1faf44b11775dc23d785991f6244429cd42b7a42bfb1b4` |
| `apps/worker/dist/index.js` | `a878a89f927ceb3f6994fa1ee305db6d0074aed296db06672a97d2aef69db368` |
| `apps/worker/dist/preflight.js` | `44bb4332b6db1a6f596f36a03c6431a6928bb08de8607c1a87ebcb3656085447` |
| `apps/worker/dist/provider-directory-smoke.js` | `1138c0f9fa06d398ef463cf9fd8836e873e892ca54094cd146dc27570f28a` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `bacb3293d4f229299ddf035e89e010dc3dd3af2b9b592e477e91b58f88fb78ff` |

使用上述同一份 `api-runtime-smoke.js`、生产模式变量、`/api/v2` 公网前缀和 `requireReady=true`
执行只读运行层 smoke，结果为通过。该 smoke 只访问健康、认证边界和关闭路由，没有登录、患者参数、
Provider 调用或数据库/Redis 业务写入；它不能替代服务器真实 env preflight、临时 `18082` smoke、旧
Python `8001` 共存检查或真机三层业务验收。

## 下一步

1. 按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 为 `b0e09356`
   构建并上传服务端 bundle，完成生产 env preflight 和隔离端口 smoke；
2. 只原子切换 `hospital-platform-api-v2.service`，确认新 API 与旧 Python `8001` 共存；
3. 更新当前发布基线后重新构建小程序并执行普通编译；
4. 用最新二维码采集微信登录、患者目录、显式患者切换和只读业务的页面/客户端/服务端三层证据。

支付、医保、二维码、患者绑定、预约写入和 HIS 回写仍保持关闭。
