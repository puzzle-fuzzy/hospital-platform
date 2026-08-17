# 原生小程序个人中心视觉运行包核验（2026-08-17）

> 本文记录本地构建产物、微信开发者工具运行包和目标页面的视觉核验；不把开发者工具模拟器证据扩大解释为真机、公网 API 或 Provider 业务验收。

## 1. 核验范围

| 项目 | 结果 |
| --- | --- |
| 视觉代码提交 | `f562d61`（`对齐我的挂号原版视觉`） |
| 文档核验提交 | `8dc53dd`（`补充个人中心迁移台账`） |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` |
| 构建结果 | TypeScript 检查通过；`app.json` 注册页面 14 个，运行脚本全部生成 |
| 开发者工具/真机 | 2026-08-17 已在微信开发者工具重新打开 `apps/miniprogram` 项目并加载当前运行包；真机、公网 API 和 Provider 业务仍未由本文宣称完成 |

## 2. 视觉资源与页面产物

以下文件均从本次 `dist` 目录读取并计算 SHA-256；哈希用于确认开发者工具导入的是同一份产物，不能替代屏幕截图或真机交互证据。

| 相对路径 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `pages/my/my.js` | 9419 | `ca74d3cbf3341572201778f559141e3074fd0088bc9072b507c1b2a3dc9fd8ea` |
| `pages/my/my.wxml` | 2544 | `e7bb174c18df5c0c9b7acde681198fc9c3cdeffff6a9845d7469738137114297` |
| `pages/my/my.wxss` | 2952 | `eb0d11bbe94bd093aac7e108c3f6ddd876afb1cd286a9f3e042b3819033a8d12` |
| `pages/appointment-records/appointment-records.js` | 9661 | `2b556cdd35791a3cb1c9f16c4aefc57a47050b313d2c1725cc5a698a9649fd67` |
| `pages/appointment-records/appointment-records.wxml` | 5168 | `c7736a0a93e5c4ab4d66d15714fcc0ae100838975caf1dd6ca9fcd48758e6900` |
| `pages/appointment-records/appointment-records.wxss` | 6671 | `7365a6641d1cfe0995d4eaa244a371248da563a9008f211595b2fe4f462b3944` |
| `assets/legacy-user/legacy-user-background.png` | 23457 | `1e067a8965b720a1eb60416344b8203da9da9cc9810b3785888d4e0112e152b4` |
| `assets/legacy-user/appointment-status.svg` | 6440 | `83e45a46c186ff54a30b29f33a8217f1a60cf949c0870a2f4456de08dc473f9e` |
| `assets/legacy-home/tab-04-active.png` | 1583 | `fe5dbbfc75dd975c2fffb385b068a06d876490b8c00d79ac0f1f2c41f49af2ee` |
| `data/department-location.js` | 9350 | `c51cff9e035d4827416ec548126aa1b3fb75ee9f143da5011fa71a78423c9389` |

## 3. 导入后的验收边界

1. 开发者工具必须导入包含 `project.config.json` 的 `apps/miniprogram/dist/`，不能继续运行旧 `src` 或旧 `dist`。
2. “我的”页核对背景、头像占位、家庭成员入口、三组功能分类、图标顺序和固定底部导航；点击家庭成员必须进入独立患者选择页。
3. “我的挂号”核对全宽就诊人/院区信息区、在线/全部标签、列表灰色背景、预约状态图标、卡片间距和院内导航弹窗；更换就诊人后不能沿用上一位患者的记录。
4. 真机产生的 request id、服务端事件和页面结果仍必须按 [`P0 只读业务验收手册`](p0-readonly-business-acceptance-runbook-2026-08-17.md) 记录；本文件不允许用静态包哈希替代业务证据。

预约写入、详情、预问诊、取消、退号、微信支付、医保授权、退款和 HIS 回写继续保持关闭。

## 4. 微信开发者工具真实运行包复核（2026-08-17 18:39-18:40 CST）

本次先发现并修复了一个会阻断“我的挂号”页面加载的运行包问题：预约历史页面原先直接
`import` JSON，开发者工具运行时会把它解释为 `data/department-location.json.js`，最终报模块未定义。
现在科室位置资料改为 TypeScript 运行时模块，构建脚本和 `runtime:verify` 同时要求
`dist/data/department-location.js` 存在；没有这个文件时构建不通过，不能把问题推迟到页面点击后。

重新构建并重新打开开发者工具项目后，当前页面结果如下：

| 页面 | 真实运行结果 |
| --- | --- |
| `pages/my/my` | 旧端顶部背景、头像占位、家庭成员管理卡片、三组功能分类、原版图标顺序和固定底部导航均显示；工具调试器 `Errors: 0` |
| `pages/appointment-records/appointment-records` | 就诊人/当前院区两行信息、在线挂号/全部挂号标签、空记录状态和底部说明均显示；工具调试器 `Errors: 0` |
| `pages/patient-select/patient-select` | 从我的挂号顶部患者信息进入选择页成功；患者卡片显示脱敏电子就诊卡，工具调试器 `Errors: 0` |

“其他”是前端对服务端未提供明确关系标签时的展示兜底，不是 Provider 原始字段；卡号脱敏由平台返回的展示字段承担，当前格式保留前五位和后四位（例如 `00100******7027`）。

本次仍未宣称微信支付、医保授权、预约写入、真机网络和 Provider 业务完成；这些继续按只读业务证据和最后的副作用验收顺序处理。
