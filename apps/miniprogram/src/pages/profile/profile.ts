import {
	ApiError,
	getUserProfile,
	safeApiErrorMessage,
	updateUserProfile,
} from "../../services/api-client";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { hasPlatformSession } from "../../services/session-service";
import type { ProfilePageData } from "../../types";

type ProfilePageMethods = {
	loadProfile(): Promise<void>;
	onDisplayNameInput(event: WechatMiniprogram.Input): void;
	onGenderChange(event: WechatMiniprogram.PickerChange): void;
	onAgeInput(event: WechatMiniprogram.Input): void;
	onEmailInput(event: WechatMiniprogram.Input): void;
	onSave(): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
	clearDisplayedProfileContext(): void;
	showError(error: unknown, fallback: string): void;
};

/**
 * 保存成功后的延迟返回定时器必须按页面实例隔离。
 *
 * 不能使用模块级单个 timer：开发者工具热重载、页面重复进入或多层页面栈
 * 可能同时存在多个资料页实例。WeakMap 既不会把页面实例长期留在内存中，
 * 也能让 onUnload 精确取消当前页面自己的延迟回退。
 */
const profileNavigationTimers = new WeakMap<
	object,
	ReturnType<typeof setTimeout>
>();

const GENDER_LABELS = ["男", "女", "未知"] as const;
const GENDER_VALUES = ["male", "female", "unknown"] as const;

/**
 * 判断保存失败是否已经破坏了当前资料的会话归属。
 *
 * 普通网络失败或服务端 5xx 不足以证明用户已经换号，旧资料可以暂留在
 * 页面内等待重试；但明确的 unauthorized/session-changed，或者自动重新登录
 * 失败后已经没有 token，都不能继续把旧资料展示成当前账号的资料。
 */
function shouldClearProfileDisplay(error: unknown): boolean {
	if (!hasPlatformSession()) return true;
	return (
		error instanceof ApiError &&
		(error.code === "unauthorized" || error.code === "session-changed")
	);
}

/**
 * 资料页允许下拉刷新；较早的 GET 不能覆盖较新的资料版本，
 * 否则用户看到旧版本后保存会产生不必要的 409 冲突。
 */
function genderIndex(gender: ProfilePageData["gender"]): number {
	const index = GENDER_VALUES.indexOf(gender);
	return index >= 0 ? index : GENDER_VALUES.length - 1;
}

Page<
	ProfilePageData & {
		genderLabels: readonly string[];
		genderIndex: number;
		genderLabel: string;
	},
	ProfilePageMethods
