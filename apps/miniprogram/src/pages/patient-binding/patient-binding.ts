import { ApiError } from "../../services/api-client";
import { bindPatientToHospital } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import { hasPlatformSession } from "../../services/session-service";

type PatientBindingField = "displayName" | "mobile" | "identityNumber";

type PatientBindingPageData = {
	displayName: string;
	mobile: string;
	identityNumber: string;
	consent: boolean;
	submitting: boolean;
	error: string;
};

type PatientBindingPageMethods = {
	onInput(event: WechatMiniprogram.Input): void;
	onToggleConsent(): void;
	onOpenPatientAgreement(): void;
	onSubmit(): void;
	submitPatientBinding(): Promise<void>;
	onBack(): void;
};

function normalizeField(
	field: string,
	value: unknown,
): { field: PatientBindingField; value: string } | undefined {
	if (
		field !== "displayName" &&
		field !== "mobile" &&
		field !== "identityNumber"
	) {
		return undefined;
	}
	const normalized = String(value ?? "").trim();
	return {
		field,
		value: field === "identityNumber" ? normalized.toUpperCase() : normalized,
	};
}

function validateBindingInput(
	data: PatientBindingPageData,
): string | undefined {
	if (!data.displayName) return "请输入就诊人姓名";
	if (Array.from(data.displayName).length > 128) {
		return "姓名长度不能超过 128 个字符";
	}
	if (!/^1[3-9]\d{9}$/u.test(data.mobile)) return "请输入正确的手机号";
	if (!/^(?:\d{15}|\d{17}[0-9X])$/u.test(data.identityNumber)) {
		return "请输入正确的身份证号";
	}
	if (!data.consent) return "请先阅读并同意患者服务协议";
	return undefined;
}

function submitErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "dependency-not-configured") {
			return "就诊人服务暂未配置完成，请稍后再试";
		}
		if (
			error.code === "validation" ||
			error.code === "patient-binding-invalid"
		) {
			return "请检查姓名、手机号、身份证号和授权确认";
		}
		if (error.code === "provider-request-rejected") {
			return "医院服务拒绝了本次添加，请核对信息后重试";
		}
		if (error.code === "provider-response-invalid") {
			return "医院返回的数据暂时无法确认，请稍后重试";
		}
	}
	return errorMessageWithCode(error, "添加就诊人失败，请稍后重试");
}

function getWechatLoginCode(): Promise<string> {
	return new Promise((resolve, reject) => {
		wx.login({
			success: (result) => {
				if (typeof result.code === "string" && result.code.trim()) {
					resolve(result.code);
					return;
				}
				reject(new Error("wechat-login-code-missing"));
			},
			fail: reject,
		});
	});
}

Page<PatientBindingPageData, PatientBindingPageMethods>({
	data: {
		displayName: "",
		mobile: "",
		identityNumber: "",
		consent: false,
		submitting: false,
		error: "",
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "添加就诊人" });
	},

	onInput(event) {
		const normalized = normalizeField(
			String(event.currentTarget.dataset.field ?? ""),
			event.detail.value,
		);
		if (!normalized) return;
		this.setData({ [normalized.field]: normalized.value, error: "" });
	},

	onToggleConsent() {
		this.setData({ consent: !this.data.consent, error: "" });
	},

	onOpenPatientAgreement() {
		wx.navigateTo({ url: "/pages/patient-agreement/patient-agreement" });
	},

	onSubmit() {
		void this.submitPatientBinding();
	},

	async submitPatientBinding() {
		if (this.data.submitting) return;
		if (!hasPlatformSession()) {
			this.setData({ error: "登录状态已失效，请返回首页重新登录" });
			return;
		}
		const validationMessage = validateBindingInput(this.data);
		if (validationMessage) {
			this.setData({ error: validationMessage });
			return;
		}

		this.setData({ submitting: true, error: "" });
		try {
			// 旧服务端的 JWT 是众阳 patCards 归属当前 unionId 的必要上下文。
			// 每次提交重新取得一次性 code，由平台 API 服务端换取并消费，
			// 不把旧 JWT 或众阳地址下发到小程序。
			const legacyLoginCode = await getWechatLoginCode();
			const result = await bindPatientToHospital({
				displayName: this.data.displayName,
				mobile: this.data.mobile,
				identityNumber: this.data.identityNumber,
				consent: true,
				legacyLoginCode,
			});
			this.setData({ submitting: false });
			wx.showToast({
				title: result.created ? "添加成功" : "就诊人已关联",
				icon: "success",
			});
			setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
		} catch (error) {
			this.setData({ submitting: false, error: submitErrorMessage(error) });
		}
	},

	onBack() {
		wx.navigateBack({ delta: 1 });
	},
});
