import departmentLocations from "../../data/department-location";
import { ApiError } from "../../services/api-client";
import {
	filterAppointmentRecords,
	toAppointmentRecordView,
} from "../../services/appointment-record-view";
import {
	loadAppointmentRecords,
	loadCurrentPatient,
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
import type {
	AppointmentRecord,
	AppointmentRecordsPageData,
	AppointmentRecordTab,
	AppointmentRecordView,
	DepartmentLocationView,
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
	showError(error: unknown, fallback: string): void;
	toRecordView(record: AppointmentRecord, index: number): AppointmentRecordView;
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

Page<AppointmentRecordsPageData, AppointmentRecordsPageMethods>({
	data: {
		hasShown: false,
		selectedPatient: null,
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
			showHospitalModal: false,
			showLocationModal: false,
			locationResults: [],
		});
		return loadCurrentPatient()
			.then((patient) => {
				if (
					!loadGuard.isCurrent(requestToken) ||
					!isCurrentSelectedPatient(patient.id)
				) {
					return;
				}
				return loadAppointmentRecords(patient.id).then((records) => {
					if (
						!loadGuard.isCurrent(requestToken) ||
						!isCurrentSelectedPatient(patient.id)
					) {
						return;
					}
					const mappedRecords = records.map((record, index) =>
						this.toRecordView(record, index),
					);
					const visibleState = getVisibleRecords(
						mappedRecords,
						this.data.activeTab,
					);
					this.setData({
						selectedPatient: patient,
						records: mappedRecords,
						...visibleState,
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
		const filteredRecords = filterAppointmentRecords(
			this.data.records,
			this.data.activeTab,
		);
		const nextCount = Math.min(
			this.data.visibleRecordCount + APPOINTMENT_RECORD_PAGE_SIZE,
			filteredRecords.length,
		);
		this.setData({
			visibleRecords: filteredRecords.slice(0, nextCount),
			visibleRecordCount: nextCount,
			hasMoreRecords: nextCount < filteredRecords.length,
		});
	},

	/**
	 * 复刻旧端“在线挂号/全部挂号”标签，但只在当前安全读模型上过滤。
	 * 旧端的 provider 渠道参数不属于新公共 contract，不能为了视觉一致把它
	 * 重新透传到 API；这样切换标签不会增加 Provider 请求或改变事实总量。
	 */
	onTabTap(event: WechatMiniprogram.TouchEvent): void {
		const tab = event.currentTarget?.dataset?.tab;
		if (tab !== "online" && tab !== "all") return;
		const activeTab = tab as AppointmentRecordTab;
		this.setData({
			activeTab,
			...getVisibleRecords(this.data.records, activeTab),
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
	onRecordTap(event: WechatMiniprogram.TouchEvent): void {
		const index = Number(event.currentTarget?.dataset?.index);
		if (!Number.isInteger(index) || !this.data.visibleRecords[index]) return;
		wx.showToast({ title: "挂号详情暂未开放", icon: "none" });
	},

	/** 操作按钮只执行自身动作，不能继续冒泡触发卡片详情提示。 */
	stopRecordActionPropagation(): void {
		// `catchtap` 已经完成阻止冒泡；保留方法让 WXML 的交互边界可审计。
	},

	/** 旧端预问诊目标页尚未完成独立 contract，保留入口位置但不伪造跳转。 */
	onPreVisit(): void {
		wx.showToast({ title: "预问诊功能正在迁移中", icon: "none" });
	},

	/**
	 * 院内导航继续使用旧端静态科室位置弹窗；没有匹配时展示空状态，
	 * 不把科室名称拼接成未经审核的楼层或诊室。
	 */
	onHospitalGuide(event: WechatMiniprogram.TouchEvent): void {
		const index = Number(event.currentTarget?.dataset?.index);
		const record = this.data.visibleRecords[index];
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

	showError(error: unknown, fallback: string): void {
		const message =
			error instanceof ApiError && error.code === "dependency-not-configured"
				? "预约记录服务暂未配置完成，请联系管理员"
				: patientContextErrorMessage(error, fallback);
		this.setData({
			error: message,
			selectedPatient: null,
			records: [],
			visibleRecords: [],
			visibleRecordCount: 0,
			hasMoreRecords: false,
			showLocationModal: false,
			locationResults: [],
		});
	},
});
