type PaymentBusiness = "registration" | "outpatient";
type PaymentChannel = "medical" | "wechat";

type PaymentResultPageData = {
	business: PaymentBusiness;
	channel: PaymentChannel;
	businessLabel: string;
	channelLabel: string;
	title: string;
	subtitle: string;
	detailHint: string;
	patientId: string;
	appointmentId: string;
	recordId: string;
	hasDetail: boolean;
};

type PaymentResultPageMethods = {
	onViewDetail(): void;
	onBackHome(): void;
};

type PaymentResultRouteOptions = {
	business?: string;
	channel?: string;
	patientId?: string;
	appointmentId?: string;
	recordId?: string;
};

function decode(value: string | undefined): string {
	if (!value) return "";
	try {
		return decodeURIComponent(value).trim();
	} catch {
		return "";
	}
}

function safeReference(value: string | undefined, max = 128): string {
	const decoded = decode(value);
	if (
		!decoded ||
		decoded.length > max ||
		Array.from(decoded).some((character) => character.charCodeAt(0) <= 0x1f)
	) {
		return "";
	}
	return decoded;
}

function isBusiness(value: string): value is PaymentBusiness {
	return value === "registration" || value === "outpatient";
}

function isChannel(value: string): value is PaymentChannel {
	return value === "medical" || value === "wechat";
}

function labels(
	business: PaymentBusiness,
	channel: PaymentChannel,
): Pick<
	PaymentResultPageData,
	"businessLabel" | "channelLabel" | "title" | "subtitle" | "detailHint"
> {
	const businessLabel = business === "registration" ? "挂号" : "门诊";
	const channelLabel = channel === "medical" ? "医保支付" : "微信支付";
	return {
		businessLabel,
		channelLabel,
		title: `${businessLabel}${channelLabel}成功`,
		subtitle:
			channel === "medical"
				? `${businessLabel}医保支付及医院结算已确认`
				: `${businessLabel}微信支付已确认到账`,
		detailHint:
			business === "registration"
				? "可查看本次预约详情和就诊信息"
				: "可查看本次门诊缴费详情",
	};
}

function emptyData(): PaymentResultPageData {
	return {
		business: "registration",
		channel: "medical",
		...labels("registration", "medical"),
		patientId: "",
		appointmentId: "",
		recordId: "",
		hasDetail: false,
	};
}

Page<PaymentResultPageData, PaymentResultPageMethods>({
	data: emptyData(),

	onLoad(options: PaymentResultRouteOptions): void {
		const businessValue = decode(options?.business);
		const channelValue = decode(options?.channel);
		if (!isBusiness(businessValue) || !isChannel(channelValue)) {
			this.setData({
				title: "支付结果不可用",
				subtitle: "支付状态引用已失效，请返回支付记录查看",
				detailHint: "",
				hasDetail: false,
			});
			return;
		}
		const patientId = safeReference(options?.patientId);
		const appointmentId = safeReference(options?.appointmentId, 64);
		const recordId = safeReference(options?.recordId);
		const detail = labels(businessValue, channelValue);
		this.setData({
			business: businessValue,
			channel: channelValue,
			...detail,
			patientId,
			appointmentId,
			recordId,
			hasDetail:
				Boolean(patientId) &&
				(businessValue === "registration"
					? Boolean(appointmentId)
					: Boolean(recordId)),
		});
		wx.setNavigationBarTitle({ title: "支付结果" });
	},

	onViewDetail(): void {
		if (!this.data.hasDetail) return;
		if (this.data.business === "registration") {
			wx.redirectTo({
				url: `/pages/appointment-detail/appointment-detail?patientId=${encodeURIComponent(this.data.patientId)}&appointmentId=${encodeURIComponent(this.data.appointmentId)}`,
			});
			return;
		}
		wx.redirectTo({
			url: `/pages/outpatient-payment-detail/outpatient-payment-detail?patientId=${encodeURIComponent(this.data.patientId)}&recordId=${encodeURIComponent(this.data.recordId)}&status=paid`,
		});
	},

	onBackHome(): void {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
