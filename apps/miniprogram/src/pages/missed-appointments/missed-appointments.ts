import { ApiError } from "../../services/api-client";
import {
	isMissedAppointment,
	toAppointmentRecordView,
} from "../../services/appointment-record-view";
import {
	loadAppointmentRecords,
	loadCurrentPatient,
} from "../../services/dashboard-service";
import { getPageLatestRequestGuard } from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import type {
	AppointmentRecord,
	AppointmentRecordView,
	MissedAppointmentsPageData,
} from "../../types";

/** 爽约记录也使用本地渲染窗口；筛选结果本身仍由服务端状态事实决定。 */
const MISSED_APPOINTMENT_PAGE_SIZE = 10;

type MissedAppointmentsPageMethods = {
	loadRecords(): Promise<void>;
	onLoadMore(): void;
	onChangePatient(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toRecordView(record: AppointmentRecord, index: number): AppointmentRecordView;
};

Page<MissedAppointmentsPageData, MissedAppointmentsPageMethods>({
	data: {
		hasShown: false,
		selectedPatient: null,
		records: [],
		visibleRecords: [],
		visibleRecordCount: 0,
		hasMoreRecords: false,
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
	 * 中国标准时间过去 90 天，避免页面自行扩大查询范围或把未来预约
	 * 混入爽约筛选。
	 */
	loadRecords(): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "missed-appointments");
		const requestToken = loadGuard.begin();
		this.setData({
			loading: true,
			error: "",
			// 爽约记录是当前患者预约历史的派生结果；新患者查询开始后不能继续
			// 展示上一位患者的卡片或记录，避免身份和列表短暂错配。
			selectedPatient: null,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
		});

		return loadCurrentPatient()
			.then((patient) => {
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return undefined;
				}

				// 患者卡片不能先于爽约记录提交。否则患者切换发生在 Provider
				// 请求期间时，旧响应虽然会被丢弃，旧患者卡片仍可能短暂留在页面，
				// 形成“卡片属于 A、列表等待 B”的错误业务快照。
				return loadAppointmentRecords(patient.id, new Date(), "missed").then(
					(records) => ({ patient, records }),
				);
			})
			.then((result) => {
				if (
					!result ||
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(result.patient.id)
				) {
					return;
				}
				const { patient, records } = result;
				// 只筛选服务端标准化后的 missed，不能使用客户端 provider 数字状态。
				const missedRecords = records
					.filter(isMissedAppointment)
					.map((record, index) => this.toRecordView(record, index));
				const visibleRecordCount = Math.min(
					MISSED_APPOINTMENT_PAGE_SIZE,
					missedRecords.length,
				);
				this.setData({
					records: missedRecords,
					visibleRecords: missedRecords.slice(0, visibleRecordCount),
					visibleRecordCount,
					hasMoreRecords: visibleRecordCount < missedRecords.length,
					selectedPatient: patient,
					error: "",
				});
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

	/** 只展开当前已筛选的 missed 结果，不重新查询或改变状态判定。 */
	onLoadMore(): void {
		const nextCount = Math.min(
			this.data.visibleRecordCount + MISSED_APPOINTMENT_PAGE_SIZE,
			this.data.records.length,
		);
		this.setData({
			visibleRecords: this.data.records.slice(0, nextCount),
			visibleRecordCount: nextCount,
			hasMoreRecords: nextCount < this.data.records.length,
		});
	},

	/** 页面边界只负责把稳定状态枚举翻译成中文显示文案。 */
	toRecordView(
		record: AppointmentRecord,
		index: number,
	): AppointmentRecordView {
		return toAppointmentRecordView(record, index, "missed-appointment-record");
	},

	onChangePatient(): void {
		navigateToPatientSelector();
	},

	onPullDownRefresh(): void {
		this.loadRecords().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "爽约记录服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			selectedPatient: null,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
		});
	},
});
