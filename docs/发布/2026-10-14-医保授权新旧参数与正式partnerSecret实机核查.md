# 医保授权新旧参数与正式 partnerSecret 实机核查

核查时间：2026-10-14 16:57–17:01（Asia/Shanghai）。
当前上传包：`2026.10.14.5`，来源 `95d0682db5669b52dd3b5437ce62f6bd9cdd487b`。
本文只记录读取、比对及本地验证结果；未修改线上配置或触发真实授权、支付、退款。

## 结论

线上 API、Worker 的运行进程环境均使用此前提供并按正式登记的 `MBS_USER_QUERY_PARTNER_SECRET`，
与旧系统测试密钥不同，合作方 ID 也匹配此前登记的参考摘要。没有发现使用旧测试 partnerSecret 的证据。

本次流程停在腾讯授权小程序内的机构渠道认证阶段，尚未进入本系统使用 partnerSecret 的 userQuery 阶段。
客户端当前认证编码、机构应用 ID 与最新正式反馈材料一致。尚无腾讯该次请求的原始返回码、接收参数及正式登记记录，
因此仍不能把正式地址映射、机构启用状态或应用关联中的某一项认定为已证实根因。

## 线上实际环境

通过已核验主机密钥的 SSH 只读连接，读取 systemd 的 MainPID、EnvironmentFiles、实际 `/proc/<pid>/environ`，
并在服务器内计算摘要后比对；未输出或下载密钥原文。

| 核对项 | API | Worker |
| --- | --- | --- |
| 服务状态 | active，PID 3517829，重启数 0 | active，PID 431702，重启数 0 |
| 专用 partnerSecret 长度 | 32 | 32 |
| SHA-256 前 12 位 | `067c5350783c` | `067c5350783c` |
| 匹配此前正式密钥摘要 | 是 | 是 |
| 匹配旧测试密钥摘要 | 否 | 否 |
| 与 FSI 的 MBS_APP_SECRET 不同 | 是 | 是 |
| userQuery 合作方 ID 匹配参考摘要 | 是 | 是 |
| userQuery 地址为正式腾讯 receiver | 是 | 是 |
| 微信医保支付测试标志为 false | 是 | 是 |

正式参考为本机忽略文件 `partner-secret-audit-digests-20261013.json`。
2026-10-13 的 API、Worker 环境快照均匹配该参考。
另在内存中比对旧 `G:/fuck/hospital/insurance-service/.env` 的 `PARTNER_SECRET`，
其 SHA-256 前 12 位为 `69e2c54bff92`，匹配测试参考，与当前线上不同。

证明边界：正式摘要没有附腾讯原始签发凭据，省中台的四份反馈单也没有 partnerSecret 字段。
所以这里确认的是“线上加载了此前提供并登记为正式的密钥”，不能替代腾讯对该密钥后台环境归属及启用状态的确认。

API 当前 release 指向上述 `95d0682d`；服务器实际 bundle SHA-256 与最近部署记录一致：
`c3517607eb58ec903af72e7b2264d4dc7905126a493e0bc0c9791a7859b6f7d0`。
该 bundle 包含专用密钥配置及 `god-portal-signature` 签名实现。

## 旧项目与当前上传包

旧项目范围为 `G:/fuck/hospital/hospital-app`；当前检查直接读取实际上传目录
`.local/appointment-avatar-preview/release-miniprogram-project/dist`，没有用开发目录代替上传包。

| 参数 | 旧项目实际调用和已构建代码 | 当前 2026.10.14.5 | 结论 |
| --- | --- | --- | --- |
| envVersion | trial | release | 已由测试授权目标切到正式授权目标 |
| orgAppId | 旧测试支付应用 ID，摘要 `4218f1963fcd` | 正式支付反馈单应用 ID，摘要 `192324f38f87` | 不同，当前匹配正式支付材料 |
| orgChnlCrtfCodg | 64 字符，摘要 `b799f7db8996` | 逐字相同 | 不是新项目更换或截断了认证码 |
| orgCodg | 旧机构码 | 逐字相同 | 一致 |
| cityCode、channel、sourceapp、bizType | 旧配置 | 逐字相同 | 一致 |
| 目标授权小程序、页面、openType | 旧配置 | 逐字相同 | 一致 |
| 认证编码传法 | 原样拼接 | 原样拼接 | 未引入额外 encode |

旧源码 `src/api/modules/medical-insurance.ts:655` 的日志对象写了 release，
但实际 `navigateToMiniProgram` 在 665 行使用 trial；旧 `dist/build/mp-weixin` 产物也确认为 trial。
因此不能根据旧项目的日志对象或 `.env.production` 文件名推断它实际走正式授权。

