import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import { bindPatientToHospital } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";

type PatientBindingPageData = {
	displayName: string;
	mobile: string;
	identityNumber: string;
	agreed: boolean;
	submitting: boolean;
	error: string;
};

type PatientBindingPageMethods = {
	onDisplayNameInput(event: WechatMiniprogram.Input): void;
	onMobileInput(event: WechatMiniprogram.Input): void;
	onIdentityNumberInput(event: WechatMiniprogram.Input): void;
	onAgreementChange(event: WechatMiniprogram.CheckboxGroupChange): void;
	onSubmit(): Promise<void>;
	onBack(): void;
	onOpenAgreement(): void;
};

function inputValue(event: WechatMiniprogram.Input): string {
	return typeof event.detail.value === "string" ? event.detail.value : "";
}

function normalizeIdentityNumber(value: string): string {
	return value.trim().toUpperCase();
}

function isValidIdentityNumber(value: string): boolean {
	const identity = normalizeIdentityNumber(value);
	if (!/^(?:\d{15}|\d{17}[0-9X])$/u.test(identity)) return false;
	if (identity.length === 15) return true;
	const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
	const checks = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
	const sum = weights.reduce(
		(total, weight, index) => total + Number(identity[index]) * weight,
		0,
	);
	return checks[sum % 11] === identity[17];
}

Page<PatientBindingPageData, PatientBindingPageMethods>({
	data: {
		displayName: "",
		mobile: "",
		identityNumber: "",
		agreed: false,
		submitting: false,
		error: "",
	},

	onDisplayNameInput(event) {
		this.setData({ displayName: inputValue(event), error: "" });
	},

	onMobileInput(event) {
		this.setData({ mobile: inputValue(event).replace(/\s+/gu, ""), error: "" });
	},

	onIdentityNumberInput(event) {
		this.setData({
			identityNumber: normalizeIdentityNumber(inputValue(event)),
			error: "",
		});
	},

	onAgreementChange(event) {
		this.setData({ agreed: event.detail.value.includes("agree"), error: "" });
	},

	onSubmit(): Promise<void> {
		if (this.data.submitting) return Promise.resolve();
		const displayName = this.data.displayName.trim();
		const mobile = this.data.mobile.trim();
		const identityNumber = normalizeIdentityNumber(this.data.identityNumber);
		if (!displayName) {
			this.setData({ error: "请输入就诊人姓名" });
			return Promise.resolve();
		}
		if (!/^1[3-9]\d{9}$/u.test(mobile)) {
			this.setData({ error: "请输入正确的手机号" });
			return Promise.resolve();
		}
		if (!isValidIdentityNumber(identityNumber)) {
			this.setData({ error: "请输入正确的身份证号" });
			return Promise.resolve();
		}
		if (!this.data.agreed) {
			this.setData({ error: "请先阅读并同意就诊人信息使用说明" });
			return Promise.resolve();
		}

		this.setData({ submitting: true, error: "" });
		return bindPatientToHospital({
			displayName,
			mobile,
			identityNumber,
			consent: true,
		})
			.then(() => {
				wx.showToast({ title: "添加成功", icon: "success" });
				setTimeout(() => wx.navigateBack(), 650);
			})
			.catch((error) => {
				const fallback = "添加就诊人失败，请稍后再试";
				const message =
					error instanceof ApiError
						? safeApiErrorMessage(error, fallback)
						: fallback;
				this.setData({ error: errorMessageWithCode(error, message) });
			})
			.finally(() => {
				this.setData({ submitting: false });
			});
	},

	onBack() {
		wx.navigateBack();
	},

	onOpenAgreement() {
		wx.showModal({
			title: "就诊人信息使用说明",
			content:
				"为完成医院就诊服务，我们会将你提交的姓名、手机号和身份证号发送至医院服务端，用于查档、建档和绑定就诊卡。信息仅用于本次就诊人服务。",
			showCancel: false,
			confirmText: "知道了",
		});
	},
});
