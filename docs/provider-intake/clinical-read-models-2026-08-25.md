# 临床只读域并行准入清单（2026-08-25）

本文把门诊病历、住院、医生关系和问诊四个未完成域拆开管理，目的不是增加状态页，
而是让任意一个域拿到真实材料后可以独立进入 contract、adapter、API 和小程序验收。
四个域不能共用 `patId`、通用 `convenience` 响应或万能 WebView。

## 当前总览

| 域 | 旧端事实 | 新端状态 | 第一项必须取得的材料 |
| --- | --- | --- | --- |
| 门诊就诊记录目录 | `POST /msun-middle-aggregate-clinic/v1/out-visit-records`；旧页面只展示摘要 | 未注册 | provider 当前请求/响应/空/拒绝/超时样例和 `patId` 映射确认 |
| 门诊病历正文 | `GET /msun-middle-aggregate-clinic/v1/out-emrs`；旧页面没有实际调用证据 | 未注册 | 目录记录到正文的授权关系、短期引用、正文脱敏和审计说明 |
| 住院信息/住院日费用 | `GET /msun-middle-aggregate-hsz/v1/patients`；费用使用独立 settlepay 接口 | 未注册 | episode 权威来源、住院患者映射、金额单位和账单状态样例 |
| 住院病历 | `mr-menus`、`mr-contents`、`mr-content-structs` | 未注册 | 文档类型、内容格式、脱敏规则、资源授权和历史撤回语义 |
| 我的医生 | 旧库 `my_doctor` 为 21 条快照关系 | 未注册 | 受控医生目录、医生引用映射、在职/失效和展示白名单 |
| 我的问诊/陪诊 | 旧端有历史查询和外部入口混用 | 未注册 | 会话索引、owner/患者归属、外部主体、保留周期和回跳协议 |

## 统一硬边界

1. 小程序只能传平台内部 `patientId`、`doctorRef` 或短期资源引用；不得传入或缓存
   `patId`、`regId`、`out-visit-record-id`、`patInHosId`、住院号、医生内部 ID。
2. provider 返回的 HTTP 200 不等于业务成功。必须区分成功空列表、映射缺失、权限拒绝、
   未配置、超时/限流和业务 envelope 失败。
3. 目录、正文、住院 episode、费用和问诊会话是不同 read model；不能因为都展示在“我的”
   页面而复用报告或门诊费用模型。
4. 诊断、身份证、卡号、联系方式、原始 provider 记录号、正文 XML/JSON 和文件 URL 默认
   不进入公共 response、Pino 或小程序 storage。
5. 没有字段白名单和脱敏 golden fixture 时，域保持未注册；不使用旧响应类型、旧缓存或
   本地 mock 作为生产迁移证据。

## 单域放行顺序

```text
provider 文档登记与指纹
  -> 请求/响应/错误/权限/脱敏差异表
  -> contracts schema 与 domain 不变量
  -> adapter 四类 fixture
  -> owner-scoped service
  -> 必要时 persistence 与 TTL/复合约束
  -> API + Pino 低敏事件
  -> 原生页面竞态、分页、切换患者和稳定空态
  -> 内网、公网、真机和 Provider 同链证据
```

## 当前可直接执行的并行工作

- 文档到达前：维护字段差异表、错误分类、禁止字段清单和页面状态机；不注册真实业务路由。
- 门诊记录先于病历正文：先完成目录读模型，正文只能使用目录产生的 owner-scoped 短期引用。
- 住院信息先于住院费用：先确认 episode 和权限，再定义费用金额/时间/结算边界；不复用门诊费用。
- 医生关系先于“我的医生”页面：先有当前医生目录，旧表只能作为待映射历史来源，不能直接展示快照。
- 问诊先确认外部主体：没有 audience、allowlist、短期 session、回跳和退出语义时，不恢复旧 WebView。

## 完成证据

某个域只有同时具备 provider 文档、脱敏样例、owner 越权测试、错误/空态测试、日志链、
公网路径和真机切换患者证据，才可以从状态页切换为业务页面。其余域保持关闭，不影响旧服务
继续运行，也不需要修改旧项目。
