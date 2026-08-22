type FeedbackIssue = {
	id: string;
	title: string;
	content: string;
};

type FeedbackPageData = {
	expandedIssueId: string;
	hotIssues: ReadonlyArray<FeedbackIssue>;
};

type FeedbackIssueEvent = WechatMiniprogram.TouchEvent & {
	currentTarget: WechatMiniprogram.TouchEvent["currentTarget"] & {
		dataset?: { issueId?: string };
	};
};

type FeedbackPageMethods = {
	onFeedbackTap(): void;
	onConsultTap(): void;
	onIssueTap(event: FeedbackIssueEvent): void;
};

/** 旧端配置中的公开咨询电话；在线反馈提交没有真实接口，不能在此页伪造“已提交”。 */
const SERVICE_PHONE = "13835627395";

/**
 * 热点问题是旧页面直接写入的静态说明，不是服务端 FAQ 资源。
 * 变更这些文案前应同步产品/客服确认，避免把旧端提示误当成医疗结论。
 */
const HOT_ISSUES = Object.freeze([
	{
		id: "1",
		title: "1.软件使用问题咨询",
		content:
			"就诊人绑定、预约记录无法查询等软件使用问题请通过左上角软件使用咨询联系在线客服，紧急问题请联系13835627395。",
	},
	{
		id: "2",
		title: "2.检查、挂号、门诊等缴费退费相关问题",
		content:
			"关于检查、挂号、门诊等各类缴费退费问题，请在工作时间内联系相关科室或拨打客服电话咨询具体流程和要求。退费申请需要提供相关凭证和身份证明。",
	},
] satisfies ReadonlyArray<FeedbackIssue>);

Page<FeedbackPageData, FeedbackPageMethods>({
	data: {
		expandedIssueId: "1",
		hotIssues: HOT_ISSUES,
	},

	/**
	 * 旧端点击后只显示“跳转到意见反馈页面”的 Toast，实际跳转代码被注释。
	 * 这里必须保留旧端的可见行为，但不能把 Toast 当作工单已受理；真正的
	 * 工单能力需要另行冻结字段、权限、内容安全和持久化 contract。
	 */
	onFeedbackTap() {
		wx.showToast({ title: "跳转到意见反馈页面", icon: "none" });
	},

	/** 展示旧端客服电话，用户确认后才调用系统拨号，不在页面加载时触发外部副作用。 */
	onConsultTap() {
		wx.showModal({
			title: "咨询电话",
			content: `客服电话：${SERVICE_PHONE}\n工作日：08:00-17:00`,
			cancelText: "取消",
			confirmText: "拨打电话",
			success: (result) => {
				if (!result.confirm) return;
				wx.makePhoneCall({
					phoneNumber: SERVICE_PHONE,
					fail: () => {
						wx.showToast({ title: "拨打电话失败", icon: "none" });
					},
				});
			},
		});
	},

	/** 同一时间只展开一条问题，避免长文案一次性挤满页面。 */
	onIssueTap(event) {
		const issueId = event.currentTarget?.dataset?.issueId;
		if (!issueId) return;
		this.setData({
			expandedIssueId: this.data.expandedIssueId === issueId ? "" : issueId,
		});
	},
});
