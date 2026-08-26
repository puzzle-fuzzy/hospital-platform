# “我的快递”宽度迁移记录（2026-08-26）

## 结论

本轮只迁移旧端已经真实存在的页面行为，没有新增物流能力：

- 旧页面：`hospital-app/src/pagesB/patient/express.vue`；
- 新页面：`apps/miniprogram/src/pages/patient-express/patient-express.*`；
- 旧端真实行为：展示患者选择栏，预留列表初始化为空数组，没有物流请求，展示“未查询到相关记录!”；
- 新端真实行为：读取当前平台已确认的就诊人，支持返回统一就诊人选择页；患者读取期间先展示固定高度加载壳，读取失败只展示错误和重试，不把故障或加载过程显示成物流空记录；患者读取成功后才展示本地空态插图和同等空态文案；
- 物流功能仍为 `surface-only`，不能把页面空态或患者目录请求解释成物流查询成功。

## 为什么没有直接接物流接口

旧端只有预留数据结构，没有可确认的物流来源、请求参数、患者归属、状态枚举、单号脱敏规则和失败语义。
因此本轮没有复用旧缓存、没有拼接 Provider 患者号、没有添加兼容转发，也没有制造“查询成功”的空响应。

页面保留“查看物流功能迁移说明”入口，后续正式材料到达后仍必须按以下顺序推进：

```text
物流来源与请求样例
  -> owner/就诊人映射
  -> 状态与字段白名单
  -> adapter 与低敏日志
  -> API 只读 contract
  -> 页面加载/空/拒绝/超时状态
  -> 内网、公网和真机证据
```

## 自动化证据

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：通过；
- `pnpm migration:audit`：64 个旧页面均有落点；
- `pnpm migration:boundary:audit`：34 个冻结入口 gate 通过；
- `pnpm migration:breadth:audit`：首页、“我的”、40 个原生页面事件和四个主 Tab 通过。
- `patient-express-state.test.ts`：加载、失败和物流未开放三种记录区域状态通过；加载和失败不会进入空记录状态。

本记录不产生线上部署、旧服务修改、数据库写入、Redis 清理或物流业务验收结论。
