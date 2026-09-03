# 小程序“我的挂号”只读响应边界（2026-08-19）

## 结论

本次只收紧新小程序“我的挂号”读取边界，不修改预约 Provider、Elysia API、MySQL、Redis、旧 Python 服务，
也没有打开全部挂号、详情、取消、预问诊、预约写入或挂号费支付。

小程序收到预约历史成功响应后，现在会拒绝以下异常：

- 状态不属于服务端约定的 `scheduled/cancelled/completed/missed/stopped/substituted/registered/unknown`；
- 工作日期不是基本的 `YYYY-MM-DD` 形状；
- 科室、医生、时段、地点或流水展示字段不是有界字符串；
- 列表 `total` 与完整 `items` 数量不一致。

任何坏记录都会整批 `provider-response-invalid`，不筛掉坏行后伪装成完整历史，不让状态文案出现空值。
服务端仍负责真实日期有效性、owner 映射、Provider 状态归一化和渠道权限；客户端校验不是业务授权替代。

## 未开放边界

当前“在线挂号”继续只消费已冻结的只读渠道；“全部挂号”仍等待独立 `requestChannel=4` contract。预约详情、
取消、预问诊、预约写入和支付必须分别取得引用、幂等、权限、终态及三层验收证据后再实现。
