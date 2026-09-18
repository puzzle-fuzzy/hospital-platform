import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	formatOutpatientBillDateLabel,
	formatOutpatientRatioLabel,
	loadCurrentPatientForOwner,
	loadOutpatientPaymentRecords,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	clearPendingPayment,
	readPendingPayment,
	startOutpatientMedicalPayment,
} from "../../services/medical-insurance";
import { startOutpatientSelfPay } from "../../services/outpatient-self-pay";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	isPatientSelectionError,
	patientContextErrorMessage,
	preservedPatientForReload,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
import type {
	DatasetEvent,
	OutpatientPaymentPageData,
	OutpatientPaymentRecord,
	OutpatientPaymentRecordView,
	Patient,
	ViewKeyEvent,
} from "../../types";

/**
 * 门诊费用只读结果的本地渲染批次大小。
 *
 * 当前 API 没有服务端 cursor/page，`items` 仍然保存本次完整查询结果，
 * 以免把本地分批误解为 provider 分页或改变费用总数；只有 `visibleItems`
 * 控制 WXML 首帧和后续渲染成本。支付、医保和结算状态不由这个批次推导。
 */
const OUTPATIENT_PAYMENT_PAGE_SIZE = 10;

/**
 * 旧端门诊缴费页只展示已核对的高平市人民医院单院区。
 *
 * 这里不能把院区名称当成 Provider 动态返回，也不能让页面参数覆盖它；
 * 在医院/院区正式 contract 到达前，点击院区行只给出明确提示，不发起
 * 未注册的院区查询或把未知院区 ID 传给费用 Provider。
 */
const DEFAULT_HOSPITAL_NAME = "高平市人民医院";

/**
 * 费用卡片事件必须回查当前可见批次，而不是相信 WXML 传来的状态。
 *
 * 患者切换、状态切换或刷新后，旧卡片事件仍可能在微信事件队列中抵达；
 * `viewKey` 会随本次查询令牌变化，因此旧事件无法命中新批次的费用记录。
 */
function findVisiblePayment(
	items: readonly OutpatientPaymentRecordView[],
	viewKey: unknown,
): OutpatientPaymentRecordView | undefined {
	if (typeof viewKey !== "string" || !viewKey) return undefined;
	return items.find((item) => item.viewKey === viewKey);
}

/**
 * Provider 读模型异常不向患者端投影内部错误码。
 *
 * 10820 表示上游响应没有通过服务端/客户端 contract 校验，不等同于
 * 患者上下文失效。页面在这种情况下展示与空数组相同的“未查询到记录”
 * 空态；服务端仍保留原始失败日志和 trace，维护者不会失去排障依据。
 */
function shouldRenderOutpatientEmptyState(error: unknown): boolean {
	return (
		error instanceof ApiError && error.code === "provider-response-invalid"
	);
}

type PaymentMethod = "medical" | "wechat";
type PaymentBusyKind = PaymentMethod | "";
type PaymentMethodEvent = DatasetEvent<{ method?: string }>;
type OutpatientPaymentPageState = OutpatientPaymentPageData & {
	paymentSheetVisible: boolean;
	paymentRecord: OutpatientPaymentRecordView | null;
	paymentMethod: PaymentMethod | "";
	paymentBusy: PaymentBusyKind;
};

type MedicalApp = {
	globalData: { medicalInsuranceAuthCode: string };
};

type OutpatientPaymentPageMethods = {
	loadPage(): Promise<void>;
	loadRecords(
		patient: Patient,
		status: "unpaid" | "paid",
		requestToken?: number,
		expectedSessionGeneration?: number,
	): Promise<void>;
	onStatusTap(event: WechatMiniprogram.TouchEvent): void;
	onLoadMore(): void;
	onRetry(): void;
	onChangePatient(): void;
	onHospitalTap(): void;
	onPaymentTap(event: ViewKeyEvent): void;
	onPaymentMethodTap(event: PaymentMethodEvent): void;
	onClosePaymentSheet(): void;
	onStopPaymentSheet(): void;
	onConfirmPayment(): void;
	startPayment(
		method: PaymentMethod,
		record: OutpatientPaymentRecordView,
		patientId: string,
	): Promise<void>;
	resumePendingMedicalPayment(): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
	toView(
		record: OutpatientPaymentRecord,
		index: number,
		renderGeneration: number,
	): OutpatientPaymentRecordView;
	isPatientContextCurrent(): boolean;
};

