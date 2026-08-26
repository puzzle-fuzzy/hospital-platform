import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	isMissedAppointment,
	toAppointmentRecordView,
} from "../../services/appointment-record-view";
import {
	loadAppointmentRecords,
	loadCurrentPatientForOwner,
} from "../../services/dashboard-service";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import {
	isCurrentSelectedPatient,
	patientContextErrorMessage,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
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
	onRetry(): void;
	onChangePatient(): void;
	onPullDownRefresh(): void;
	onUnload(): void;
	isPatientContextCurrent(): boolean;
	showError(error: unknown, fallback: string): void;
	toRecordView(
		record: AppointmentRecord,
		index: number,
		renderGeneration: number,
	): AppointmentRecordView;
};

Page<MissedAppointmentsPageData, MissedAppointmentsPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
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
		registerPageSessionResetListener(this, () => {
			// 会话轮换时不能继续显示上一账号的爽约记录；这里只清理本地
			// 快照，不在新 token 写入前自动发起患者查询。
			this.setData({
				sessionState: "checking",
				selectedPatient: null,
				patientSessionGeneration: -1,
				records: [],
				visibleRecords: [],
				visibleRecordCount: 0,
				hasMoreRecords: false,
				loading: false,
				error: "登录账号已切换，请重新读取就诊人",
			});
		});
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
		// 爽约记录和普通预约历史共享患者上下文，但页面实例不同；必须把
		// `/me`、患者目录和筛选结果绑定在同一会话代际，防止跨页换号串快照。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			// 爽约记录是当前患者预约历史的派生结果；新患者查询开始后不能继续
			// 展示上一位患者的卡片或记录，避免身份和列表短暂错配。
			selectedPatient: null,
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
		});

		// 先验证平台会话，再读取患者和预约历史；这让页面入口与请求使用同一
		// 四态会话事实，避免本地 token 存在时错误放行“更换就诊人”。
		return getCurrentUser()
			.then((currentUser) => {
				if (!loadGuard.isCurrent(requestToken)) return undefined;
				expectedOwnerId = currentUser.data.user.id;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(expectedOwnerId);
			})
			.then((patientContext) => {
				if (!patientContext) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Missed appointment page session changed before patient context was committed",
				);
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return undefined;
				}
				// 患者目录返回后仍要在业务请求前确认会话没有漂移；否则旧
				// patientId 会先进入预约查询，再由服务端被动拒绝。
				assertSessionGeneration(
					expectedSessionGeneration,
					"Missed appointment page session changed before records were requested",
				);

				// 患者卡片不能先于爽约记录提交。否则患者切换发生在 Provider
				// 请求期间时，旧响应虽然会被丢弃，旧患者卡片仍可能短暂留在页面，
				// 形成“卡片属于 A、列表等待 B”的错误业务快照。
				return loadAppointmentRecords(
					patient.id,
					new Date(),
					"missed",
					expectedSessionGeneration,
				).then((records) => {
					assertSessionGeneration(
						expectedSessionGeneration,
						"Missed appointment page session changed before records were committed",
					);
					return { patient, records };
				});
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
					.map((record, index) =>
						this.toRecordView(record, index, requestToken),
					);
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
					patientSessionGeneration: expectedSessionGeneration,
					error: "",
				});
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
		// 刷新或切换就诊人时，旧 WXML 事件可能晚于当前页面状态抵达；
		// 加载中和没有患者时都没有可安全展开的已确认读模型。
		if (this.data.loading || !this.data.selectedPatient) return;
		if (!this.isPatientContextCurrent()) {
			// 旧患者的本地分页窗口不能跨会话继续展开；重新读取当前 owner
			// 的患者和爽约派生结果，避免把视觉分页误当作仍然有效的业务事实。
			void this.loadRecords();
			return;
		}
		if (!this.data.hasMoreRecords) return;
		const nextCount = Math.min(
			this.data.visibleRecordCount + MISSED_APPOINTMENT_PAGE_SIZE,
			this.data.records.length,
		);
		if (nextCount <= this.data.visibleRecordCount) return;
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
		renderGeneration: number,
	): AppointmentRecordView {
		return toAppointmentRecordView(
			record,
			index,
			"missed-appointment-record",
			renderGeneration,
		);
	},

	onChangePatient(): void {
		navigateToPatientSelector(this.data.sessionState);
	},

	/**
	 * 爽约记录来自当前患者的预约历史派生结果；错误态重试必须重新完成
	 * 患者上下文和历史读取，不能在本地把旧列表清空后假装得到空结果。
	 */
	onRetry(): void {
		void this.loadRecords();
	},

	onPullDownRefresh(): void {
		this.loadRecords().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让尚未完成的患者范围请求失去回写资格。 */
	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},

	/** 爽约列表的本地展开和患者入口必须与提交列表时的会话代际一致。 */
	isPatientContextCurrent(): boolean {
		const patientId = this.data.selectedPatient?.id;
		return (
			typeof patientId === "string" &&
			this.data.patientSessionGeneration === getSessionGeneration() &&
			isCurrentSelectedPatient(patientId)
		);
	},

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "爽约记录服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			selectedPatient: null,
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
		});
	},
});
