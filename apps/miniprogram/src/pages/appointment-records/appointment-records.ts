import departmentLocations from "../../data/department-location";
import { ApiError, getCurrentUser } from "../../services/api-client";
import {
	filterAppointmentRecords,
	isAppointmentRecordTabAvailable,
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
	AppointmentRecordsPageData,
	AppointmentRecordTab,
	AppointmentRecordView,
	DepartmentLocationView,
	ViewKeyEvent,
} from "../../types";

/**
 * 预约历史只读结果的本地渲染批次大小。
 *
 * API 仍然按固定日期窗口返回完整结果；这里不发送 page/cursor，也不把
 * “加载更多”解释成 provider 分页，只降低小程序首帧建立 WXML 渲染树的成本。
 */
const APPOINTMENT_RECORD_PAGE_SIZE = 10;

/** 当前原生端仍是单院区静态医院入口，不能凭页面参数猜测其他院区。 */
const DEFAULT_HOSPITAL_NAME = "高平市人民医院";

type AppointmentRecordsPageMethods = {
	loadRecords(): Promise<void>;
	onLoadMore(): void;
	onRetry(): void;
	onTabTap(event: WechatMiniprogram.TouchEvent): void;
	onChangePatient(): void;
	onHospitalTap(): void;
	onHospitalSelect(): void;
	closeHospitalModal(): void;
	stopHospitalPropagation(): void;
	onRecordTap(event: WechatMiniprogram.TouchEvent): void;
	stopRecordActionPropagation(): void;
	onPreVisit(event: WechatMiniprogram.TouchEvent): void;
	onHospitalGuide(event: WechatMiniprogram.TouchEvent): void;
	closeLocationModal(): void;
	stopLocationPropagation(): void;
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

function removeOutpatient(text: string): string {
	return text.replace(/门诊/g, "").trim();
}

/**
 * 旧端的院内导航是静态科室位置查询，不是实时路线规划。
 * 继续使用已随旧端审核过的静态资料，匹配不到时明确展示空结果，不能猜楼层。
 */
function searchDepartmentLocation(
	department: string,
): DepartmentLocationView[] {
	const cleanedDepartment = removeOutpatient(department);
	if (!cleanedDepartment) return [];

	const results: DepartmentLocationView[] = [];
	for (const [name, location] of Object.entries(departmentLocations)) {
		const cleanedName = removeOutpatient(name);
		if (
			cleanedName === cleanedDepartment ||
			cleanedName.includes(cleanedDepartment) ||
			cleanedDepartment.includes(cleanedName)
		) {
			results.push({ department: name, location });
		}
	}

	return results.sort((left, right) => {
		const leftName = removeOutpatient(left.department);
		const rightName = removeOutpatient(right.department);
		if (leftName === cleanedDepartment && rightName !== cleanedDepartment)
			return -1;
		if (leftName !== cleanedDepartment && rightName === cleanedDepartment)
			return 1;
		return leftName.length - rightName.length;
	});
}

function getVisibleRecords(
	records: readonly AppointmentRecordView[],
	tab: AppointmentRecordTab,
): {
	visibleRecords: AppointmentRecordView[];
	visibleRecordCount: number;
	hasMoreRecords: boolean;
} {
	const filteredRecords = filterAppointmentRecords(records, tab);
	const visibleRecordCount = Math.min(
		APPOINTMENT_RECORD_PAGE_SIZE,
		filteredRecords.length,
	);
	return {
		visibleRecords: filteredRecords.slice(0, visibleRecordCount),
		visibleRecordCount,
		hasMoreRecords: visibleRecordCount < filteredRecords.length,
	};
}

/**
 * 从当前可见窗口按视图 key 回查记录。
 *
 * WXML 的 `index` 只代表当次数组位置；患者切换、刷新或异步回写后，旧
 * 事件携带的数字可能命中新患者的另一张卡片。视图 key 带有本页请求令牌，
 * 因此只能命中当前渲染批次仍存在的记录，不能被当作服务端业务主键使用。
 */
function findVisibleRecord(
	records: readonly AppointmentRecordView[],
	viewKey: unknown,
): AppointmentRecordView | undefined {
	if (typeof viewKey !== "string" || !viewKey) return undefined;
	return records.find((record) => record.viewKey === viewKey);
}

Page<AppointmentRecordsPageData, AppointmentRecordsPageMethods>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
		records: [],
		visibleRecords: [],
		visibleRecordCount: 0,
		hasMoreRecords: false,
		activeTab: "online",
		hospitalName: DEFAULT_HOSPITAL_NAME,
		showHospitalModal: false,
		showLocationModal: false,
		locationResults: [],
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
		// `/me`、患者目录和预约记录必须属于同一会话代际；页面守卫只隔离
		// 当前实例的刷新，不能覆盖另一个页面完成换号后的跨请求组合问题。
		let expectedSessionGeneration = -1;
		let expectedOwnerId = "";
		// 患者切换或从选择页返回时，旧记录不能继续和新一轮目录读取并存；
		// 只有当前患者和当前请求都确认成功后，页面才重新展示记录。
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: null,
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
			showHospitalModal: false,
			showLocationModal: false,
			locationResults: [],
		});
		// 患者业务页不能把 loadCurrentPatient 内部自动登录当作入口授权事实；
		// 先单独完成 `/me` 验证，页面上的“更换就诊人”才有可传递的四态状态。
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
					"Appointment page session changed before patient context was committed",
				);
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return;
				}
				// 代际可能在患者目录 helper 返回后、业务请求开始前发生变化；
				// 先在请求前失败，不能把旧患者 ID 交给新会话再等待服务端拒绝。
				assertSessionGeneration(
					expectedSessionGeneration,
					"Appointment page session changed before records were requested",
				);
				return loadAppointmentRecords(
					patient.id,
					new Date(),
					"history",
					expectedSessionGeneration,
					this.data.activeTab,
				).then((records) => {
					assertSessionGeneration(
						expectedSessionGeneration,
						"Appointment page session changed before records were committed",
					);
					if (
						!loadGuard.isCurrent(requestToken) ||
						!isCurrentSelectedPatient(patient.id)
					) {
						return;
					}
					const mappedRecords = records.map((record, index) =>
						this.toRecordView(record, index, requestToken),
					);
					const visibleState = getVisibleRecords(
						mappedRecords,
						this.data.activeTab,
					);
					this.setData({
						selectedPatient: patient,
						patientSessionGeneration: expectedSessionGeneration,
						records: mappedRecords,
						...visibleState,
						error: "",
					});
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
					this.showError(error, "挂号记录加载失败");
				}
			})
			.finally(() => {
				if (loadGuard.isCurrent(requestToken)) this.setData({ loading: false });
			});
	},

	/** 只展开当前 owner-scoped 查询已经取得的结果，不重新请求 provider。 */
	onLoadMore(): void {
		// 旧 WXML 事件可能在刷新、切换患者或切换标签期间抵达；加载中
		// 不处理，避免重复触发组合读取或将半成品快照写回可见列表。
		if (this.data.loading || !this.data.selectedPatient) return;
		if (!this.isPatientContextCurrent()) {
			// 页面停留期间若另一页完成了换号，不能继续展开旧患者的本地快照；
			// 重新走 `/me` → 患者目录 → 记录组合读取，避免视觉状态先于业务事实漂移。
			void this.loadRecords();
			return;
		}
		if (!this.data.hasMoreRecords) return;
		const filteredRecords = filterAppointmentRecords(
			this.data.records,
			this.data.activeTab,
		);
		const nextCount = Math.min(
			this.data.visibleRecordCount + APPOINTMENT_RECORD_PAGE_SIZE,
			filteredRecords.length,
		);
		if (nextCount <= this.data.visibleRecordCount) return;
		this.setData({
			visibleRecords: filteredRecords.slice(0, nextCount),
			visibleRecordCount: nextCount,
			hasMoreRecords: nextCount < filteredRecords.length,
		});
	},

	/**
	 * 旧端双标签分别对应两个 Provider 只读查询范围。
	 *
	 * 服务端已确认“全部挂号”的渠道 4 成功包络和历史返回语义；页面不接触
	 * 渠道数字，只表达 `all` 业务范围，并在切换时重新读取对应数据。
	 */
	onTabTap(event: WechatMiniprogram.TouchEvent): void {
		const tab = event.currentTarget?.dataset?.tab;
		if (tab !== "online" && tab !== "all") return;
		const activeTab = tab as AppointmentRecordTab;
		if (!isAppointmentRecordTabAvailable(activeTab)) {
			wx.showToast({ title: "挂号范围暂不可用", icon: "none" });
			return;
		}
		if (this.data.selectedPatient && !this.isPatientContextCurrent()) {
			// 标签切换虽然是本地动作，但它会改变当前列表视图；旧会话的列表
			// 不应在新会话已经建立后继续被用户消费。
			void this.loadRecords();
			return;
		}
		this.setData({ activeTab });
		// 切换标签必须重新请求对应 Provider 范围，不能把在线结果复制成全部。
		void this.loadRecords();
	},

	/** 记录状态在页面边界翻译，服务端 contract 仍保持稳定英文枚举。 */
	toRecordView(
		record: AppointmentRecord,
		index: number,
		renderGeneration: number,
	): AppointmentRecordView {
		return toAppointmentRecordView(
			record,
			index,
			"appointment-record",
			renderGeneration,
		);
	},

	onChangePatient(): void {
		navigateToPatientSelector(this.data.sessionState);
	},

	/**
	 * 错误态的重试必须重新执行 `/me`、患者目录和预约记录完整链路，
	 * 不能只清空 error 或复用上一轮患者快照；这样才能重新建立同一会话
	 * 代际下的患者与挂号记录组合事实。
	 */
	onRetry(): void {
		void this.loadRecords();
	},

	/**
	 * 旧端院区行可点击；当前只有一个已经确认的院区，因此只打开单项面板。
	 * 这里不从页面参数或 provider 响应猜测院区列表，避免视觉入口越过业务契约。
	 */
	onHospitalTap(): void {
		this.setData({ showHospitalModal: true });
	},

	/** 单院区面板中的确认项只关闭面板，不发起额外 provider 请求。 */
	onHospitalSelect(): void {
		this.setData({ showHospitalModal: false });
	},

	closeHospitalModal(): void {
		this.setData({ showHospitalModal: false });
	},

	/** 面板内容阻止遮罩层关闭，保持旧端底部弹层的点击边界。 */
	stopHospitalPropagation(): void {
		// `catchtap` 已经阻止冒泡；保留显式方法让 WXML 交互边界可审计。
	},

	/**
	 * 旧端卡片点击会打开挂号详情；新 contract 没有稳定的详情引用，
	 * 所以这里必须给出明确的迁移状态，不能把 WXML 的列表索引拼成详情 URL。
	 */
	onRecordTap(event: ViewKeyEvent): void {
		if (!this.isPatientContextCurrent()) return;
		const record = findVisibleRecord(
			this.data.visibleRecords,
			event.currentTarget?.dataset?.viewKey,
		);
		if (!record) return;
		wx.showToast({ title: "挂号详情暂未开放", icon: "none" });
	},

	/** 操作按钮只执行自身动作，不能继续冒泡触发卡片详情提示。 */
	stopRecordActionPropagation(): void {
		// `catchtap` 已经完成阻止冒泡；保留方法让 WXML 的交互边界可审计。
	},

	/** 旧端预问诊目标页尚未完成独立 contract，保留入口位置但不伪造跳转。 */
	onPreVisit(event: ViewKeyEvent): void {
		if (!this.isPatientContextCurrent()) return;
		if (
			!findVisibleRecord(
				this.data.visibleRecords,
				event.currentTarget?.dataset?.viewKey,
			)
		)
			return;
		wx.showToast({ title: "预问诊功能正在迁移中", icon: "none" });
	},

	/**
	 * 院内导航继续使用旧端静态科室位置弹窗；没有匹配时展示空状态，
	 * 不把科室名称拼接成未经审核的楼层或诊室。
	 */
	onHospitalGuide(event: ViewKeyEvent): void {
		if (!this.isPatientContextCurrent()) return;
		const record = findVisibleRecord(
			this.data.visibleRecords,
			event.currentTarget?.dataset?.viewKey,
		);
		if (!record) return;
		this.setData({
			showLocationModal: true,
			locationResults: searchDepartmentLocation(record?.departmentName ?? ""),
		});
	},

	closeLocationModal(): void {
		this.setData({ showLocationModal: false, locationResults: [] });
	},

	/** 弹窗内容区域阻止遮罩层点击，保持旧端“点击遮罩关闭”的行为。 */
	stopLocationPropagation(): void {
		// `catchtap` 已经阻止冒泡；这里保留显式方法让 WXML 绑定可审计。
	},

	onPullDownRefresh(): void {
		this.loadRecords().finally(() => wx.stopPullDownRefresh());
	},

	/** 页面卸载后让尚未完成的患者范围请求失去回写资格。 */
	onUnload(): void {
		disposePageInstance(this);
	},

	/**
	 * 本地列表动作也要绑定页面提交时的会话代际。
	 *
	 * `isCurrentSelectedPatient` 只能确认当前 storage 选择仍是同一个患者；
	 * 账号切换后即使恰好复用了相同的 opaque patientId，也必须由代际检查阻断
	 * 旧页面事件，避免把旧账号的视图当作新账号事实继续展示或导航。
	 */
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
				? "预约记录服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			selectedPatient: null,
			patientSessionGeneration: -1,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
			// 错误态必须关闭所有叠加层；否则用户可能在请求失败后仍被
			// 院区弹层遮挡，既看不到顶部网络提示，也无法回到患者选择入口。
			showHospitalModal: false,
			showLocationModal: false,
			locationResults: [],
		});
	},
});
