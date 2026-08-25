# 健康百科客户端运行时 contract 验收（2026-08-25）

> 历史代码提交：`296516a5`。本记录只覆盖小程序收到 JSON 后的客户端边界，不代表健康内容已经发布、临床审核已经完成，也不代表线上运行包已经替换；当前候选源码为 `1404a03`，需要按当前 pending 运行包重新取证。

## 结论

健康百科的目录、症状列表、疾病列表、疾病详情和药品详情现在都不再只依赖 TypeScript 泛型。客户端会在页面读取前重新校验响应，并只投影患者端允许公开的字段；不符合 contract 的整批响应统一以 `provider-response-invalid` 失败。

## 已覆盖的边界

- 成功外壳必须是 `success: true`，`data.items` 必须是数组，`total` 必须是非负安全整数且等于完整列表长度；
- 目录项、症状项和疾病摘要必须有安全的 `id`、名称和首字母，列表 ID 不得重复；
- 发布元数据必须保留内容版本、审核时间、来源和免责声明；
- 疾病/药品正文只允许审核读模型的白名单字段，正文允许换行但拒绝制表符、NUL 和其它控制字符；
- 可点击药品必须带有 opaque `drugId`，药品名称在同一疾病详情中不得重复；
- provider、内部备注、患者身份等未公开字段不会进入页面模型；
- 目录、详情和药品请求仍只通过版本化 Hospital API，不向小程序暴露 provider URL 或内部身份字段。

## 自动化证据

```text
pnpm --filter @hospital/miniprogram typecheck   通过
pnpm --filter @hospital/miniprogram test        264 pass / 0 fail / 2535 expect()
pnpm format:check                               通过
git diff --check                                通过
```

测试覆盖有效字段白名单、列表重复 ID、总数不一致、详情药品引用缺失、危险正文和药品详情字段投影。

## 未覆盖与停止条件

以下内容仍不能由客户端校验结果推导为已完成：

1. 正式审核 bundle 的导入、staging、发布和撤回；
2. 真实内容版本的临床审核、免责声明和下线审计；
3. 真机页面、客户端 requestId、Elysia/Pino 日志和内容仓储事件的三层配对；
4. 自测、BMI/血压计算、问诊、病历、处方、支付或医保能力。

在正式 bundle 和真实验收材料到达前，服务端 route gate 及页面 fail-closed 行为保持不变。本次未修改旧 Python 项目、旧服务、数据库、Redis 或另一会话负责的众阳适配器。
