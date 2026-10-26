# LIS 详情数组兼容

LIS 的 `/msun-middle-business-lis/v1/lis-reports/details` 可能返回完整报告对象，也可能返回检测项数组。此前数组在对象解析阶段被拒绝，导致报告详情返回 `10820`。

数组形态只提供本次检测项。服务端使用原查询窗口、当前用户绑定的 HIS 患者号和准确报告号重新读取 LIS 目录，补齐标题、报告时间和附件。检测结果采用本次详情返回值，不能用检测项的 `resultTime` 替代目录的 `reportTime`。

新 LIS 短期引用使用已有 `start_date/end_date` 列保存原查询窗口，不新增表或列。历史无日期引用仍支持完整对象详情；如上游返回数组，需重新打开报告列表生成包含日期的引用。

详情与附件共用患者绑定和查询窗口。数组中出现其他报告号、患者冲突，或目录存在重复、缺失、窗口外报告时停止返回；成功包络、字段长度、附件来源与数量限制保持原有校验。公共 API 仍只提供白名单投影和附件代理引用，不下发原始患者号或 Provider URL。

## 验证

```powershell
bun test packages/domain/src/reports.test.ts packages/adapters/src/zhongyang-reports.test.ts packages/persistence/src/mysql-repositories.test.ts apps/api/src/modules/reports/service.test.ts
```

这四组测试覆盖旧对象、新数组、不同报告与患者、报告时间与检测时间不同、附件、原查询窗口持久化和短期引用隔离。上线前还需分别验证当前线上运行包的其他修改未被覆盖、API 健康检查，以及真实只读报告请求；本地测试通过本身不代表已经上线。