let resumingOutpatientPayment = false;

function paymentResultUrl(
	patientId: string,
	recordId: string,
	channel: PaymentMethod,
	options?: { orderId?: string; totalFen?: number },
): string {
	const orderId = options?.orderId
		? `&orderId=${encodeURIComponent(options.orderId)}`
		: "";
	const totalFen =
		options?.totalFen !== undefined
			? `&totalFen=${encodeURIComponent(String(options.totalFen))}`
			: "";
	return `/pages/payment-result/payment-result?business=outpatient&channel=${channel}&patientId=${encodeURIComponent(patientId)}&recordId=${encodeURIComponent(recordId)}${orderId}${totalFen}`;
}

function showPaymentToast(message: string): void {
	const title = message.replace(/\s+/gu, " ").trim().slice(0, 32);
	if (!title) return;
	wx.showToast({ title, icon: "none", duration: 2600 });
}

function isPendingForRecord(
	pending: ReturnType<typeof readPendingPayment>,
	patientId: string,
	recordId: string,
): boolean {
	return Boolean(
		pending?.businessType === "outpatient" &&
			pending.patientId === patientId &&
			pending.recordId === recordId,
	);
}

Page<OutpatientPaymentPageState, OutpatientPaymentPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		hospitalName: DEFAULT_HOSPITAL_NAME,
		selectedPatient: null,
		patientSessionGeneration: -1,
		activeStatus: "unpaid",
		items: [],
		visibleItems: [],
		visibleItemCount: 0,
		hasMoreItems: false,
		loading: true,
		error: "",
		canSelectPatient: false,
		paymentSheetVisible: false,
		paymentRecord: null,
		paymentMethod: "",
		paymentBusy: "",
	},

	onLoad() {
		// 首次展示标记必须绑定当前页面实例，不能在多层页面栈之间共享。
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				// 门诊费用当前只读，但金额和缴费状态同样属于患者敏感范围；账号
				// 切换时必须先清空旧账单，再等待用户重新触发当前会话读取。
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					patientSessionGeneration: -1,
					items: [],
					visibleItems: [],
					visibleItemCount: 0,
					hasMoreItems: false,
					loading: true,
					error: "",
					canSelectPatient: false,
					paymentSheetVisible: false,
					paymentRecord: null,
					paymentMethod: "",
					paymentBusy: "",
				});
			},
			() => this.loadPage(),
		);
		this.loadPage();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.resumePendingMedicalPayment();
		this.loadPage();
	},

	/** 医保小程序回跳后立即进入结算页，由结算页展示并继续处理接口进度。 */
	async resumePendingMedicalPayment(): Promise<void> {
		if (resumingOutpatientPayment) return;
		const pending = readPendingPayment();
		const app = getApp<MedicalApp>();
		const authCode = String(
			app?.globalData?.medicalInsuranceAuthCode || "",
		).trim();
		if (
			!authCode ||
			!pending ||
			pending.businessType !== "outpatient" ||
			!pending.recordId
		) {
			if (authCode && app?.globalData)
				app.globalData.medicalInsuranceAuthCode = "";
			return;
		}
		resumingOutpatientPayment = true;
		wx.navigateTo({
			url: "/pages/outpatient-medical-settlement/outpatient-medical-settlement",
			fail: () => {
				resumingOutpatientPayment = false;
				if (app?.globalData) app.globalData.medicalInsuranceAuthCode = authCode;
				showPaymentToast("结算页面打开失败，请稍后重试");
			},
			success: () => {
				resumingOutpatientPayment = false;
			},
		});
	},

	/** 先确认当前患者归属，再读取门诊费用，避免把临床患者映射交给页面。 */
	loadPage(): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const requestToken = loadGuard.begin();
		// 费用页面的患者卡片、状态标签和金额必须来自同一会话代际；
		// 另一个页面换号时，不能只靠当前页面 requestToken 继续拼接旧快照。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		// 同一账号、同一明确选择的患者在刷新期间保留身份卡片，但费用列表
		// 必须清空并等待本轮 owner-scoped 查询，避免旧金额与新患者混在一起。
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			items: [],
			visibleItems: [],
			visibleItemCount: 0,
			hasMoreItems: false,
			canSelectPatient: false,
		});
		// 先完成服务端 `/me` 验证，再读取患者目录；否则页面入口会在本地
		// token 已过期时仍被误认为可切换患者，随后才在费用请求中暴露 401。
		return getCurrentUser()
			.then((currentUser) => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				expectedOwnerId = currentUser.data.user.id;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(expectedOwnerId);
			})
			.then((patientContext) => {
				if (!patientContext) return;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Outpatient payment page session changed before patient context was committed",
				);
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return;
				}
				// 患者目录已经完成 owner-scoped 确认，此时就可以把患者卡片
				// 作为当前上下文交给页面；费用列表仍在独立请求中，不能因为
				// selectedPatient 还为空而把“已缴/待缴”切换误判成首次加载。
				// 这样用户在费用请求进行期间切换 tab 时，新的 tab 请求会让
				// 旧 requestToken 失效，旧状态不会覆盖用户最后一次选择。
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
				});
				return this.loadRecords(
					patient,
					this.data.activeStatus,
					requestToken,
					expectedSessionGeneration,
				);
			})
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.setData({
						sessionState: sessionStateAfterAuthenticatedReadError(
							error,
							this.data.sessionState,
							hasPlatformSession(),
						),
					});
				}
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "门诊缴费记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	async loadRecords(
		patient: Patient,
		status: "unpaid" | "paid",
		requestToken?: number,
		expectedSessionGeneration = getSessionGeneration(),
	): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const effectiveRequestToken = requestToken ?? loadGuard.begin();
		// 查询状态必须来自本次操作的快照，不能依赖 setData 后的异步页面状态。
		if (!isCurrentSelectedPatient(patient.id)) {
			return Promise.reject(
				new ApiError("Current patient selection changed", {
					code: "patient-selection-required",
				}),
			);
		}
		// 代际变化必须在请求发出前阻断。只在响应回来后丢弃，仍可能把
		// 旧患者 ID 交给新账号的费用查询；服务端 owner 校验不能替代
		// 客户端的请求前身份隔离。
		assertSessionGeneration(
			expectedSessionGeneration,
			"Outpatient payment page session changed before records were requested",
		);
		return loadOutpatientPaymentRecords(
			patient.id,
			status,
			expectedSessionGeneration,
		).then((items) => {
			assertSessionGeneration(
				expectedSessionGeneration,
				"Outpatient payment page session changed before records were committed",
			);
			if (
				!loadGuard.isCurrent(effectiveRequestToken) ||
				!isCurrentSelectedPatient(patient.id)
			) {
				return;
			}
			const mappedItems = items.map((item, index) =>
				this.toView(item, index, effectiveRequestToken),
			);
			const visibleItemCount = Math.min(
				OUTPATIENT_PAYMENT_PAGE_SIZE,
				mappedItems.length,
			);
			this.setData({
				selectedPatient: patient,
				patientSessionGeneration: expectedSessionGeneration,
				items: mappedItems,
				visibleItems: mappedItems.slice(0, visibleItemCount),
				visibleItemCount,
				hasMoreItems: visibleItemCount < mappedItems.length,
				error: "",
				canSelectPatient: false,
			});
		});
	},

	/** 切换待缴费/已缴费时只请求当前患者和当前状态。 */
	onStatusTap(event): void {
		const status = event.currentTarget?.dataset?.status;
		if (status !== "unpaid" && status !== "paid") return;
		if (status === this.data.activeStatus) return;
		if (!this.data.selectedPatient) {
			// 首次患者目录仍在读取时，不能用 tab 切换创建新守卫并取消初始
			// owner-scoped 请求；这里只记录用户最后点击的状态，loadPage
			// 确认患者后会读取最新 activeStatus。没有患者且已结束加载时，
			// 只展示明确提示，不凭空发起费用查询。
			this.setData({
				activeStatus: status,
				...(this.data.loading
					? {}
					: {
							error: "请先登录并选择就诊人",
							// 这是页面在没有患者上下文时主动产生的业务状态，
							// 与服务端的 patient-not-bound 语义相同，应提供选择入口。
							canSelectPatient: true,
						}),
			});
			return;
		}
		const selectedPatient = this.data.selectedPatient;
		if (
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(selectedPatient.id)
		) {
			// 另一个页面可能已经换号或换患者，但旧页面仍短暂保留上一轮
			// WXML 卡片。先保留用户刚点击的状态意图，再重新完成 `/me`、
			// 患者目录和当前状态查询；绝不把旧患者对象直接交给 API。
			this.setData({ activeStatus: status });
			void this.loadPage();
			return;
		}
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const requestToken = loadGuard.begin();
		this.setData({
			activeStatus: status,
			loading: true,
			error: "",
			items: [],
			visibleItems: [],
			visibleItemCount: 0,
			hasMoreItems: false,
			canSelectPatient: false,
		});
		// 显式传入用户刚点击的状态，避免微信 setData 尚未完成时仍查询旧 tab。
		this.loadRecords(
			selectedPatient,
			status,
			requestToken,
			this.data.patientSessionGeneration,
		)
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					// tab 查询和首次页面加载共用同一会话事实。若切换 tab
					// 时服务端已经拒绝旧 token，必须先把入口状态收敛为
					// invalid/unavailable，再清空费用列表；否则页面虽然显示
					// 错误，后续“更换就诊人”仍会拿旧的 valid 放行。
					this.setData({
						sessionState: sessionStateAfterAuthenticatedReadError(
							error,
							this.data.sessionState,
							hasPlatformSession(),
						),
					});
					this.showError(error, "门诊缴费记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	/**
	 * 只增加当前完整结果的本地可见窗口。
	 *
	 * 这里不能重新请求 provider，也不能把当前页的部分记录解释成分页事实；
	 * 用户只是继续查看同一次 owner-scoped、状态固定的只读查询结果。
	 */
	onLoadMore(): void {
		// “加载更多”事件可能在刷新、切换缴费状态或更换就诊人之后才
		// 抵达。先阻断加载中的旧事件和没有患者上下文的事件，避免旧按钮
		// 把当前页面的渲染窗口从空态重新改写成不完整的费用视图。
		if (this.data.loading || !this.data.selectedPatient) return;
		const selectedPatient = this.data.selectedPatient;
		if (
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(selectedPatient.id)
		) {
			// 会话或显式患者已经变化时，不能继续展开上一轮费用快照；
			// 重新执行 `/me` → 患者目录 → 当前 tab 查询，保留服务端
			// owner 校验，同时不让旧 UI 事件携带旧患者进入请求。
			void this.loadPage();
			return;
		}
		if (!this.data.hasMoreItems) return;
		const nextCount = Math.min(
			this.data.visibleItemCount + OUTPATIENT_PAYMENT_PAGE_SIZE,
			this.data.items.length,
		);
		if (nextCount <= this.data.visibleItemCount) return;
		this.setData({
			visibleItems: this.data.items.slice(0, nextCount),
			visibleItemCount: nextCount,
			hasMoreItems: nextCount < this.data.items.length,
		});
	},

	onChangePatient(): void {
		navigateToPatientSelector(this.data.sessionState);
	},

	/**
	 * 费用错误态不能通过局部清除恢复。重试必须重新确认会话、患者映射和
	 * 当前费用状态，避免把上一位患者或上一轮状态快照再次带入查询。
	 */
	onRetry(): void {
		void this.loadPage();
	},

	/**
	 * 旧端允许打开院区选择器；当前只确认一个院区，不能伪造可切换数据。
	 * 等正式院区 contract 到齐后，只替换这里的受控选项和后续查询边界。
	 */
	onHospitalTap(): void {
		wx.showToast({ title: "当前仅支持高平市人民医院", icon: "none" });
	},

	/** 待缴费卡片直接展示缴费按钮；费用卡片本身不再打开详情页。 */
	onPaymentTap(event: ViewKeyEvent): void {
		if (!this.isPatientContextCurrent()) return;
		const record = findVisiblePayment(
			this.data.visibleItems,
			event.currentTarget?.dataset?.viewKey,
		);
		const patientId = this.data.selectedPatient?.id;
		if (!record || record.status !== "unpaid" || !patientId) return;
		const pending = readPendingPayment();
		if (isPendingForRecord(pending, patientId, record.recordId)) {
			if (
				pending?.phase === "medical_cash_required" ||
				pending?.phase === "cash_payment"
			) {
				wx.navigateTo({
					url: "/pages/outpatient-medical-settlement/outpatient-medical-settlement",
				});
				return;
			}
			if (pending?.phase === "authorization") {
				const app = getApp<MedicalApp>();
				const authCode = String(
					app?.globalData?.medicalInsuranceAuthCode || "",
				).trim();
				if (authCode) {
					// 回跳结果已经到达但 onShow 尚未完成恢复时，直接把同一
					// 个授权上下文交给结算页，避免点击事件与生命周期竞争。
					void this.resumePendingMedicalPayment();
					return;
				}
				if (pending.orderId) {
					// 已有服务端订单时不能覆盖本地上下文并创建第二笔订单。
					wx.showToast({
						title: "上一笔医保订单正在处理中，请稍后再试",
						icon: "none",
					});
					return;
				}
				// 只有本地授权尚未换成服务端订单的残留上下文，才允许
				// 重新打开支付方式并发起一次全新的医保授权。
				clearPendingPayment();
			}
		}
		this.setData({
			paymentSheetVisible: true,
			paymentRecord: record,
			paymentMethod: "",
			paymentBusy: "",
		});
	},

	onPaymentMethodTap(event: PaymentMethodEvent): void {
		if (this.data.paymentBusy) return;
		const method = event.currentTarget?.dataset?.method;
		if (method !== "medical" && method !== "wechat") return;
		this.setData({ paymentMethod: method });
	},

	onClosePaymentSheet(): void {
		if (this.data.paymentBusy) return;
		this.setData({
			paymentSheetVisible: false,
			paymentRecord: null,
			paymentMethod: "",
		});
	},

	onStopPaymentSheet(): void {
		// 阻止点击半窗口内容时冒泡关闭面板。
	},

	onConfirmPayment(): void {
		if (this.data.paymentBusy) return;
		const method = this.data.paymentMethod;
		const record = this.data.paymentRecord;
		const patientId = this.data.selectedPatient?.id;
		if (!method || !record || !patientId) {
			wx.showToast({ title: "请选择支付方式", icon: "none" });
			return;
		}
		if (!this.isPatientContextCurrent()) return;
		void this.startPayment(method, record, patientId);
	},

	async startPayment(
		method: PaymentMethod,
		record: OutpatientPaymentRecordView,
		patientId: string,
	): Promise<void> {
		if (this.data.paymentBusy) return;
		if (!this.isPatientContextCurrent()) return;
		this.setData({
			paymentSheetVisible: false,
			paymentRecord: null,
			paymentBusy: method,
		});
		showPaymentToast(
			method === "medical"
				? "正在准备医保支付，请在医保小程序完成授权"
				: "正在准备微信支付",
		);
		if (method === "medical") {
			try {
				await startOutpatientMedicalPayment(
					record.recordId,
					patientId,
					(_stage, message) => showPaymentToast(message),
					"mixed",
				);
			} catch (error) {
				showPaymentToast(
					errorMessageWithCode(error, "门诊医保支付未完成，请稍后重试"),
				);
			} finally {
				this.setData({ paymentBusy: "" });
			}
			return;
		}
		try {
			const result = await startOutpatientSelfPay(
				record.recordId,
				patientId,
				(_stage, message) => showPaymentToast(message),
			);
			if (result.data.status === "cash_paid") {
				wx.redirectTo({
					url: paymentResultUrl(patientId, record.recordId, "wechat", {
						totalFen: result.data.totalFen,
					}),
				});
			}
		} catch (error) {
			showPaymentToast(
				errorMessageWithCode(error, "门诊微信支付未完成，请稍后重试"),
			);
		} finally {
			this.setData({ paymentBusy: "" });
		}
	},

	toView(
		record: OutpatientPaymentRecord,
		index: number,
		renderGeneration: number,
	): OutpatientPaymentRecordView {
		return {
			...record,
			viewKey: `outpatient-payment-${renderGeneration}-${index}`,
			amountLabel: formatOutpatientAmountLabel(record.amountFen),
			...(record.spec || record.quantity || record.unitName
				? {
						specQuantityLabel: [
							record.spec,
							record.quantity ? `× ${record.quantity}` : undefined,
							record.unitName,
						]
							.filter(Boolean)
							.join(" "),
					}
				: {}),
			...(record.priceFen !== undefined
				? { priceLabel: formatOutpatientAmountLabel(record.priceFen) }
				: {}),
			...(record.preferentialAmountFen !== undefined
				? {
						preferentialAmountLabel: formatOutpatientAmountLabel(
							record.preferentialAmountFen,
						),
					}
				: {}),
			...(record.ascendAmountFen !== undefined
				? {
						ascendAmountLabel: formatOutpatientAmountLabel(
							record.ascendAmountFen,
						),
					}
				: {}),
			...(record.selfBurdenRatio !== undefined
				? {
						selfBurdenRatioLabel: formatOutpatientRatioLabel(
							record.selfBurdenRatio,
						),
					}
				: {}),
			billDateLabel: formatOutpatientBillDateLabel(record.billDate),
		};
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让费用查询失去回写资格，避免旧金额回写到新页面实例。 */
	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},

	showError(error: unknown, _fallback: string): void {
		const shouldRenderEmptyState = shouldRenderOutpatientEmptyState(error);
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "门诊缴费功能正在完善中，暂时无法使用"
				: error instanceof ApiError &&
						error.code === "outpatient-payment-patient-not-found"
					? "未查询到缴费记录"
					: patientContextErrorMessage(
							error,
							"缴费记录暂时无法获取，请稍后再试",
						);
		const canSelectPatient = isPatientSelectionError(error);
		const clearPatient =
			shouldClearPatientContextAfterError(error, hasPlatformSession()) ||
			canSelectPatient;
		const preservedPatient = clearPatient
			? null
			: preservedPatientForReload(this.data.selectedPatient);
		this.setData({
			// Provider 响应异常仍由服务端和请求遥测记录；患者端只看到和
			// 成功返回空数组一致的结果，避免把内部 10820 投影给用户。
			error: shouldRenderEmptyState ? "" : errorMessageWithCode(error, message),
			// “outpatient-payment-patient-not-found” 表示当前患者没有费用映射，
			// 不等于应该换人；只有统一患者上下文错误才显示选择动作。
			canSelectPatient,
			// 费用查询失败不等于患者选择失效：保留卡片可以让用户知道当前
			// 查询对象是谁，同时把列表收敛为空态。会话/患者上下文错误才清除。
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			items: [],
			visibleItems: [],
			visibleItemCount: 0,
			hasMoreItems: false,
		});
	},

	/** 费用卡片的展示和事件都必须属于当前患者、当前会话代际。 */
	isPatientContextCurrent(): boolean {
		const patientId = this.data.selectedPatient?.id;
		return (
			typeof patientId === "string" &&
			this.data.patientSessionGeneration === getSessionGeneration() &&
			isCurrentSelectedPatient(patientId)
		);
	},
});
