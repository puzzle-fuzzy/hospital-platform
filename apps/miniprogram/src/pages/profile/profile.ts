import {
	ApiError,
	getUserProfile,
	safeApiErrorMessage,
	updateUserProfile,
} from "../../services/api-client";
import type { ProfilePageData } from "../../types";

type ProfilePageMethods = {
	loadProfile(): Promise<void>;
	onDisplayNameInput(event: WechatMiniprogram.Input): void;
	onGenderChange(event: WechatMiniprogram.PickerChange): void;
	onAgeInput(event: WechatMiniprogram.Input): void;
	onEmailInput(event: WechatMiniprogram.Input): void;
	onSave(): Promise<void>;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

const GENDER_LABELS = ["男", "女", "未知"] as const;
const GENDER_VALUES = ["male", "female", "unknown"] as const;

function genderIndex(gender: ProfilePageData["gender"]): number {
	return GENDER_VALUES.indexOf(gender);
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
		error: "",
	},

	onLoad() {
		this.loadProfile();
	},

	loadProfile(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return getUserProfile()
			.then((response) => {
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
				this.showError(error, "个人资料加载失败");
				this.setData({ loaded: false });
			})
			.finally(() => this.setData({ loading: false }));
	},

	onDisplayNameInput(event): void {
		this.setData({ displayName: event.detail.value });
	},

	onGenderChange(event): void {
		const index = Number(event.detail.value);
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
				this.setData({ version: response.data.version, saving: false });
				wx.showToast({ title: "保存成功", icon: "success" });
				setTimeout(() => wx.navigateBack(), 500);
			})
			.catch((error) => {
				this.setData({ saving: false });
				this.showError(error, "个人资料保存失败");
			});
	},

	onPullDownRefresh(): void {
		this.loadProfile().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "user-profile-conflict"
				? "个人资料已被其他设备修改，请下拉刷新后重试"
				: safeApiErrorMessage(error, fallback);
		this.setData({ error: message });
	},
});
