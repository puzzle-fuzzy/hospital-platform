/**
 * 迁移中的页面只给用户展示结果和下一步，不展示 Provider、contract、
 * 数据库、域名或内部上线批次。内部准入信息仍保留在迁移目录和日志中，
 * 这样既方便维护，也不会让普通用户误以为自己需要理解系统实现。
 */
export const USER_FACING_SURFACE_COPY = Object.freeze({
	surfaceLabel: "功能正在完善",
	description: "这项服务正在完善中，暂时无法使用，请稍后再试。",
	scopeTitle: "服务说明",
	scopeDescription: "当前服务暂未开放，开放后会及时更新。",
	boundaryItems: Object.freeze([
		"当前仅保留页面入口和就诊人切换",
		"不会展示未经确认的信息",
	]),
	contractItems: Object.freeze([
		"服务内容准备完成",
		"数据安全检查通过",
		"上线前测试完成",
	]),
	coverageLabel: "当前状态：功能完善中",
});

/** 仅展示给用户的统一重试提示，避免不同页面各写一套口吻。 */
export const USER_FACING_RETRY_HINT = "请稍后再试";
