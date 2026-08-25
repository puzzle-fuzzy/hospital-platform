# 小程序候选 `cb23124b`：患者域页面外壳（2026-08-26）

## 结论

本候选完成了旧端患者域三条入口的广度迁移，并修正了旧台账把“我的快递”误归为“就诊人联系地址”的业务分类错误：

- `pagesB/patient/patientAdd.vue` → `pages/patient-binding/patient-binding`
- `pagesB/patient/patient_signature.vue` → `pages/patient-signature/patient-signature`
- `pagesB/patient/express.vue` → `pages/patient-express/patient-express`

三个页面均是 `surface-only`：有真实页面、正确标题、必要的患者选择/返回路径、迁移边界和关闭态，但不提交实名资料、不上传签名、不调用未知物流接口，也不复用旧端假患者或硬编码外部小程序。

## 来源与运行包

| 项目 | 当前事实 |
| --- | --- |
| 功能代码提交 | `cb23124b`（补齐患者域页面外壳与迁移边界） |
| pending 运行包来源 | `cb23124b4319666ab0841d23c3f4106704810328` |
| pending 运行包路径 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 28 |
| 线上服务 | 未发布、未修改旧 Python 服务 |
| live `dist` | 仍被微信开发者工具占用，未被本候选替换 |

构建执行了 TypeScript 类型检查、页面文件/事件/导航静态检查和 staging 生成。原子替换 `dist` 时因微信开发者工具占用返回 `EBUSY`，构建脚本保留了完整 pending 候选；通过以下命令验证候选完整性：

```powershell
pnpm --filter @hospital/miniprogram runtime:verify:pending
```

输出：`revision=cb23124; 28 pages and required root files are present`。

## 代码回归与结构门禁

| 检查 | 结果 |
| --- | --- |
| `pnpm format:check` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 9/9 workspace 包通过 |
| 小程序测试 | `293 pass / 0 fail / 3305 expect()` |
| `pnpm migration:audit` | 64 个旧页面、28 个新页面、195 个旧服务端路由、87 个旧端接口字面量均有登记 |
| `pnpm migration:boundary:audit` | 34 个冻结入口 gate 通过 |
| `pnpm migration:breadth:audit` | 28 个页面交互、首页/我的 action、四个主 Tab 通过 |

## 业务边界

### 添加就诊人

旧页面存在“查档失败后继续建档”的危险行为。新页面只展示实名绑定所需的同意、查档、建档、绑卡、幂等、撤回和最终确认边界；正式 contract 到达前不显示可提交表单，不接受仅凭姓名绑定，不让客户端提交 Provider 患者号。

### 患者签名

旧页面包含硬编码的假患者列表和固定外部小程序 AppID。新页面不读取假数据、不拼接外部跳转，仅保留用途、文件安全、授权、撤回和医护侧审计说明，并通过当前患者选择页表达患者范围。

### 我的快递

旧页面标题和行为是“我的快递”，实际只有预留空列表和 TODO 查询，不是联系地址。新台账使用独立 `patient-express` FeatureKey 和 `provider-read-only` contract，后续需要先确认物流来源、患者归属、状态枚举、字段脱敏和失败语义。

## 下一步

1. 继续按 A–E 批次补齐尚未有页面外壳的入口，优先处理低风险只读/静态页面，支付、医保、退款、HIS 回写最后处理。
2. 释放微信开发者工具对 `apps/miniprogram/dist` 的占用后执行 `pnpm --filter @hospital/miniprogram runtime:publish-pending`，再重新采集真机来源指纹；本候选静态通过不等于真机验收通过。
3. 患者绑定、签名和快递页面在正式材料到达后，分别补齐 contract、adapter、API、日志和 owner/患者越权测试，不共用万能接口。
