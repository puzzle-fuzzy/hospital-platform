import {
	queryAppointmentSelfPay,
	queryOutpatientSelfPay,
} from "../../services/api-client";
import {
	type MedicalBusinessRecovery,
	type MedicalOrder,
	medicalPaymentAmountView,
	queryMedicalBusinessRecovery,
	queryMedicalOrder,
} from "../../services/medical-insurance";

const HOSPITAL_NAME = "高平市人民医院";

type PaymentBusiness = "registration" | "outpatient";
type PaymentChannel = "medical" | "wechat";
type PaymentResultState = "confirming" | "success";

type PaymentResultPageData = {
	business: PaymentBusiness;
	channel: PaymentChannel;
	businessLabel: string;
	channelLabel: string;
	resultState: PaymentResultState;
	title: string;
	subtitle: string;
	hospitalName: string;
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
	cashAmountCaption: string;
	hasHospitalDiscount: boolean;
	hospitalDiscountAmountLabel: string;
	amountBreakdownHint: string;
};

type PaymentResultPageMethods = {
	onViewDetail(): void;
	onBackHome(): void;
	loadMedicalResult(input: {
		business: PaymentBusiness;
		patientId: string;
		appointmentId: string;
		recordId: string;
		orderId: string;
	}): Promise<void>;
	loadWechatResult(input: {
		business: PaymentBusiness;
		patientId: string;
		appointmentId: string;
		recordId: string;
	}): Promise<void>;
};

type PaymentResultRouteOptions = {
	business?: string;
	channel?: string;
	patientId?: string;
	appointmentId?: string;
	recordId?: string;
	orderId?: string;
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

function formatFen(value: number): string {
	return `${(value / 100).toFixed(2)}元`;
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
	"businessLabel" | "channelLabel" | "title" | "subtitle"
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
	};
}

