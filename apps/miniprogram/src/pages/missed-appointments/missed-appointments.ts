import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import {
	loadAppointmentRecords,
	loadPatients,
} from "../../services/dashboard-service";
import { createLatestRequestGuard } from "../../services/latest-request-guard";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import type {
	AppointmentRecord,
	AppointmentRecordView,
	MissedAppointmentsPageData,
} from "../../types";

type MissedAppointmentsPageMethods = {
	loadRecords(): Promise<void>;
	onChangePatient(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toRecordView(record: AppointmentRecord, index: number): AppointmentRecordView;
};

const STATUS_LABELS = Object.freeze({
	scheduled: "已预约",
	cancelled: "已取消",
	completed: "已完成",
	missed: "已爽约",
	unknown: "状态未知",
} as const);

const loadGuard = createLatestRequestGuard();

Page<MissedAppointmentsPageData, MissedAppointmentsPageMethods>({
	data: {
		hasShown: false,
		selectedPatient: null,
		records: [],
		loading: true,
		error: "",
	},

	onLoad() {
		// 首次展示标记必须绑定当前页面实例，避免和预约记录页串状态。
		this.setData({ hasShown: false });
		this.loadRecords();
	},

	/** 从选择页返回后重新读取患者范围；首次 onShow 不重复请求。 */
	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		this.loadRecords();
	},

	/**
	 * 爽约记录只能从平台预约历史读模型派生。
	 *
	 * 旧端直接在小程序比较 provider 数字状态 `4`，容易把 provider 细节、
	 * 患者标识和业务判断一起泄漏到客户端。新端只接受服务端已经完成归一化
	 * 的 `missed` 枚举；`unknown` 永远不会被猜测成爽约，空列表也不代表
	 * provider 已经完整返回了历史数据。查询窗口由 dashboard service 固定为
	 * 中国标准时间近 90 天，避免页面自行扩大查询范围。
	 */
	loadRecords(): Promise<void> {
		const requestToken = loadGuard.begin();
		this.setData({
			loading: true,
			error: "",
			records: [],
		});

		return loadPatients()
			.then((patients) => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				const patient = resolveStoredPatientSelection(patients).patient;
				if (!patient) {
					throw new ApiError("请先登录并选择就诊人", {
						code: "patient-selection-required",
					});
				}

				this.setData({ selectedPatient: patient });
				return loadAppointmentRecords(patient.id);
			})
			.then((records) => {
				if (!records || !loadGuard.isCurrent(requestToken)) return;
				// 只筛选服务端标准化后的 missed，不能使用客户端 provider 数字状态。
				const missedRecords = records
					.filter((record) => record.status === "missed")
					.map((record, index) => this.toRecordView(record, index));
				this.setData({ records: missedRecords, error: "" });
			})
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "爽约记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) {
					this.setData({ loading: false });
				}
			});
	},

	/** 页面边界只负责把稳定状态枚举翻译成中文显示文案。 */
	toRecordView(
		record: AppointmentRecord,
		index: number,
	): AppointmentRecordView {
		return {
			...record,
			// 爽约页同样只拿到只读摘要；serialNumber 不是可靠的列表主键。
			viewKey: `missed-appointment-record-${index}`,
			statusLabel: STATUS_LABELS[record.status],
			statusClass: `record-status-${record.status}`,
		};
	},

	onChangePatient(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onPullDownRefresh(): void {
		this.loadRecords().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "爽约记录服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看爽约记录";
			} else {
				message = safeApiErrorMessage(error, fallback);
			}
		}
		this.setData({ error: message, selectedPatient: null, records: [] });
	},
});
