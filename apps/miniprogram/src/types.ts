import type {
	AppointmentDepartmentListPayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
	AuthSessionPayload,
	CurrentUserPayload,
	HealthPayload,
	OutpatientPaymentListPayload,
	PatientListPayload,
	ReportDetailPayload,
	ReportListPayload,
	UserProfilePayload,
	UserProfileUpdatePayload,
	WechatPrepayPayload,
	WechatPrepayStatusPayload,
} from "@hospital/contracts";

/** 平台 API 的成功响应外壳；错误响应由 ApiError 统一承载。 */
export type ApiResponse<T> = {
	success: true;
	data: T;
};

/** API 客户端允许的 HTTP 方法，避免把任意字符串交给 wx.request。 */
export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

/** 请求体只能是微信原生请求支持的 JSON 对象或空值。 */
export type ApiRequestData = WechatMiniprogram.IAnyObject | undefined;

/** 平台客户端的统一请求参数。 */
export type ApiRequestOptions = {
	url: string;
	method?: ApiMethod;
	data?: ApiRequestData;
	authenticated?: boolean;
	idempotencyKey?: string;
};

export type HealthResponse = HealthPayload;
export type AuthSessionResponse = AuthSessionPayload;
export type CurrentUserResponse = CurrentUserPayload;
export type PatientListResponse = PatientListPayload;
export type AppointmentDepartmentListResponse =
	AppointmentDepartmentListPayload;
export type AppointmentScheduleListResponse = AppointmentScheduleListPayload;
export type AppointmentRecordListResponse = AppointmentRecordListPayload;
export type OutpatientPaymentListResponse = OutpatientPaymentListPayload;
export type ReportListResponse = ReportListPayload;
export type ReportDetailResponse = ReportDetailPayload;
export type WechatPrepayResponse = WechatPrepayPayload;
export type WechatPrepayStatusResponse = WechatPrepayStatusPayload;

export type AuthSessionData = AuthSessionResponse["data"];
export type CurrentUserData = CurrentUserResponse["data"];
export type UserProfileResponse = {
	success: true;
	data: UserProfilePayload["data"];
};
export type UserProfileUpdateRequest = UserProfileUpdatePayload;
export type Patient = PatientListResponse["data"]["items"][number];
/** 选择页的显示模型；关系中文案只属于客户端展示层，不进入 API contract。 */
export type PatientSelectionView = Patient & {
	relationshipLabel: string;
};
export type AppointmentDepartment =
	AppointmentDepartmentListResponse["data"]["items"][number];
export type AppointmentSchedule =
	AppointmentScheduleListResponse["data"]["items"][number];
export type AppointmentRecord =
	AppointmentRecordListResponse["data"]["items"][number];
export type OutpatientPaymentRecord =
	OutpatientPaymentListResponse["data"]["items"][number];
export type OutpatientPaymentRecordView = OutpatientPaymentRecord & {
	amountLabel: string;
};
export type Report = ReportListResponse["data"]["items"][number];
/** 报告目录的页面显示模型；服务端英文枚举只在页面边界翻译为中文。 */
export type ReportDirectoryView = Report & {
	kindLabel: string;
	statusLabel: string;
};
export type ReportDetail = ReportDetailResponse["data"];
export type LaboratoryReportItem = ReportDetail["items"][number];
export type WechatPrepayData = WechatPrepayResponse["data"];
export type WechatPrepayStatusData = WechatPrepayStatusResponse["data"];

/** 首页日期查询范围，由平台客户端限制而不是透传 provider 参数。 */
export type DateRange = {
	startDate: string;
	endDate: string;
};

/** 预约排班查询条件只允许公开平台字段。 */
export type AppointmentScheduleQuery = DateRange & {
	departmentId?: string;
	doctorId?: string;
};

/** 报告查询条件只允许内部 patientId 和有限日期范围。 */
export type ReportQuery = DateRange & {
	patientId: string;
	kind?: "laboratory" | "imaging" | "ecg";
};

/** 小程序事件中只提取页面声明的数据集字段。 */
export type DatasetEvent<T extends Record<string, unknown>> = {
	currentTarget?: {
		dataset?: T;
	};
};

export type ActionEvent = DatasetEvent<{ action?: string }>;
export type IndexEvent = DatasetEvent<{ index?: string | number }>;
export type PatientEvent = DatasetEvent<{ patientId?: string }>;
export type ReportTabEvent = DatasetEvent<{ tab?: string }>;

export type SessionLabel = "未登录" | "验证会话中" | "已恢复会话" | "已登录";

