import type {
	AppointmentDepartmentListPayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
	AuthSessionPayload,
	CurrentUserPayload,
	HealthPayload,
	PatientListPayload,
	ReportDetailPayload,
	ReportListPayload,
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
export type ReportListResponse = ReportListPayload;
export type ReportDetailResponse = ReportDetailPayload;
export type WechatPrepayResponse = WechatPrepayPayload;
export type WechatPrepayStatusResponse = WechatPrepayStatusPayload;

export type AuthSessionData = AuthSessionResponse["data"];
export type CurrentUserData = CurrentUserResponse["data"];
export type Patient = PatientListResponse["data"]["items"][number];
export type AppointmentDepartment =
	AppointmentDepartmentListResponse["data"]["items"][number];
export type AppointmentSchedule =
	AppointmentScheduleListResponse["data"]["items"][number];
export type AppointmentRecord =
	AppointmentRecordListResponse["data"]["items"][number];
export type Report = ReportListResponse["data"]["items"][number];
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
export type ReportEvent = DatasetEvent<{ reportId?: string }>;
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
	appointmentDepartments: Array<AppointmentDepartment>;
	appointmentSchedules: Array<AppointmentSchedule>;
	hasAppointmentData: boolean;
	loadingAppointments: boolean;
	appointmentRecords: Array<AppointmentRecord>;
	hasAppointmentRecords: boolean;
	loadingAppointmentRecords: boolean;
	reports: Array<Report>;
	/** 报告数量来自服务端报告目录的 total；没有加载目录时保持 0。 */
	reportCount: number;
	hasReports: boolean;
	loadingReports: boolean;
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
