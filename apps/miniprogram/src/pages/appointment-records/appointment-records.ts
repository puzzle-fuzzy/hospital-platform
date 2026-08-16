import { ApiError } from "../../services/api-client";
import {
	loadAppointmentRecords,
	loadPatients,
} from "../../services/dashboard-service";
import { createLatestRequestGuard } from "../../services/latest-request-guard";
import { resolveStoredPatientSelection } from "../../services/patient-selection-service";
import type {
	AppointmentRecord,
	AppointmentRecordsPageData,
	AppointmentRecordView,
} from "../../types";

type AppointmentRecordsPageMethods = {
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
	missed: "未就诊",
	unknown: "状态未知",
} as const);

let isFirstShow = true;
const loadGuard = createLatestRequestGuard();

Page<AppointmentRecordsPageData, AppointmentRecordsPageMethods>({
	data: {
		selectedPatient: null,
		records: [],
		loading: true,
		error: "",
	},

	onLoad() {
		isFirstShow = true;
		this.loadRecords();
	},

	/** 从选择页返回后重新读取当前患者的记录；首次 onShow 不重复请求。 */
	onShow() {
		if (isFirstShow) {
			isFirstShow = false;
			return;
		}
		this.loadRecords();
	},

	/** 先从平台目录确认当前患者，再以内部 patientId 请求记录。 */
	loadRecords(): Promise<void> {
		const requestToken = loadGuard.begin();
		this.setData({ loading: true, error: "" });
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
					this.setData({
						selectedPatient: patient,
						records: records.map((record, index) =>
							this.toRecordView(record, index),
						),
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

	/** 记录状态在页面边界翻译，服务端 contract 仍保持稳定英文枚举。 */
	toRecordView(
		record: AppointmentRecord,
		index: number,
	): AppointmentRecordView {
		const statusLabel = STATUS_LABELS[record.status];
		return {
			...record,
			// provider 只读摘要没有稳定公开记录 ID，流水号也可能缺失或重复；
			// 这里用本次完整响应内的索引保证 WXML key 唯一，不把它当业务标识。
			viewKey: `appointment-record-${index}`,
			statusLabel,
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
				message = "预约记录服务暂未配置完成，请联系管理员";
			} else if (error.code === "patient-selection-required") {
				message = "请先选择就诊人，再查看挂号记录";
			} else {
				message = error.message;
			}
		}
		this.setData({ error: message, selectedPatient: null, records: [] });
	},
});
