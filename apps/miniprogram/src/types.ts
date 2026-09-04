import type {
	AppointmentDepartmentListPayload,
	AppointmentDepartmentTreePayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
	AppointmentScheduleSourceListPayload,
	AuthSessionPayload,
	CurrentUserPayload,
	HealthKnowledgeCatalogResponsePayload,
	HealthKnowledgeDiseaseDetailResponsePayload,
	HealthKnowledgeDiseaseListResponsePayload,
	HealthKnowledgeDrugDetailResponsePayload,
	HealthKnowledgeSymptomListResponsePayload,
	HealthPayload,
	MyDoctorDeletePayload,
	MyDoctorListPayload,
	MyDoctorResponsePayload,
	OutpatientPaymentListPayload,
	PatientBindingPayload,
	PatientBindingRequestPayload,
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
export type HealthKnowledgeCatalogResponse =
	HealthKnowledgeCatalogResponsePayload;
export type HealthKnowledgeDiseaseListResponse =
	HealthKnowledgeDiseaseListResponsePayload;
export type HealthKnowledgeSymptomListResponse =
	HealthKnowledgeSymptomListResponsePayload;
export type HealthKnowledgeDiseaseDetailResponse =
	HealthKnowledgeDiseaseDetailResponsePayload;
export type HealthKnowledgeDrugDetailResponse =
	HealthKnowledgeDrugDetailResponsePayload;
export type AuthSessionResponse = AuthSessionPayload;
export type CurrentUserResponse = CurrentUserPayload;
export type PatientListResponse = PatientListPayload;
export type PatientBindingRequest = PatientBindingRequestPayload;
export type PatientBindingResponse = PatientBindingPayload;
export type AppointmentDepartmentListResponse =
	AppointmentDepartmentListPayload;
export type AppointmentDepartmentTreeResponse =
	AppointmentDepartmentTreePayload;
export type AppointmentScheduleListResponse = AppointmentScheduleListPayload;
export type AppointmentScheduleSourceListResponse =
	AppointmentScheduleSourceListPayload;
export type MyDoctorListResponse = MyDoctorListPayload;
export type MyDoctorResponse = MyDoctorResponsePayload;
export type MyDoctorDeleteResponse = MyDoctorDeletePayload;
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
/** 旧项目 `first-depts` 受控投影的一级/二级挂号目录。 */
export type AppointmentDepartmentGroup =
	AppointmentDepartmentTreeResponse["data"]["items"][number];
/** 一级目录下的真实二级科室；其 ID 才可作为三级门诊查询的受控输入。 */
export type AppointmentDepartment =
	AppointmentDepartmentGroup["departments"][number];
/** 三级可预约门诊沿用既有的白名单字段，不含 Provider 的其它元数据。 */
export type AppointmentClinicDepartment =
	AppointmentDepartmentListResponse["data"]["items"][number];
export type AppointmentSchedule =
	AppointmentScheduleListResponse["data"]["items"][number];
export type MyDoctor = MyDoctorListResponse["data"]["items"][number];

/** 预约目录“按医生挂号”页签的本地展示模型；只由已校验的排班字段派生。 */
export type AppointmentDoctorCard = {
	doctorId: string;
	doctorName: string;
	/** 旧端 doctorPic 的受控照片 URL；同一医生取首个非空照片，无图时页面回退本地头像。 */
	doctorPhotoUrl?: string;
	/** 无照片时的本地字母/汉字头像兜底。 */
	avatarLabel: string;
	scheduleCount: number;
	availableSlots: number;
	dates: Array<{
		workDate: string;
		label: string;
		availableSlots: number;
	}>;
};

/** 旧端“门诊医生”页的两种只读浏览方式，不代表预约写入状态。 */
export type AppointmentScheduleMode = "doctor" | "date";
export type AppointmentRecord =
	AppointmentRecordListResponse["data"]["items"][number];
export type OutpatientPaymentRecord =
	OutpatientPaymentListResponse["data"]["items"][number];
export type OutpatientPaymentRecordView = OutpatientPaymentRecord & {
	/** 仅用于当前费用查询批次的 WXML 事件回查，不是账单号或支付业务引用。 */
	viewKey: string;
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

/** 健康百科目录项的页面模型；排序和分组只发生在小程序展示层。 */
export type HealthKnowledgeCatalogItem =
	HealthKnowledgeCatalogResponse["data"]["items"][number];
export type HealthKnowledgeSymptomItem =
	HealthKnowledgeSymptomListResponse["data"]["items"][number];
export type HealthKnowledgeDiseaseSummary =
	HealthKnowledgeDiseaseListResponse["data"]["items"][number];
export type HealthKnowledgeDiseaseDetail =
	HealthKnowledgeDiseaseDetailResponse["data"]["item"];
export type HealthKnowledgeDrugDetail =
	HealthKnowledgeDrugDetailResponse["data"]["item"];
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

/** 三类临床查询页面共用的展示阶段；不把错误或空结果混成 loading。 */
export type ClinicalQueryState = "loading" | "ready" | "empty" | "error";

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
	route: string;
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
	serviceTabs: ReadonlyArray<ServiceTab>;
	activeServiceTab: number;
	activeServiceItems: ReadonlyArray<ServiceItem>;
	patients: Array<Patient>;
	selectedPatient: Patient | null;
	selectedPatientId: string;
	/**
	 * 二维码安全壳是否打开。这里只表示用户查看了迁移说明弹层，
	 * 不代表已经生成医院可扫码的二维码。
	 */
	showPatientQr: boolean;
	/** 弹层只展示当前已确认患者的脱敏字段，不保存或生成扫码 payload。 */
	patientQrName: string;
	patientQrCardNumber: string;
	hasPatients: boolean;
	loading: boolean;
	syncingPatients: boolean;
	error: string;
};

/** 就诊人选择页的渲染状态；列表数据始终来自平台脱敏患者目录。 */
export type PatientSelectionPageData = {
	/** 只属于当前选择页实例；首次 onShow 不重复 onLoad 已发起的目录读取。 */
	hasShown: boolean;
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

/** 预约目录页只展示服务端已校验的一、二、三级科室，不承载排班或下单状态。 */
export type AppointmentDirectoryPageData = {
	departments: Array<AppointmentDepartment>;
	departmentGroups: Array<AppointmentDepartmentGroup>;
	/** 当前一级分类下、可展开的真实二级科室。 */
	currentGroupDepartments: Array<AppointmentDepartment>;
	selectedDepartmentGroupId: string;
	/** 当前已展开二级科室下的真实三级门诊。 */
	clinicDepartments: Array<AppointmentClinicDepartment>;
	selectedDepartmentId: string;
	selectedDepartmentName: string;
	/** 搜索框只用于当前已读取的目录，不会把任意关键字透传给 Provider。 */
	searchText: string;
	loading: boolean;
	clinicLoading: boolean;
	/** 只有一级/二级目录读取失败时才进入整页错误态。 */
	error: string;
	/** 已加载目录仍可浏览；细分门诊失败只在当前二级科室内提示。 */
	clinicError: string;
};

/**
 * 旧项目 `department_select` 对应的独立“门诊医生”页。
 *
 * 三级门诊的 opaque ID 仅通过路由带入；页面重新向平台 API 查询经过验证的
 * 排班，不把目录页内存中的排班或 Provider 原文字段跨页传递。
 */
export type AppointmentSchedulePageData = {
	departmentId: string;
	departmentName: string;
	activeMode: AppointmentScheduleMode;
	/** 默认“按医生挂号”读取未来七天的已验证排班。 */
	doctorSchedules: Array<AppointmentSchedule>;
	doctorCards: Array<AppointmentDoctorCard>;
	/** “按日期挂号”只保留当前选择日期的请求结果。 */
	dateSchedules: Array<AppointmentSchedule>;
	/** 用户从医生卡片进入日期模式时的本地筛选；空值表示全部医生。 */
	selectedDoctorId: string;
	selectedDoctorName: string;
	/** 仅用于顶部筛选位的 MM-DD 展示，原始 YYYY-MM-DD 始终保留在 selectedDate。 */
	selectedDateLabel: string;
	selectedDate: string;
	dateOptions: Array<{
		workDate: string;
		dateLabel: string;
		weekdayLabel: string;
	}>;
	datePickerStart: string;
	datePickerEnd: string;
	visibleSchedules: Array<AppointmentSchedule>;
	hasMoreSchedules: boolean;
	visibleScheduleCount: number;
	loading: boolean;
	error: string;
};

/** 旧项目 pagesB/patient/doctor.vue 的平台用户级“我的医生”列表。 */
export type MyDoctorPageData = {
	items: Array<MyDoctor>;
	loading: boolean;
	error: string;
};

export type MyDoctorDetailView = {
	doctorId: string;
	doctorName: string;
	titleName?: string;
	introduction?: string;
	expertise?: string;
	departmentLocation?: string;
	departmentName: string;
	doctorAvatarUrl?: string;
};

/** 旧项目 doctor_card.vue 的医生名片与未来七天排班展示。 */
export type MyDoctorDetailPageData = {
	doctorId: string;
	doctor: MyDoctorDetailView | null;
	schedules: Array<AppointmentSchedule>;
	visibleSchedules: Array<AppointmentSchedule>;
	dateOptions: Array<{
		workDate: string;
		dateLabel: string;
		weekdayLabel: string;
	}>;
	selectedDate: string;
	followed: boolean;
	loading: boolean;
	scheduleLoading: boolean;
	actionLoading: boolean;
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

/**
 * 分时段号源的白名单展示模型。
 *
 * 服务端只返回挂号序号与归一化时段；provider 号源 ID、锁号状态和费用
 * 不进入小程序，页面也不把这些字段拼进后续路由。
 */
export type AppointmentScheduleSource =
	AppointmentScheduleSourceListPayload["data"]["items"][number];

/** 旧项目 `timeslot_source` 对应的“分时段号源”只读页。 */
export type TimeslotSourcePageData = {
	scheduleId: string;
	schedule: AppointmentSchedule | null;
	slots: Array<AppointmentScheduleSource>;
	loading: boolean;
	error: string;
};

/**
 * 旧项目 `confirm_registration` 对应的“确认挂号信息”页。
 *
 * 只承载排班与号源的展示事实和当前就诊人上下文；“确定预约”进入统一的
 * 预约写入关闭态，不在客户端拼装费用或 provider 写入参数。
 */
export type ConfirmRegistrationPageData = {
	hospitalName: string;
	departmentName: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	timeLabel: string;
	serialNumber: string;
	patientName: string;
	patientCardLabel: string;
	patientLoading: boolean;
	agreed: boolean;
};

/**
 * “我的问诊”页面的渲染状态。
 *
 * 旧端这个入口实际展示的是当前就诊人的就诊历史摘要，并不是外部问诊
 * 会话。单独声明页面模型，避免把它误接到 external-entry-surface 后又在
 * 页面里显示“等待外部会话 contract”。
 */
export type ConsultationPageData = {
	/** 只属于当前页面实例，首次 onShow 不重复 onLoad 发起的读取。 */
	hasShown: boolean;
	/** 当前页面读取的会话状态；服务暂时不可用时保留可重试语义。 */
	sessionState: SessionVerificationState;
	queryState: ClinicalQueryState;
	selectedPatient: Patient | null;
	selectedPatientName: string;
	selectedPatientCardLabel: string;
	/** 当前患者历史记录所属的会话代际。 */
	patientSessionGeneration: number;
	records: Array<AppointmentRecordView>;
	/** 当前交给 WXML 的局部窗口，避免历史问诊摘要过多造成首屏卡顿。 */
	visibleRecords: Array<AppointmentRecordView>;
	visibleRecordCount: number;
	hasMoreRecords: boolean;
	loading: boolean;
	error: string;
	/** 只有明确患者上下文错误时才允许引导重新选择。 */
	canSelectPatient: boolean;
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
	queryState: ClinicalQueryState;
	selectedPatient: Patient | null;
	/** 当前预约记录卡片所属的会话代际；-1 表示本轮患者读模型尚未提交。 */
	patientSessionGeneration: number;
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
	/** 只有明确的患者上下文错误才显示错误态中的“选择就诊人”动作。 */
	canSelectPatient: boolean;
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
	/** 当前爽约记录所属的会话代际；避免页面停留时继续消费旧账号快照。 */
	patientSessionGeneration: number;
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
	/** 当前报告目录所属的会话代际；详情事件必须和这代患者上下文一致。 */
	patientSessionGeneration: number;
	reports: Array<ReportDirectoryView>;
	visibleReports: Array<ReportDirectoryView>;
	reportCount: number;
	hasMoreReports: boolean;
	visibleReportCount: number;
	loading: boolean;
	error: string;
	/** 只有明确的患者上下文错误才允许错误态引导用户重新选择。 */
	canSelectPatient: boolean;
};

/** 门诊缴费页只读状态；支付写入仍需独立医保/微信结算契约。 */
export type OutpatientPaymentPageData = {
	/** 只属于当前页面实例，避免费用页面之间共享首次展示标记。 */
	hasShown: boolean;
	/** 门诊费用入口在支付开放前也必须先确认当前平台会话。 */
	sessionState: SessionVerificationState;
	/** 当前院区是已核对的单院区展示配置，不代表 Provider 动态院区列表。 */
	hospitalName: string;
	selectedPatient: Patient | null;
	/** 当前患者卡片所属的会话代际；-1 表示尚未完成本轮患者确认。 */
	patientSessionGeneration: number;
	activeStatus: "unpaid" | "paid";
	/** 完整的当前查询结果；它的总量不能被本地渲染分批改变。 */
	items: Array<OutpatientPaymentRecordView>;
	/** 当前真正交给 WXML 的窗口，避免费用过多时一次性建立整棵渲染树。 */
	visibleItems: Array<OutpatientPaymentRecordView>;
	visibleItemCount: number;
	hasMoreItems: boolean;
	loading: boolean;
	error: string;
	/** 服务异常时保持重试语义；只有患者上下文错误才显示换人动作。 */
	canSelectPatient: boolean;
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

/** “我的”页只展示平台会话、显式授权资料和已迁移的安全入口。 */
export type MyPageData = {
	/** 只属于当前“我的”页面实例；首次 onShow 不重复 onLoad 已发起的读取。 */
	hasShown: boolean;
	/** 入口门禁使用最近一次 `/me` 结果，而不是仅凭本地 token 存在与否。 */
	sessionState: SessionVerificationState;
	userLabel: string;
	/** 当前 owner 设备上经过微信手势授权后可展示的头像 URL。 */
	avatarUrl: string;
	/** 头像昵称授权必须由用户主动触发，不能混入登录 loading。 */
	wechatProfileState: "idle" | "loading" | "ready" | "declined";
	/** 授权状态的低敏提示，不包含微信原始回调或 URL。 */
	wechatProfileHint: string;
	selectedPatient: Patient | null;
	patientCount: number;
	menuSections: ReadonlyArray<MyMenuSection>;
	loading: boolean;
	error: string;
};

/** 普通资料页只编辑平台展示资料；实名、微信身份和头像资源另有边界。 */
export type ProfilePageData = {
	/** 只属于当前资料页实例；首次 onShow 不重复 onLoad 已发起的读取。 */
	hasShown: boolean;
	/** 当前编辑快照所属的平台会话代际；-1 表示尚未取得 owner 证明。 */
	sessionGeneration: number;
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
