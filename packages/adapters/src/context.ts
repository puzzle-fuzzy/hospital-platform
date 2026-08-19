import type { AdapterCallContext } from "@hospital/domain";

/**
 * Provider 名称是日志、错误契约和配置诊断的有限集合。
 * 新增适配器时必须同步补齐配置门禁和日志白名单，不能在业务请求中接受任意字符串。
 */
export type AdapterName =
	| "zhongyang"
	| "hospital-his"
	| "medical-insurance"
	| "legacy-fsi"
	| "wechat-identity"
	| "wechat-pay"
	| "yunhealth"
	| "ai";

/**
 * 适配器调用上下文只携带服务端生成的关联信息，不把患者号、卡号或身份凭证
 * 作为通用上下文向下游扩散；具体业务输入仍由各领域 gateway 自己约束。
 */
export type AdapterContext = AdapterCallContext;
