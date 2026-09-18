import {
	type MedicalPaymentAmounts,
	queryMedicalOrder,
	readLastMedicalPaymentResult,
} from "../../services/medical-insurance";

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
	orderId: string;
	hasDetail: boolean;
	amountBreakdownVisible: boolean;
	amountBreakdownLoading: boolean;
	totalAmountLabel: string;
	insuranceAmountLabel: string;
	cashAmountLabel: string;
	amountBreakdownHint: string;
};

type PaymentResultPageMethods = {
	onViewDetail(): void;
	onBackHome(): void;
	loadAmounts(
		orderId: string,
		fallbackAmounts?: MedicalPaymentAmounts,
	): Promise<void>;
};

type PaymentResultRouteOptions = {
	business?: string;
	channel?: string;
	patientId?: string;
	appointmentId?: string;
	recordId?: string;
	orderId?: string;
	totalFen?: string;
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

function parseFen(value: string | undefined): number | undefined {
	const normalized = safeReference(value, 16);
	if (!/^\d+$/u.test(normalized)) return undefined;
	const amount = Number(normalized);
	return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function formatFen(value: number): string {
	return `${(value / 100).toFixed(2)} 元`;
}

function matchesPaymentResult(
	result: ReturnType<typeof readLastMedicalPaymentResult>,
	business: PaymentBusiness,
	patientId: string,
	appointmentId: string,
	recordId: string,
): result is NonNullable<ReturnType<typeof readLastMedicalPaymentResult>> {
	// 门诊结果页的业务引用是 recordId，路由不会额外携带 appointmentId；
	// 兼容旧版本地结果把门诊 recordId 写入 appointmentId 的情况。
	const matchesBusinessReference =
		business === "outpatient"
			? result?.recordId === recordId || result?.appointmentId === recordId
			: result?.appointmentId === appointmentId;
	return Boolean(
		result &&
			result.patientId === patientId &&
			matchesBusinessReference &&
			(!result.businessType || result.businessType === business) &&
			patientId,
	);
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
		orderId: "",
		hasDetail: false,
		amountBreakdownVisible: false,
		amountBreakdownLoading: false,
		totalAmountLabel: "",
		insuranceAmountLabel: "",
		cashAmountLabel: "",
		amountBreakdownHint: "",
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
		const storedResult = readLastMedicalPaymentResult();
		const matchingStoredResult = matchesPaymentResult(
			storedResult,
			businessValue,
			patientId,
			appointmentId,
			recordId,
		)
			? storedResult
			: null;
		const orderId =
			safeReference(options?.orderId, 64) ||
			matchingStoredResult?.orderId ||
			"";
		const routeTotalFen = parseFen(options?.totalFen);
		const routeAmounts =
			routeTotalFen === undefined
				? undefined
				: {
						totalFen: routeTotalFen,
						insuranceFen: 0,
						cashFen: routeTotalFen,
					};
		const fallbackAmounts =
			(channelValue === "wechat" ? routeAmounts : undefined) ??
			matchingStoredResult?.amounts ??
			routeAmounts;
		const detail = labels(businessValue, channelValue);
		this.setData({
			business: businessValue,
			channel: channelValue,
			...detail,
			patientId,
			appointmentId,
			recordId,
			orderId,
			hasDetail:
				Boolean(patientId) &&
				(businessValue === "registration"
					? Boolean(appointmentId)
					: Boolean(recordId)),
			amountBreakdownVisible: Boolean(fallbackAmounts),
			amountBreakdownLoading: channelValue === "medical" && Boolean(orderId),
			...(fallbackAmounts
				? {
						totalAmountLabel: formatFen(fallbackAmounts.totalFen),
						insuranceAmountLabel: formatFen(fallbackAmounts.insuranceFen),
						cashAmountLabel: formatFen(fallbackAmounts.cashFen),
					}
				: {}),
		});
		wx.setNavigationBarTitle({ title: "支付结果" });
		void this.loadAmounts(orderId, fallbackAmounts);
	},

	async loadAmounts(
		orderId: string,
		fallbackAmounts?: MedicalPaymentAmounts,
	): Promise<void> {
		if (this.data.channel !== "medical" || !orderId) {
			this.setData({ amountBreakdownLoading: false });
			return;
		}
		try {
			const order = await queryMedicalOrder(orderId);
			if (order.amounts) {
				this.setData({
					amountBreakdownVisible: true,
					amountBreakdownLoading: false,
					totalAmountLabel: formatFen(order.amounts.totalFen),
					insuranceAmountLabel: formatFen(order.amounts.insuranceFen),
					cashAmountLabel: formatFen(order.amounts.cashFen),
					amountBreakdownHint: "",
				});
				return;
			}
		} catch {
			// 结果页不能把金额明细查询失败误报成支付失败；保留已完成摘要，
			// 若本地没有最终金额则只提示同步中，不自行猜测医保/自费分摊。
		}
		this.setData({
			amountBreakdownLoading: false,
			...(fallbackAmounts
				? {}
				: {
						amountBreakdownHint: "支付金额明细正在同步，请稍后查看门诊缴费记录",
					}),
		});
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
