import { ApiError, safeApiErrorMessage } from "../../services/api-client";
import { toAppointmentRecordView } from "../../services/appointment-record-view";
import {
	loadAppointmentRecords,
	loadPatients,
} from "../../services/dashboard-service";
import { getPageLatestRequestGuard } from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import type {
	AppointmentRecord,
	AppointmentRecordsPageData,
	AppointmentRecordView,
} from "../../types";

/**
 * 预约历史只读结果的本地渲染批次大小。
 *
 * API 仍然按固定日期窗口返回完整结果；这里不发送 page/cursor，也不把
 * “加载更多”解释成 provider 分页，只降低小程序首帧建立 WXML 渲染树的成本。
 */
const APPOINTMENT_RECORD_PAGE_SIZE = 10;

type AppointmentRecordsPageMethods = {
	loadRecords(): Promise<void>;
	onLoadMore(): void;
	onChangePatient(): void;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
	toRecordView(record: AppointmentRecord, index: number): AppointmentRecordView;
};

Page<AppointmentRecordsPageData, AppointmentRecordsPageMethods>({
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
		// 首次展示标记必须绑定当前页面实例，不能让不同页面栈共享状态。
		this.setData({ hasShown: false });
		this.loadRecords();
	},

	/** 从选择页返回后重新读取当前患者的记录；首次 onShow 不重复请求。 */
	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		this.loadRecords();
	},

	/** 先从平台目录确认当前患者，再以内部 patientId 请求记录。 */
	loadRecords(): Promise<void> {
		const loadGuard = getPageLatestRequestGuard(this, "appointment-records");
		const requestToken = loadGuard.begin();
		// 患者切换或从选择页返回时，旧记录不能继续和新一轮目录读取并存；
		// 只有当前患者和当前请求都确认成功后，页面才重新展示记录。
		this.setData({
			loading: true,
			error: "",
			selectedPatient: null,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
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
				return loadAppointmentRecords(patient.id).then((records) => {
					if (!loadGuard.isCurrent(requestToken)) return;
					const mappedRecords = records.map((record, index) =>
						this.toRecordView(record, index),
					);
					const visibleRecordCount = Math.min(
						APPOINTMENT_RECORD_PAGE_SIZE,
						mappedRecords.length,
					);
					this.setData({
						selectedPatient: patient,
						records: mappedRecords,
						visibleRecords: mappedRecords.slice(0, visibleRecordCount),
						visibleRecordCount,
						hasMoreRecords: visibleRecordCount < mappedRecords.length,
						error: "",
					});
				});
			})
			.catch((error) => {
				if (loadGuard.isCurrent(requestToken)) {
					this.showError(error, "挂号记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	/** 只展开当前 owner-scoped 查询已经取得的结果，不重新请求 provider。 */
	onLoadMore(): void {
		const nextCount = Math.min(
			this.data.visibleRecordCount + APPOINTMENT_RECORD_PAGE_SIZE,
			this.data.records.length,
		);
		this.setData({
			visibleRecords: this.data.records.slice(0, nextCount),
			visibleRecordCount: nextCount,
			hasMoreRecords: nextCount < this.data.records.length,
		});
	},

	/** 记录状态在页面边界翻译，服务端 contract 仍保持稳定英文枚举。 */
	toRecordView(
		record: AppointmentRecord,
		index: number,
	): AppointmentRecordView {
		return toAppointmentRecordView(record, index, "appointment-record");
	},

	onChangePatient(): void {
		navigateToPatientSelector();
	},

	onPullDownRefresh(): void {
		this.loadRecords().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			if (error.code === "dependency-not-configured") {
				message = "预约记录服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看挂号记录";
			} else {
				message = safeApiErrorMessage(error, fallback);
			}
		}
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
