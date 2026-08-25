# 小程序候选 `77cebe5`：跨域入口页面外壳（2026-08-26）

## 结论

本候选按“先整体覆盖、再深入真实契约”的策略，继续把旧端尚未有原生页面的入口迁移为稳定的原生关闭态页面：

- 临床内容：入院预问诊、健康自测、出院随访、电子锦旗、表扬信、预约前预问诊、风险评估；
- 外部入口：智能客服、我的问诊、消息订阅；
- 预约 Provider 只读入口：采血预约、挂号详情。

共新增 12 个页面，旧端 19 个临床页面、3 个外部页面和 2 个预约 Provider 页面均不再直接落到统一状态页或不存在的页面。页面只展示业务范围、迁移状态和待确认 contract；不会调用 Provider、打开 WebView、读取旧缓存、提交问卷/内容/预约或生成医疗结论。

## 来源与运行包

| 项目 | 当前事实 |
| --- | --- |
| 功能代码提交 | `77cebe54149e4ab8552229e809dca707fcd83c0d`（`77cebe5`） |
| pending 运行包来源 | `77cebe54149e4ab8552229e809dca707fcd83c0d` |
| pending 运行包路径 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 旧端页面台账 | 64/64 有明确落点；`surface-only=31`、`blocked-payment=7` |
| 线上服务 | 未发布；旧 Python `8001` 未修改、未停止 |
| live `dist` | 仍被微信开发者工具占用，本候选未覆盖旧运行包 |

构建完成了类型检查、页面文件/事件/导航静态检查和 staging 生成。原子替换 `dist` 时因微信开发者工具占用返回 `EBUSY`，构建脚本保留了完整 40 页 pending 候选；随后独立校验通过：

```text
Mini program pending verified: revision=77cebe5; 40 pages and required root files are present
```

## 结构门禁与回归

| 检查 | 结果 |
| --- | --- |
| `pnpm format:check` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 9/9 workspace 包通过 |
| 小程序测试 | `293 pass / 0 fail / 3378 expect()` |
| `pnpm migration:audit` | 64 个旧页面、40 个新页面、195 个旧服务端路由、87 个旧端接口字面量均有登记 |
| `pnpm migration:boundary:audit` | 34 个冻结入口 gate 通过 |
| `pnpm migration:breadth:audit` | 首页 22 个、我的 9 个 action；40 个页面交互；四个主 Tab 通过 |
| `pnpm docs:audit` | 749 个文档，无断链 |

共享工厂已纳入构建和交互审计：

- `clinical-content-surface.ts`：临床内容入口，按业务保留患者选择或不显示患者选择；
- `external-entry-surface.ts`：外部会话入口，不生成 URL、不传递平台 token；
- `provider-entry-surface.ts`：预约 Provider 入口，保留患者选择但不发起读取。

## 业务边界

### 临床内容

旧题库、阈值、评分、随访任务和审核内容没有可靠的版本化 contract 时，页面只显示临床审核、授权、幂等、撤回和医护读取要求。任何自测、风险等级或问卷答案都不能被包装为诊断、分诊或入院结论。

### 外部入口

智能客服、我的问诊和消息订阅不恢复旧 WebView 或本地开关。真实开放前必须冻结 HTTPS allowlist、短期引用、受众、回跳、退出、撤销、模板回执和低敏审计规则。

### 预约 Provider

采血预约和挂号详情只保留患者范围入口。真实读取前必须确认预约引用、患者 owner、号源/状态枚举、敏感字段白名单、空/拒绝/超时语义；页面不会用列表索引、第一位患者或空数组冒充成功。

### 支付、医保和回写

本轮没有迁移支付副作用。门诊/住院支付、医保授权、6201/6202、查单、退款和 HIS 回写仍保持最后批次，继续进入状态页并遵守旧服务共存边界。

## 下一步

1. 释放微信开发者工具对 `apps/miniprogram/dist` 的占用后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`，再采集 40 页候选的真机来源和入口证据。
2. 对 A 批次已有只读页面做统一真实验收；不因新增外壳重新打开未经确认的 Provider。
3. 收到正式临床、外部或 Provider contract 后，逐域按 `contract → adapter → domain → API → 页面状态机 → 日志 → 真机` 深入，不共用万能接口。
4. 支付、医保、退款和 HIS 回写继续最后处理。