>({
	data: {
		displayName: "",
		gender: "unknown",
		genderLabels: GENDER_LABELS,
		genderIndex: 2,
		genderLabel: "未知",
		age: "",
		email: "",
		version: 0,
		loading: true,
		loaded: false,
		saving: false,
		navigationPending: false,
		error: "",
	},

	onLoad() {
		this.loadProfile();
	},

	loadProfile(): Promise<void> {
		const profileLoadGuard = getPageLatestRequestGuard(this, "profile");
		const requestToken = profileLoadGuard.begin();
		this.setData({ loading: true, error: "" });
		return getUserProfile()
			.then((response) => {
				if (!profileLoadGuard.isCurrent(requestToken)) return;
				const profile = response.data;
				const index = genderIndex(profile.gender);
				this.setData({
					displayName: profile.displayName,
					gender: profile.gender,
					genderIndex: index,
					genderLabel: GENDER_LABELS[index] ?? "未知",
					age: profile.age === null ? "" : String(profile.age),
					email: profile.email ?? "",
					version: profile.version,
					loaded: true,
					error: "",
				});
			})
			.catch((error) => {
				if (!profileLoadGuard.isCurrent(requestToken)) return;
				if (shouldClearProfileDisplay(error)) {
					this.clearDisplayedProfileContext();
				}
				this.showError(error, "个人资料加载失败");
				this.setData({ loaded: false });
			})
			.finally(() => {
				if (profileLoadGuard.isCurrent(requestToken)) {
					this.setData({ loading: false });
				}
			});
	},

	onDisplayNameInput(event): void {
		this.setData({ displayName: event.detail.value });
	},

	onGenderChange(event): void {
		const rawIndex = Number(event.detail.value);
		// Picker 的 value 来自真机事件，不能假设它永远是合法整数；先把边界
		// 收敛到页面声明的选项，避免出现“性别是未知但 picker 没有对应项”的
		// 状态，也避免非法索引在后续 setData 中继续传播。
		const index =
			Number.isInteger(rawIndex) &&
			rawIndex >= 0 &&
			rawIndex < GENDER_VALUES.length
				? rawIndex
				: GENDER_VALUES.length - 1;
		// 上面的边界判断已经保证 index 落在固定三项内；保留安全兜底是为了
		// 即使未来选项被改动，也不会把 undefined 写入普通资料请求。
		const value = GENDER_VALUES[index] ?? "unknown";
		this.setData({
			gender: value,
			genderIndex: index,
			genderLabel: GENDER_LABELS[index] ?? "未知",
		});
	},

	onAgeInput(event): void {
		this.setData({ age: event.detail.value.replace(/\D/g, "") });
	},

	onEmailInput(event): void {
		this.setData({ email: event.detail.value });
	},

	/** 保存时只提交页面声明的普通资料字段，不携带旧端身份/实名字段。 */
	onSave(): Promise<void> {
		// WXML 已经禁用按钮，但事件层仍必须自守：真机快速连点或重复事件
		// 不能用同一个 version 发起第二次 PUT，否则会把一次成功更新制造成
		// 一个无意义的 409，并让用户误以为保存失败。
		if (this.data.saving || this.data.navigationPending)
			return Promise.resolve();
		if (this.data.loading) {
			this.setData({ error: "个人资料正在加载，请稍后保存" });
			return Promise.resolve();
		}
		if (!this.data.loaded) {
			this.setData({ error: "个人资料尚未加载完成，请稍后重试" });
			return Promise.resolve();
		}
		const displayName = this.data.displayName.trim();
		if (!displayName) {
			this.setData({ error: "请输入昵称" });
			return Promise.resolve();
		}
		const ageText = this.data.age.trim();
		const age = ageText ? Number(ageText) : null;
		if (age !== null && (!Number.isInteger(age) || age < 0 || age > 150)) {
			this.setData({ error: "请输入 0 到 150 之间的年龄" });
			return Promise.resolve();
		}
		const saveGuard = getPageLatestRequestGuard(this, "profile-save");
		const saveToken = saveGuard.begin();
		const email = this.data.email.trim();
		this.setData({ saving: true, error: "" });
		return updateUserProfile({
			version: this.data.version,
			displayName,
			gender: this.data.gender,
			age,
			email: email || null,
		})
			.then((response) => {
				if (!saveGuard.isCurrent(saveToken)) return;
				this.setData({
					version: response.data.version,
					saving: false,
					navigationPending: true,
				});
				wx.showToast({ title: "保存成功", icon: "success" });
				const navigationTimer = setTimeout(() => {
					profileNavigationTimers.delete(this);
					// 用户可能在 toast 期间手动返回；onUnload 会先清理定时器，
					// 防止旧页面稍后又 navigateBack，误弹出当前页面栈中的新页面。
					if (!this.data.navigationPending) return;
					this.setData({ navigationPending: false });
					wx.navigateBack();
				}, 500);
				profileNavigationTimers.set(this, navigationTimer);
			})
			.catch((error) => {
				if (!saveGuard.isCurrent(saveToken)) return;
				const requiresReload =
					error instanceof ApiError && error.code === "user-profile-conflict";
				const sessionDisplayInvalid = shouldClearProfileDisplay(error);
				// 409 说明服务端已经存在比当前页面更新的 version；继续保留
				// loaded=true 会让用户再次提交同一个旧版本，形成重复冲突，
				// 也会让页面继续把旧资料当作最新事实。冲突后强制回到未加载态，
				// 只有下拉刷新重新取得服务端版本后才恢复保存入口。
				this.setData({
					saving: false,
					...(requiresReload || sessionDisplayInvalid ? { loaded: false } : {}),
				});
				if (sessionDisplayInvalid) {
					// 保存请求失败时不能让旧昵称、性别和邮箱继续停留在页面上；
					// 否则用户重新登录后会把上一账号资料误认为当前账号资料。
					this.clearDisplayedProfileContext();
				}
				this.showError(error, "个人资料保存失败");
			});
	},

	onPullDownRefresh(): void {
		if (this.data.saving) {
			wx.stopPullDownRefresh();
			return;
		}
		this.loadProfile().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		// 页面卸载后不能再调用 setData；直接清理当前实例的定时器，
		// 让延迟回调根本没有机会在新页面栈上继续 navigateBack。
		const navigationTimer = profileNavigationTimers.get(this);
		if (navigationTimer !== undefined) clearTimeout(navigationTimer);
		profileNavigationTimers.delete(this);
		disposePageInstance(this);
	},

	/**
	 * 清理当前页面实例中已经失去会话证明的资料读模型。
	 *
	 * 这里只清理页面状态，不删除平台 token，也不修改服务端资料；临时依赖
	 * 故障仍由调用方保留重试能力。只有用户重新取得有效会话并重新读取资料后，
	 * 页面才允许恢复编辑和保存入口。
	 */
	clearDisplayedProfileContext(): void {
		this.setData({
			displayName: "",
			gender: "unknown",
			genderIndex: GENDER_VALUES.length - 1,
			genderLabel: GENDER_LABELS[GENDER_LABELS.length - 1] ?? "未知",
			age: "",
			email: "",
			version: 0,
			loaded: false,
			navigationPending: false,
		});
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "user-profile-conflict"
				? "个人资料已被其他设备修改，请下拉刷新后重试"
				: safeApiErrorMessage(error, fallback);
		if (shouldClearProfileDisplay(error)) {
			// 资料 GET 的自动恢复或资料 PUT 的明确失效都不能把用户留在旧页面；
			// 返回首页后由用户确认当前微信账号，避免自动重放普通资料命令。
			wx.showToast({ title: "登录状态已失效，请重新登录", icon: "none" });
			wx.reLaunch({ url: "/pages/index/index" });
			return;
		}
		this.setData({ error: message });
	},
});
