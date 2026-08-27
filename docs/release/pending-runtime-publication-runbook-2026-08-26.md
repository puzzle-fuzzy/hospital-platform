> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `99d9f60f6291b7f8d08d779cec059892f054d80e`（`99d9f60`），共 40 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

# 小程序 pending 运行包安全发布手册（2026-08-26）

> 本手册只处理新小程序候选运行包从 `pending` 到开发者工具 `dist` 的安全切换。
> 它不会修改旧 Python 服务、旧数据库、旧 Redis、线上旧进程，也不会改变任何业务
> `FeatureKey` 的开放状态。

## 当前现场

| 项目 | 当前事实 |
| --- | --- |
| live 运行包来源 | `99d9f60f6291b7f8d08d779cec059892f054d80e`，40 个页面；`runtime:verify` 通过 |
| pending 候选来源 | 无；发布成功后 pending 目录已按发布器约定清理 |
| pending 目录 | 不存在；发布前静态校验已通过 |
| 发布结果 | 已原子切换到 live `dist`；没有手工覆盖或修改来源指纹 |
| 当前阻塞 | 运行包发布不再阻塞；九个真机证据域仍需从当前 live 重新编译、扫码并逐域采集 |
| 旧服务影响 | 无；旧 Python `8001` 和线上服务未修改 |

> 历史发布窗口的 live 与待发布候选曾均为 `0be59f96`；该窗口记录只用于追溯。当前 live 已是
> `6f47c64`，根目录文档提交不会改变运行包来源；新候选构建已按
> `build-info.json` 写入该完整来源指纹。当前来源、页面数量和静态校验结果以本机
> `apps/miniprogram/dist/build-info.json` 与 `runtime:verify` 输出为准，
> 不再使用旧 `de9c5b99`/`e1adbf7` 候选文档作为验收来源。

`runtime:publish-pending` 使用临时目录和原子替换：候选先复制到临时目录，替换失败时
保留原 `dist` 和完整 pending 候选。因此遇到 `EBUSY` 时不能删除 `dist`、不能手工复制
部分页面，也不能把 live 的 `build-info.json` 改成 pending 的来源指纹。

## live 与 pending 的校验区别

运行时校验有意区分两个来源，避免“当前源码还没发布”被误报成“旧 live 包损坏”：

- `runtime:verify:pending` 校验 `.local/hospital-miniprogram/pending/`，来源固定为当前待发布候选；
- `runtime:verify` 默认使用 `HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION` 或当前源码候选，只有原子发布完成后才应直接执行；
- 发布前若只想检查旧 live 的完整性，必须显式读取 live 自身的 `build-info.json` 来源，不得修改文件内容：

  ```powershell
  $liveBuildInfo = Get-Content apps/miniprogram/dist/build-info.json -Raw | ConvertFrom-Json
  $env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = $liveBuildInfo.sourceRevision
  try {
    pnpm --filter @hospital/miniprogram runtime:verify
  } finally {
    Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION -ErrorAction SilentlyContinue
  }
  ```

发布完成后，`runtime:verify` 默认应直接读取 live `build-info.json` 并与当前源码来源一致；
若再次出现来源不一致，应停止真机取证并保留 live/source 两份指纹，不得手工修改 `build-info.json`。

## 发布前检查

1. 在微信开发者工具中停止真机调试、预览和编译任务。
2. 关闭正在打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist\`
   的项目窗口；不要只关闭预览二维码，文件锁可能仍由开发者工具后台进程持有。
3. 不要强制结束微信或开发者工具进程，以免丢失用户尚未保存的调试现场；关闭后由
   只读进程检查确认锁已释放。
4. 确认 pending 候选仍通过静态校验：

   ```powershell
   pnpm --filter @hospital/miniprogram runtime:verify:pending
   ```

## 原子发布

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布成功后必须同时满足：

- `apps/miniprogram/dist/build-info.json.sourceRevision` 等于发布前 pending 候选的完整 SHA；
- `pageCount` 等于当前 `src/app.json` 页面数量；
- 运行包没有 `.test.js`、`.spec.js` 或 workspace 依赖引用；
- `project.config.json` 的 `miniprogramRoot` 仍为 `./`，开发者工具打开的是 `dist` 目录内容；
- 发布后 pending 目录被清理，后续 readiness 必须使用 live `build-info.json` 与当前运行输入指纹比对；
- 旧服务端 release、旧 Python `8001`、旧数据库和 Redis 没有因为小程序发布而改变。

## 发布失败时的处理

如果再次出现 `EBUSY`、缺文件或来源指纹不一致：

1. 停止操作，不手工覆盖 live `dist`；
2. 保留错误输出、live/pending 两份 `build-info.json` 和当前开发者工具现场；
3. 运行 `pnpm migration:readiness`；若 `publicationRequired=true` 或
   `candidateRuntimeAligned=false`，不得开始当前候选真机取证；
4. 业务迁移继续按队列推进：A 等候候选发布后取证，B 等审核 bundle，C/D/E 等正式
   contract，F 支付/医保/HIS 回写最后处理。

## 发布成功后的验收顺序

发布只证明运行包切换，不证明业务完成。当前应从已切换的 `99d9f60` live `dist`
重新生成二维码，再按以下顺序逐域采证：

```text
微信登录
  -> 患者目录与显式切换
  -> 预约目录/历史/爽约
  -> 报告目录/受限详情
  -> 门诊费用只读
  -> 普通资料
  -> 其它已具备正式 contract 的业务域
```

每个域都必须同时留下页面状态、客户端 `requestId`、Elysia/Pino 低敏事件以及适用时的
Provider request id。HTTP 200、空列表、页面可打开或 `runtime:verify` 通过，均不能单独
把业务状态标记为完成。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `99d9f60f6291b7f8d08d779cec059892f054d80e`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
