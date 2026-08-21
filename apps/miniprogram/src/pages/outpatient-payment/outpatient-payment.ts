import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	formatOutpatientBillDateLabel,
	loadCurrentPatient,
	loadOutpatientPaymentRecords,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import { getSessionGeneration } from "../../services/session-generation";
import { sessionVerificationStateFromError } from "../../services/session-service";
import type {
	OutpatientPaymentPageData,
	OutpatientPaymentRecord,
	OutpatientPaymentRecordView,
	Patient,
} from "../../types";

/**
 * 门诊费用只读结果的本地渲染批次大小。
 *
 * 当前 API 没有服务端 cursor/page，`items` 仍然保存本次完整查询结果，
 * 以免把本地分批误解为 provider 分页或改变费用总数；只有 `visibleItems`
 * 控制 WXML 首帧和后续渲染成本。支付、医保和结算状态不由这个批次推导。
 */
const OUTPATIENT_PAYMENT_PAGE_SIZE = 10;

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
	onChangePatient(): void;
	onRecordTap(event: WechatMiniprogram.TouchEvent): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	showError(error: unknown, fallback: string): void;
	toView(record: OutpatientPaymentRecord): OutpatientPaymentRecordView;
};

Page<OutpatientPaymentPageData, OutpatientPaymentPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		activeStatus: "unpaid",
		items: [],
		visibleItems: [],
		visibleItemCount: 0,
		hasMoreItems: false,
		loading: true,
		error: "",
	},

	onLoad() {
		// 首次展示标记必须绑定当前页面实例，不能在多层页面栈之间共享。
		this.setData({ hasShown: false });
		this.loadPage();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		this.loadPage();
	},

	/** 先确认当前患者归属，再读取门诊费用，避免把临床患者映射交给页面。 */
	loadPage(): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const requestToken = loadGuard.begin();
		// 费用页面的患者卡片、状态标签和金额必须来自同一会话代际；
		// 另一个页面换号时，不能只靠当前页面 requestToken 继续拼接旧快照。
		let expectedSessionGeneration = -1;
		// 患者切换期间不展示上一位患者的费用，避免身份和金额短暂错配。
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: null,
			items: [],
			visibleItems: [],
			visibleItemCount: 0,
			hasMoreItems: false,
		});
		// 先完成服务端 `/me` 验证，再读取患者目录；否则页面入口会在本地
		// token 已过期时仍被误认为可切换患者，随后才在费用请求中暴露 401。
		return getCurrentUser()
			.then(() => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatient();
			})
			.then((patient) => {
				if (!patient) return;
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
				this.setData({ selectedPatient: patient });
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
						sessionState: sessionVerificationStateFromError(error),
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

	loadRecords(
		patient: Patient,
		status: "unpaid" | "paid",
		requestToken?: number,
		expectedSessionGeneration = getSessionGeneration(),
	): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const effectiveRequestToken = requestToken ?? loadGuard.begin();
		// 查询状态必须来自本次操作的快照，不能依赖 setData 后的异步页面状态。
		if (!isCurrentSelectedPatient(patient.id)) return Promise.resolve();
		return loadOutpatientPaymentRecords(patient.id, status).then((items) => {
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
			const mappedItems = items.map((item) => this.toView(item));
			const visibleItemCount = Math.min(
				OUTPATIENT_PAYMENT_PAGE_SIZE,
				mappedItems.length,
			);
			this.setData({
				selectedPatient: patient,
				items: mappedItems,
				visibleItems: mappedItems.slice(0, visibleItemCount),
				visibleItemCount,
				hasMoreItems: visibleItemCount < mappedItems.length,
				error: "",
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
				...(this.data.loading ? {} : { error: "请先登录并选择就诊人" }),
			});
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
		});
		// 显式传入用户刚点击的状态，避免微信 setData 尚未完成时仍查询旧 tab。
		this.loadRecords(this.data.selectedPatient, status, requestToken)
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					// tab 查询和首次页面加载共用同一会话事实。若切换 tab
					// 时服务端已经拒绝旧 token，必须先把入口状态收敛为
					// invalid/unavailable，再清空费用列表；否则页面虽然显示
					// 错误，后续“更换就诊人”仍会拿旧的 valid 放行。
					this.setData({
						sessionState: sessionVerificationStateFromError(error),
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
		const nextCount = Math.min(
			this.data.visibleItemCount + OUTPATIENT_PAYMENT_PAGE_SIZE,
			this.data.items.length,
		);
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
	 * 只读阶段不伪造支付调起；真正支付接入医保/微信订单后再开放。
	 *
	 * 待缴记录和已缴记录虽然共用同一张卡片，但业务事实不同：前者只能
	 * 提示支付契约未开放，后者不能再次提示“支付”，避免把已缴状态误导成
	 * 待支付。两种情况都不调用 `wx.requestPayment`，也不修改服务端状态。
	 */
	onRecordTap(event): void {
		const status = event.currentTarget?.dataset?.status;
		const title =
			status === "paid"
				? "已缴费记录详情正在迁移中"
				: status === "unpaid"
					? "支付流程正在迁移中"
					: "费用记录详情正在迁移中";
		wx.showToast({ title, icon: "none" });
	},

	toView(record): OutpatientPaymentRecordView {
		return {
			...record,
			amountLabel: formatOutpatientAmountLabel(record.amountFen),
			billDateLabel: formatOutpatientBillDateLabel(record.billDate),
		};
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让费用查询失去回写资格，避免旧金额回写到新页面实例。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "门诊缴费服务暂未配置完成，请联系管理员"
				: error instanceof ApiError &&
						error.code === "outpatient-payment-patient-not-found"
					? "当前就诊人暂未建立门诊缴费映射"
					: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			// 费用查询失败时，当前页面没有一份与患者卡片同时确认的费用读模型。
			// 即使失败发生在已缴/待缴切换，也不能保留上一轮卡片让用户误以为
			// 当前列表属于这位患者；WXML 的空态会提供重新选择入口。
			selectedPatient: null,
			items: [],
			visibleItems: [],
			visibleItemCount: 0,
			hasMoreItems: false,
		});
	},
});
