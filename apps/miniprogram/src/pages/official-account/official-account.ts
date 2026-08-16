type OfficialAccountPageMethods = Record<never, never>;

/**
 * 旧端公众号页只有宣传说明，没有真实二维码、关注状态或微信授权接口。
 * 页面因此只维护静态展示，不把用户打开页面解释成“已经关注公众号”。
 */
Page<Record<string, never>, OfficialAccountPageMethods>({
	data: {},
});