export type ServiceTab = {
	title: string;
	items: ReadonlyArray<ServiceItem>;
};

export type ServiceItem = {
	action?: string;
	icon: string;
	title: string;
};

export type TopTabItem = {
	action?: string;
	icon: string;
	text: string;
};

export type BannerItem = {
	action: string;
	image: string;
};

export type TabBarItem = {
	activeIcon: string;
	icon: string;
	text: string;
};

/** 首页所有可渲染状态集中定义，避免 setData 写入未声明字段。 */
export type IndexPageData = {
	status: string;
	service: string;
	sessionStatus: SessionLabel;
	topTabList: ReadonlyArray<TopTabItem>;
	bannerList: ReadonlyArray<BannerItem>;
	rightList: ReadonlyArray<BannerItem>;
	tabBarItems: ReadonlyArray<TabBarItem>;
	serviceTabs: ReadonlyArray<ServiceTab>;
	activeServiceTab: number;
	activeServiceItems: ReadonlyArray<ServiceItem>;
	patients: Array<Patient>;
	selectedPatient: Patient | null;
	selectedPatientId: string;
	hasPatients: boolean;
	loading: boolean;
	syncingPatients: boolean;
	error: string;
};

/** 就诊人选择页的渲染状态；列表数据始终来自平台脱敏患者目录。 */
export type PatientSelectionPageData = {
	patients: Array<PatientSelectionView>;
	selectedPatientId: string;
	loading: boolean;
	syncing: boolean;
	error: string;
};

/** 预约目录页只展示服务端已校验的科室和排班，不承载下单状态。 */
export type AppointmentDirectoryPageData = {
	departments: Array<AppointmentDepartment>;
	schedules: Array<AppointmentSchedule>;
	selectedDepartmentId: string;
	selectedDepartmentName: string;
	dateGroups: Array<{
		workDate: string;
		label: string;
		count: number;
	}>;
	selectedDate: string;
	visibleSchedules: Array<AppointmentSchedule>;
	hasMoreSchedules: boolean;
	visibleScheduleCount: number;
	loading: boolean;
	error: string;
};

/** 挂号记录页使用服务端规范化状态，避免在小程序解析 provider 状态码。 */
export type AppointmentRecordView = AppointmentRecord & {
	statusLabel: string;
	statusClass: string;
};

export type AppointmentRecordsPageData = {
	selectedPatient: Patient | null;
	records: Array<AppointmentRecordView>;
	loading: boolean;
	error: string;
};

/**
 * 爽约记录是预约历史读模型的派生页面，不是另一套 provider 数据源。
 * 单独声明页面状态，避免把“全部挂号记录”和“只看爽约记录”混成一个模板语义。
 */
export type MissedAppointmentsPageData = {
	selectedPatient: Patient | null;
	records: Array<AppointmentRecordView>;
	loading: boolean;
	error: string;
};

export type ReportDetailPageData = {
	loading: boolean;
	title: string;
	reportCount: number;
	activeTab: "report" | "image";
	reportedAt: string;
	items: Array<LaboratoryReportItem>;
	hasItems: boolean;
	hasAttachment: boolean;
	error: string;
};

/** 报告目录页的渲染状态；大列表只在页面边界分批展示，不改变服务端查询窗口。 */
export type ReportDirectoryPageData = {
	selectedPatient: Patient | null;
	reports: Array<ReportDirectoryView>;
	visibleReports: Array<ReportDirectoryView>;
	reportCount: number;
	hasMoreReports: boolean;
	visibleReportCount: number;
	loading: boolean;
	error: string;
};

/** 门诊缴费页只读状态；支付写入仍需独立医保/微信结算契约。 */
export type OutpatientPaymentPageData = {
	selectedPatient: Patient | null;
	activeStatus: "unpaid" | "paid";
	items: Array<OutpatientPaymentRecordView>;
	loading: boolean;
	error: string;
};

/** “我的”页只展示平台会话和已迁移的安全入口。 */
export type MyPageData = {
	userLabel: string;
	selectedPatient: Patient | null;
	patientCount: number;
	loading: boolean;
	error: string;
};

/** 普通资料页只编辑平台展示资料；实名、微信身份和头像资源另有边界。 */
export type ProfilePageData = {
	displayName: string;
	gender: "male" | "female" | "unknown";
	age: string;
	email: string;
	version: number;
	loading: boolean;
	/** 只有读取成功后才允许提交，避免加载失败时用默认值覆盖线上资料。 */
	loaded: boolean;
	saving: boolean;
	error: string;
};
