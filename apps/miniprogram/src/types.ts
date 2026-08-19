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
	/** 旧端列表只显示账单自然日；原始 billDate 仍保留用于业务校验。 */
	billDateLabel: string;
};
export type Report = ReportListResponse["data"]["items"][number];
/** 报告目录的页面显示模型；服务端英文枚举只在页面边界翻译为中文。 */
export type ReportDirectoryView = Report & {
	kindLabel: string;
	statusLabel: string;
	/** 当前报告目录渲染批次生成的事件 key，不是服务端报告引用或业务主键。 */
	viewKey: string;
};
export type ReportDetail = ReportDetailResponse["data"];
export type LaboratoryReportItem = ReportDetail["items"][number];
/** 检验明细的页面显示模型；服务端枚举只在客户端边界转换为患者可读文案。 */
export type LaboratoryReportItemView = LaboratoryReportItem & {
	flagLabel: string;
};
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
/** 列表卡片操作只接受当前渲染批次生成的视图 key，不能回退到数组索引。 */
export type ViewKeyEvent = DatasetEvent<{ viewKey?: string }>;
export type PatientEvent = DatasetEvent<{ patientId?: string }>;
export type ReportTabEvent = DatasetEvent<{ tab?: string }>;

export type SessionLabel =
	| "未登录"
	| "验证会话中"
	| "会话暂不可用"
	| "已恢复会话"
	| "已登录";

/**
 * 页面级会话验证状态。
 *
 * `hasPlatformSession()` 只能说明本地存在 token，不能证明 token 仍被服务端
 * 接受；患者、资料和挂号入口必须消费这个最近一次 `/me` 验证结果。`unavailable`
 * 表示服务暂时不可用，不能误判成退出登录并删除可重试的本地会话。
 */
export type SessionVerificationState =
	| "checking"
	| "valid"
	| "invalid"
	| "unavailable";

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
	/** 只属于当前首页实例；首次 onShow 不重复 onLoad 已发起的读取。 */
	hasShown: boolean;
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
	/** 只有完整医院目录同步成功后才允许点击患者返回调用页；这不是服务端事实。 */
	selectionReady: boolean;
	/** 延迟返回期间锁定当前页面实例，避免快速连点或离开后误操作页面栈。 */
	navigationPending: boolean;
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
	/** 仅用于原生列表 diff 和事件回查；不是预约号、provider ID 或可写入业务引用。 */
	viewKey: string;
	statusLabel: string;
	statusClass: string;
	/** 旧端把就诊日期与上午/下午作为独立视觉层级展示。 */
	periodLabel: string;
};

/** “我的挂号”旧端的两个展示标签；切换只过滤当前已取得的安全读模型。 */
export type AppointmentRecordTab = "online" | "all";

/** 院内导航弹窗只展示旧端静态科室位置资料，不承载实时路线。 */
export type DepartmentLocationView = {
	department: string;
	location: string;
};

export type AppointmentRecordsPageData = {
	/** 只属于当前页面实例，不能使用模块级变量跨实例共享生命周期状态。 */
	hasShown: boolean;
	/** 只有 `/me` 验证成功后，页面才允许进入就诊人选择入口。 */
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	/** 当前查询得到的完整预约记录；总数和状态事实不能被本地分批改变。 */
	records: Array<AppointmentRecordView>;
	/** 当前真正交给 WXML 的预约记录窗口，避免历史数据过多时一次性渲染。 */
	visibleRecords: Array<AppointmentRecordView>;
	visibleRecordCount: number;
	hasMoreRecords: boolean;
	activeTab: AppointmentRecordTab;
	hospitalName: string;
	/** 单院区仍复刻旧端的选择面板，但不会伪造不存在的动态院区数据。 */
	showHospitalModal: boolean;
	showLocationModal: boolean;
	locationResults: Array<DepartmentLocationView>;
	loading: boolean;
	error: string;
};

/**
 * 爽约记录是预约历史读模型的派生页面，不是另一套 provider 数据源。
 * 单独声明页面状态，避免把“全部挂号记录”和“只看爽约记录”混成一个模板语义。
 */
export type MissedAppointmentsPageData = {
	/** 只属于当前页面实例，避免多层页面返回时互相消费首次 onShow 状态。 */
	hasShown: boolean;
	/** 爽约记录属于受保护患者业务，入口必须消费真实会话验证状态。 */
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	/** 完整的 missed 派生结果；它不是 provider 分页，也不能被截断后误报为空。 */
	records: Array<AppointmentRecordView>;
	/** 当前交给 WXML 的局部窗口；只影响渲染成本，不改变 missed 筛选规则。 */
	visibleRecords: Array<AppointmentRecordView>;
	visibleRecordCount: number;
	hasMoreRecords: boolean;
	loading: boolean;
	error: string;
};

export type ReportDetailPageData = {
	loading: boolean;
	title: string;
	reportCount: number;
	activeTab: "report" | "image";
	reportedAt: string;
	items: Array<LaboratoryReportItemView>;
	hasItems: boolean;
	hasAttachment: boolean;
	error: string;
};

/** 报告目录页的渲染状态；大列表只在页面边界分批展示，不改变服务端查询窗口。 */
export type ReportDirectoryPageData = {
	/** 只属于当前页面实例，首次 onShow 不重复 onLoad 已发起的目录读取。 */
	hasShown: boolean;
	/** 报告目录的更换患者入口不能用本地 token 存在替代 `/me` 验证。 */
	sessionState: SessionVerificationState;
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
	/** 只属于当前页面实例，避免费用页面之间共享首次展示标记。 */
	hasShown: boolean;
	/** 门诊费用入口在支付开放前也必须先确认当前平台会话。 */
	sessionState: SessionVerificationState;
	selectedPatient: Patient | null;
	activeStatus: "unpaid" | "paid";
	/** 完整的当前查询结果；它的总量不能被本地渲染分批改变。 */
	items: Array<OutpatientPaymentRecordView>;
	/** 当前真正交给 WXML 的窗口，避免费用过多时一次性建立整棵渲染树。 */
	visibleItems: Array<OutpatientPaymentRecordView>;
	visibleItemCount: number;
	hasMoreItems: boolean;
	loading: boolean;
	error: string;
};

/** “我的”页菜单项；图标与分组顺序保持旧端 userNavData 的事实顺序。 */
export type MyMenuItem = {
	action: string;
	icon: string;
	title: string;
};

/** “我的”页的旧端分组；即使同名分组重复，也不能在迁移时擅自重排功能。 */
export type MyMenuSection = {
	title: string;
	items: ReadonlyArray<MyMenuItem>;
};

/** “我的”页只展示平台会话和已迁移的安全入口。 */
export type MyPageData = {
	/** 只属于当前“我的”页面实例；首次 onShow 不重复 onLoad 已发起的读取。 */
	hasShown: boolean;
	/** 入口门禁使用最近一次 `/me` 结果，而不是仅凭本地 token 存在与否。 */
	sessionState: SessionVerificationState;
	userLabel: string;
	selectedPatient: Patient | null;
	patientCount: number;
	menuSections: ReadonlyArray<MyMenuSection>;
	/** 底部四 Tab 与首页共用同一组旧端图标和文案。 */
	tabBarItems: ReadonlyArray<TabBarItem>;
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
	/** 保存成功后的短暂返回窗口；页面卸载时必须使待执行导航失效。 */
	navigationPending: boolean;
	error: string;
};
