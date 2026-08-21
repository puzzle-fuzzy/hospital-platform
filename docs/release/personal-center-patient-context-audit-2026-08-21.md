# 个人中心与患者上下文逻辑审计（2026-08-21）

> 审计对象：服务端 release `5a31427`、当前小程序运行包来源 `b629380162aa8275418b643e10a16e96a65d0b36`（候选 `b629380`）。本记录只覆盖代码、测试和本地运行包证据；不把静态检查替代为微信真机业务验收。

## 结论

本轮没有发现需要放宽边界或修改业务语义的缺口。个人中心中的“普通个人资料”和“家庭就诊人”是两类不同事实：

- 普通资料只允许当前 Bearer 会话的 owner 读取和更新，使用服务端 `version` 做乐观并发控制；
- 家庭就诊人只从 owner-scoped 患者目录解析，页面只允许 `clinicalAccess=ready` 的患者进入预约历史、爽约记录、报告和门诊费用等患者范围读取；
- 首页、我的页面和患者选择页不会把微信当前用户资料自动当作临床就诊人，也不会在目录异常时静默切换到第一位患者；
- 预约写入、支付、医保、退款、HIS 写回和患者新增/绑定仍未因本次审计而开放。

## 状态边界

### “我的”页面组合读取

`apps/miniprogram/src/pages/my/my.ts` 使用以下固定顺序：

```text
/me owner 证明
  → 普通资料 GET（头像区增强，可降级）
  → owner-scoped 患者目录 GET（患者业务关键事实）
  → 解析本地显式患者选择并提交页面快照
```

这里不能改成 `Promise.all`：普通资料 GET 可能在过期 GET 会话下触发安全恢复，患者目录必须在恢复后的同一会话代际中读取，否则会把旧账号患者目录和新账号资料拼成混合快照。

每次页面读取同时受两层守卫约束：

1. 页面实例请求守卫：新的 `onShow`、下拉刷新或页面卸载后，旧 Promise 不能再 `setData`；
2. 会话代际守卫：`/me`、资料和患者目录之间若发生账号/会话变化，整轮组合失败并清理派生展示，不自动拼接或重放旧快照。

### 普通个人资料

`apps/api/src/modules/profile/service.ts` 和 `apps/miniprogram/src/pages/profile/profile.ts` 共同保证：

- owner 从服务端会话取得，客户端不能提交 `userId` 选择其他账号；
- 公共资料只包含 `displayName`、`gender`、`age`、`email` 和 `version`，不会返回 openid、unionId、手机号、身份证、真实姓名或头像字段；
- PUT 前检查页面快照所属的会话代际，防止账号切换后把旧页面编辑值提交给新账号；
- 409 版本冲突后进入未加载态，必须重新 GET 服务端 canonical 快照后才能再次保存；
- 保存成功完整采用服务端返回的 canonical 快照，不把本地输入值当作最终事实；
- 明确认证失效时清理旧资料并回到登录入口，普通 5xx/网络错误保留可重试语义，不伪造保存成功。

### 家庭就诊人与患者范围页面

`apps/miniprogram/src/services/patient-selection-service.ts` 与 `patient-navigation.ts` 的约束如下：

- 本地只保存 opaque 的内部 `patientId`，不保存 provider 患者号、卡号、身份证或 unionId；
- 已保存患者不在最新 owner 目录中时标记为 stale，不自动改选其他患者；
- 患者临床映射不可用时标记为 unavailable，不允许进入临床只读查询；
- 没有本地选择时，只能从当前目录默认第一位 `clinicalAccess=ready` 患者；
- “我的挂号”、爽约记录和门诊费用等入口，必须同时满足已验证会话和已解析患者；
- “更换就诊人”始终进入独立患者选择页，不把当前平台用户资料当作家庭就诊人。

页面异步请求还会检查当前选择是否仍然匹配返回结果；患者切换、目录刷新或会话失效后，旧业务结果不能覆盖新页面上下文。

## 日志边界

服务端普通资料事件至少包含：

- `user.profile.requested`
- `user.profile.loaded`
- `user.profile.updated`
- `user.profile.conflict`
- `user.profile.read_failed`
- `user.profile.update_failed`

患者目录事件至少包含：

- `patient.directory.read.requested/loaded/failed`
- `patient.directory.requested`
- `patient.directory.operation.started/replayed/in_progress/lease_taken_over`
- `patient.directory.snapshot.committed/stale`
- `patient.directory.synced/failed`

日志只保留 `traceId`、有界请求关联号、状态计数、版本和错误类型等低敏字段。患者姓名、身份证、手机号、卡号、unionId、provider 原始 URL、请求体和响应体不能进入日志；成功事件也必须发生在对应的 canonical 读模型通过运行时校验之后。

## 当前证据与未完成项

已验证：

- 小程序构建排除 `src/**/*.test.ts`，`dist/` 不含 `*.test.js` 或 `*.spec.js`；
- `project.config.json` 的 `miniprogramRoot` 为 `dist/`；
- 当前运行包来源、页面数量和根文件通过 `runtime:verify`；
- `release:baseline:audit`、相关 TypeScript、单元测试和完整仓库门禁通过；
- 开发者工具当前未再出现 `dist/services/single-flight.test.js` 的 ENOENT。

仍未完成：

- 当前候选的微信真机三层证据：页面截图、客户端 HTTP 关联、服务端低敏业务事件；
- 普通资料真实 PUT、首次写入和 409 冲突的公网/真机证据；
- 多就诊人显式切换、失效/恢复和切换后业务读取的真机证据；
- 预约写入、微信支付、医保、退款、HIS 写回以及患者新增/绑定的正式 contract 与验收。

因此本轮只固化审计结论，没有修改旧 Python 项目、线上配置、MySQL、Redis，也没有打开任何支付或医保 gate。

## 验证命令

```text
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
pnpm release:baseline:audit
pnpm check
```