当前认证码没有空白、`&`、`#`、`+`、`%`、`=`，包含一个 `/`，未发现本地拼接中的分隔符破坏。
本人挂号、门诊使用相同跳转参数；亲情授权仅额外携带运行时 familyid；没有 extraData 或 partnerSecret。

最新正式身份核验单明确列出微信渠道及 `04107 医保移动支付业务`、`04106 线上身份核验业务`，
并提供机构渠道认证编码。正式移动支付反馈单提供应用 ID、数字密钥和 SM2 材料，没有机构渠道认证编码字段。
当前从这两份材料分别提取认证码和应用 ID，与实际字段相符，但材料本身不能证明正式后台已经建立关联。

当前材料为最新正式 PDF（反馈日期 2026-10-13）。较早复核文档中身份单日期为 2024-06-11、认证码含两个斜杠，
属于旧材料调查快照，不适用于本次实际上传包。两份最新反馈单的同意/不同意框均未勾选，
这只能说明单据没有明确勾选审批结论，不能据此断言未开通。

## partnerSecret 的调用时机与本次日志

代码链已用 CodeGraph 数据库导航后读取源码确认：

1. 小程序取得本系统的 authorization-context，仅判断本人/亲属关系及授权上下文。
2. 小程序调用 `wx.navigateToMiniProgram`，把机构认证参数交给腾讯授权小程序。
3. 授权成功并返回 authCode 后，小程序才向本系统提交 authorize。
4. 服务端 `resolveAuthorization` 才用专用 partnerSecret 对 userQuery 生成 HMAC。

`packages/config/src/index.ts:1251` 从 `MBS_USER_QUERY_PARTNER_SECRET` 读取；
`packages/adapters/src/legacy-fsi-medical-insurance.ts:2820` 生成签名并调用 userQuery。
`MBS_APP_SECRET` 独立用于省中台 FSI SDK 封解包，没有用作 userQuery 密钥的回退。

读取 API 自 2026-10-14 15:50 起的日志，在 17:00 左右核查时看到：

- 15:55:38.843（CST）挂号 authorization-context 返回 HTTP 200。
- 没有收到挂号或门诊 authorize 请求。
- 没有 `medical-insurance.authorization.user-query` Provider 派发记录。
- 医院服务器日志未记录用户看到的认证编码错误；该错误发生在外部授权小程序内部。

这把故障定位到“上下文取得成功之后、授权码返回之前”，与用户描述一致。
尚未走到查询签名，不能把这次报错归因于服务端 partnerSecret 的 HMAC 计算。
专用密钥仍参与服务启动配置完整性检查，因此并不意味着它可以删除或忽略。

## 本地验证及后续所需证据

运行既有签名与正式授权材料两组测试：31 pass、0 fail、98 assertions；使用 `bun --no-env-file test`，
没有调用真实授权查询接口或提交业务交易。此次未新增业务代码、改密钥、重启或上传新包。

要进一步确认具体原因，需要腾讯/省中台提供本次失败请求的以下证据：

1. 原始返回码、Request-ID/追踪标识和失败时间，说明错误由腾讯预校验还是省中台/国家局返回。
2. 腾讯实际接收到的机构认证参数与此前交付的完整 JSON 是否逐字一致，特别是机构应用 ID、认证码及内部转义情况。
3. release 目标实际使用的正式授权地址和参数映射，以及正式机构码、微信渠道、04107、认证码与新正式应用 ID 的有效关联。

这些信息不在医院服务器日志或本地反馈单中。已向所有者请求该次返回码/追踪标识及切正式确认，未向任何外部人员发消息。
取得证据前，不把“尚未确认配置”写成“已经证明未配置”，也不回退到旧 trial 或测试密钥。

## 官方依据

- [用户授权接入文档，第 2.2.4 节](https://docs.qq.com/doc/DV3JYRG1xelhKTWdz)：本次通过浏览器直接查看参数表，机构应用 ID 来源于医保移动支付/处方流转反馈单。
- [APIv3/普通商户/支付产品/医保支付/常见问题/报错排查指引](https://pay.weixin.qq.com/doc/v3/merchant/4020401138)：知识库原链接；[当前可读取的官方页面](https://pay.wechatpay.cn/doc/v3/merchant/4020401138)明确小程序机构认证码不需要 encode，并要求排查不同环境的页面及机构配置。
- [APIv3/普通商户/支付产品/医保支付/附录/测试及环境切换](https://pay.weixin.qq.com/doc/v3/merchant/4021773498)：知识库原链接；[当前可读取的官方页面](https://pay.wechatpay.cn/doc/v3/merchant/4021773498)第 6 节要求正式查询密钥、腾讯正式地址配置和省中台正式医院登记分别完成。
