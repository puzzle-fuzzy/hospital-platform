/**
 * 协议页只展示旧端已存在的静态条款文本。
 *
 * 旧端没有可靠的协议版本、用户同意记录、撤回和审计接口，
 * 因此本页不记录同意状态，也不新增“同意即生效”的伪状态，
 * 更不把阅读行为当作授权。
 * 后续接入患者绑定或授权流程时，必须先补齐服务端契约再扩展页面动作。
 */
type PatientAgreementPageMethods = Record<never, never>;

Page<Record<string, never>, PatientAgreementPageMethods>({
	data: {},
});
