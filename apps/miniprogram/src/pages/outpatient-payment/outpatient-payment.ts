import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadOutpatientPaymentRecords,
	loadPatients,
} from "../../services/dashboard-service";
import { getPageLatestRequestGuard } from "../../services/page-instance-state";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import type {
	OutpatientPaymentPageData,
	OutpatientPaymentRecord,
	OutpatientPaymentRecordView,
	Patient,
} from "../../types";

type OutpatientPaymentPageMethods = {
	loadPage(): Promise<void>;
	loadRecords(
		patient: Patient,
		status: "unpaid" | "paid",
		requestToken?: number,
	): Promise<void>;
	onStatusTap(event: WechatMiniprogram.TouchEvent): void;
	onChangePatient(): void;
	onRecordTap(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toView(record: OutpatientPaymentRecord): OutpatientPaymentRecordView;
};

Page<OutpatientPaymentPageData, OutpatientPaymentPageMethods>({
	data: {
		hasShown: false,
		selectedPatient: null,
		activeStatus: "unpaid",
		items: [],
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
		// 患者切换期间不展示上一位患者的费用，避免身份和金额短暂错配。
		this.setData({
			loading: true,
			error: "",
			selectedPatient: null,
			items: [],
		});
		return loadPatients()
			.then((patients) => {
				if (!loadGuard.isCurrent(requestToken)) return;
				const patient = resolveStoredPatientSelection(patients).patient;
				if (!patient) {
					throw new ApiError("请先登录并选择就诊人", {
						code: "patient-selection-required",
					});
				}
				this.setData({ selectedPatient: patient });
				return this.loadRecords(patient, this.data.activeStatus, requestToken);
			})
			.catch((error) => {
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
	): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "outpatient-payment");
		const effectiveRequestToken = requestToken ?? loadGuard.begin();
		// 查询状态必须来自本次操作的快照，不能依赖 setData 后的异步页面状态。
		return loadOutpatientPaymentRecords(patient.id, status).then((items) => {
			if (!loadGuard.isCurrent(effectiveRequestToken)) return;
			this.setData({
				items: items.map((item) => this.toView(item)),
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
		this.setData({ activeStatus: status, loading: true, error: "", items: [] });
		// 显式传入用户刚点击的状态，避免微信 setData 尚未完成时仍查询旧 tab。
		this.loadRecords(this.data.selectedPatient, status, requestToken)
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "门诊缴费记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	/** 只读阶段不伪造支付调起；真正支付接入医保/微信订单后再开放。 */
	onRecordTap(): void {
		wx.showToast({ title: "支付流程正在迁移中", icon: "none" });
	},

	toView(record): OutpatientPaymentRecordView {
		return {
			...record,
			amountLabel: `¥${(record.amountFen / 100).toFixed(2)}`,
		};
	},

	onPullDownRefresh(): void {
		this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "门诊缴费服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看门诊缴费记录";
			} else if (error.code === "outpatient-payment-patient-not-found") {
				message = "当前就诊人暂未建立门诊缴费映射";
			} else {
				message = safeApiErrorMessage(error, fallback);
			}
		}
		this.setData({ error: message, items: [] });
	},
});
