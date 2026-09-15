import {
	ApiError,
	contextualApiErrorMessage,
	requestMyDoctors,
} from "../../services/api-client";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import type { MyDoctorPageData } from "../../types";

type MyDoctorPageMethods = {
	loadDoctors(): Promise<void>;
	onDoctorTap(event: WechatMiniprogram.TouchEvent): void;
	onRetry(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
};

function listErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "我的医生服务暂时不可用，请稍后再试";
	}
	return contextualApiErrorMessage(error, "我的医生暂时无法获取，请稍后再试");
}

Page<MyDoctorPageData, MyDoctorPageMethods>({
	data: {
		items: [],
		loading: true,
		error: "",
	},

	onLoad() {
		registerPageSessionResetListener(
			this,
			() => {
				// 我的医生是当前 owner 的关系读模型。账号切换后必须先清空
				// 旧关系，再由新会话重新读取，不能把旧 owner 的医生卡片留在页面。
				this.setData({ items: [], loading: true, error: "" });
			},
			() => this.loadDoctors(),
		);
		void this.loadDoctors();
	},

	onShow() {
		// 从医生详情返回时重新读取，确保取消关注后列表立即反映服务端事实。
		if (!this.data.loading && this.data.items.length > 0) {
			void this.loadDoctors();
		}
	},

	loadDoctors(): Promise<void> {
		const guard = getPageLatestRequestGuard(this, "my-doctors");
		const token = guard.begin();
		this.setData({ loading: true, error: "" });
		return requestMyDoctors()
			.then((payload) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					items: payload.data.items,
					loading: false,
					error: "",
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				this.setData({
					items: [],
					loading: false,
					error: listErrorMessage(error),
				});
			});
	},

	onDoctorTap(event): void {
		const doctorId = event.currentTarget?.dataset?.doctorId;
		if (typeof doctorId !== "string" || !doctorId.trim()) return;
		wx.navigateTo({
			url:
				"/pages/my-doctor-detail/my-doctor-detail?doctorId=" +
				encodeURIComponent(doctorId.trim()),
		});
	},

	onRetry(): void {
		if (!this.data.loading) void this.loadDoctors();
	},

	onPullDownRefresh(): void {
		this.loadDoctors().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
