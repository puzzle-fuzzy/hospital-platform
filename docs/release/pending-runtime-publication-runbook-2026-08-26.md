# 小程序 pending 运行包安全发布手册（2026-08-26）

> 本手册只处理新小程序候选运行包从 `pending` 到开发者工具 `dist` 的安全切换。
> 它不会修改旧 Python 服务、旧数据库、旧 Redis、线上旧进程，也不会改变任何业务
> `FeatureKey` 的开放状态。

## 当前现场

| 项目 | 当前事实 |
| --- | --- |
| live 运行包来源 | `02dbf10419740d96c4445493df019021ac22bcfa`，40 个页面；旧候选仍通过 `runtime:verify` |
| pending 候选来源 | `0be59f966de2c3a0861cb44e9a526a1ef557f6c7`（`0be59f96`），40 个页面；已通过 `runtime:verify:pending` |
| pending 目录 | 当前保留；原子发布因微信开发者工具锁定 `dist` 返回 `EBUSY` |
| 发布结果 | 尚未切换；旧 live `dist` 完整保留，不能手工覆盖或只替换来源指纹 |
| 当前阻塞 | 先关闭占用 `dist` 的开发者工具/真机调试，再原子发布新候选；发布后才能开始九个真机证据域 |
| 旧服务影响 | 无；旧 Python `8001` 和线上服务未修改 |

> 当前 live 仍是 `02dbf10`，待发布候选是 `0be59f96`。根目录文档提交不会改变运行包来源；
> 新候选构建已按
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

如果不显式设置 live 来源，看到 `dist=旧 live`、`expected=当前 pending` 的 mismatch
是发布尚未发生的事实，不是把 `build-info.json` 手工改成 pending 的理由。

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

发布只证明运行包切换，不证明业务完成。当前仍需先将 `0be59f96` 原子切换到 live；切换后
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