function emptyData(): PaymentResultPageData {
	return {
		business: "registration",
		channel: "medical",
		...labels("registration", "medical"),
		resultState: "confirming",
		hospitalName: HOSPITAL_NAME,
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
		cashAmountCaption: "医保结算后自费",
		hasHospitalDiscount: false,
		hospitalDiscountAmountLabel: "",
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
				hasDetail: false,
			});
			return;
		}
		const patientId = safeReference(options?.patientId);
		const appointmentId = safeReference(options?.appointmentId, 64);
		const recordId = safeReference(options?.recordId);
		const orderId = safeReference(options?.orderId, 64);
		const detail = labels(businessValue, channelValue);
		const hasBusinessDetail =
			Boolean(patientId) &&
			(businessValue === "registration"
				? Boolean(appointmentId)
				: Boolean(recordId));
		this.setData({
			business: businessValue,
			channel: channelValue,
			...detail,
			title: `${detail.businessLabel}${detail.channelLabel}结果确认中`,
			subtitle: "正在查询服务端权威订单状态",
			resultState: "confirming",
			patientId,
			appointmentId,
			recordId,
			orderId,
			// 挂号详情本身会重新查服务端，可在确认中查看；门诊的 paid 详情
			// 只有医保订单终态成功后才开放，不能用结果页路由提前宣称已缴费。
			hasDetail: hasBusinessDetail && businessValue === "registration",
			amountBreakdownVisible: false,
			amountBreakdownLoading: true,
			totalAmountLabel: "",
			insuranceAmountLabel: "",
			cashAmountLabel: "",
			cashAmountCaption: "医保结算后自费",
			hasHospitalDiscount: false,
			hospitalDiscountAmountLabel: "",
			amountBreakdownHint: "",
		});
		wx.setNavigationBarTitle({ title: "支付结果" });
		if (channelValue === "medical") {
			void this.loadMedicalResult({
				business: businessValue,
				patientId,
				appointmentId,
				recordId,
				orderId,
			});
		} else {
			void this.loadWechatResult({
				business: businessValue,
				patientId,
				appointmentId,
				recordId,
			});
		}
	},

	async loadWechatResult(input) {
		try {
			const response =
				input.business === "registration"
					? await queryAppointmentSelfPay(input.appointmentId)
					: await queryOutpatientSelfPay(input.recordId, input.patientId);
			const result = response.data;
			if (result.status !== "cash_paid") {
				const failed = result.status === "failed";
				this.setData({
					resultState: "confirming",
					orderId: result.orderId,
					title: failed
						? `${this.data.businessLabel}微信支付未完成`
						: `${this.data.businessLabel}微信支付结果待确认`,
					subtitle: failed
						? "服务端确认原订单未支付成功，可返回重新选择支付方式"
						: "服务端尚未确认全部完成，请返回原支付页面再次查询，勿重复付款",
					amountBreakdownLoading: false,
					amountBreakdownVisible: false,
					amountBreakdownHint: "未取得服务端成功状态，不展示客户端金额",
					hasDetail:
						input.business === "registration" && Boolean(input.appointmentId),
				});
				return;
			}
			const detail = labels(input.business, "wechat");
			this.setData({
				...detail,
				resultState: "success",
				orderId: result.orderId,
				hasDetail: true,
				amountBreakdownVisible: true,
				amountBreakdownLoading: false,
				totalAmountLabel: formatFen(result.totalFen),
				insuranceAmountLabel: formatFen(0),
				cashAmountLabel: formatFen(result.totalFen),
				amountBreakdownHint: "",
			});
			return;
		} catch {
			// 路由参数和旧客户端快照都不能替代服务端查单结果。
		}
		this.setData({
			resultState: "confirming",
			title: `${this.data.businessLabel}微信支付结果待确认`,
			subtitle: "暂时无法核实服务端状态，请返回原支付页面再次查询",
			amountBreakdownLoading: false,
			amountBreakdownVisible: false,
			amountBreakdownHint: "未取得服务端权威金额，不展示本地或路由金额",
		});
	},

	async loadMedicalResult(input) {
		try {
			let order: MedicalOrder | MedicalBusinessRecovery | null = input.orderId
				? await queryMedicalOrder(input.orderId)
				: null;
			const businessId =
				input.business === "registration"
					? input.appointmentId
					: input.recordId;
			if (!order && input.patientId && businessId) {
				order = await queryMedicalBusinessRecovery({
					businessType: input.business,
					businessId,
					patientId: input.patientId,
				});
			}
			if (!order) {
				throw new Error("medical order is unavailable");
			}
			if (order.status !== "insurance_settled") {
				this.setData({
					resultState: "confirming",
					orderId: order.orderId,
					title: `${this.data.businessLabel}医保支付结果待确认`,
					subtitle:
						"服务端尚未确认全部完成，请返回原支付页面再次查询，勿重复付款",
					amountBreakdownLoading: false,
					amountBreakdownVisible: Boolean(order.amounts),
					...(order.amounts
						? {
								totalAmountLabel: formatFen(order.amounts.totalFen),
								...medicalPaymentAmountView(order.amounts),
								amountBreakdownHint: "当前仅为已保存金额，支付最终状态仍在确认",
							}
						: {
								amountBreakdownHint: "支付金额明细正在同步，请稍后查询原订单",
							}),
				});
				return;
			}
			const detail = labels(input.business, "medical");
			if (order.amounts) {
				this.setData({
					...detail,
					resultState: "success",
					hasDetail: true,
					orderId: order.orderId,
					amountBreakdownVisible: true,
					amountBreakdownLoading: false,
					totalAmountLabel: formatFen(order.amounts.totalFen),
					...medicalPaymentAmountView(order.amounts),
					amountBreakdownHint: "",
				});
				return;
			}
			this.setData({
				...detail,
				resultState: "success",
				hasDetail: true,
				orderId: order.orderId,
				amountBreakdownVisible: false,
				amountBreakdownLoading: false,
				amountBreakdownHint: "支付金额明细正在同步，请稍后查看缴费记录",
			});
			return;
		} catch {
			// 查询失败既不能推断支付失败，也不能继续展示成功；用户返回原业务
			// 后再次点击会重新查询服务端，不使用当前页面或本地缓存续跑。
		}
		this.setData({
			resultState: "confirming",
			title: `${this.data.businessLabel}医保支付结果待确认`,
			subtitle: "暂时无法核实服务端状态，请返回原支付页面再次查询",
			amountBreakdownLoading: false,
			amountBreakdownVisible: false,
			amountBreakdownHint: "未取得服务端权威金额，不展示本地或路由金额",
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
