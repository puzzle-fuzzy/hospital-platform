import type {
	AppointmentDepartmentTreeGateway,
	AppointmentDirectoryGateway,
	AppointmentRecordDirectoryGateway,
	AppointmentPatientProfileGateway,
	AppointmentWriteGateway,
	HospitalSettlementGateway,
	MedicalInsuranceGateway,
	OutpatientMedicalRecordGateway,
	OutpatientPaymentGateway,
	PatientDirectoryGateway,
	ReportDirectoryGateway,
	WechatIdentityGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import type { AdapterName } from "./context";
import { AdapterNotConfiguredError } from "./errors";

/**
 * 未配置 Provider 时必须抛出稳定的依赖错误，而不是返回空数组、假成功或虚构支付结果。
 * 这样页面才能区分“确实没有业务数据”和“服务尚未接入”，日志也能保留明确的依赖边界。
 */
function unavailable(adapter: AdapterName): never {
	throw new AdapterNotConfiguredError(adapter);
}

/**
 * 组合根在 schema/配置门禁未打开时使用这组 gateway。
 * 每个方法都保持 fail-closed，避免某个新业务忘记配置 Provider 后静默降级为成功空态；
 * 真正打开能力必须由对应 adapter contract、生产配置和独立验收共同决定。
 */
export type NotConfiguredGateways = {
	wechatIdentity: WechatIdentityGateway;
	medicalInsurance: MedicalInsuranceGateway;
	patientDirectory: PatientDirectoryGateway;
	reportDirectory: ReportDirectoryGateway;
	appointmentDirectory: AppointmentDirectoryGateway;
	appointmentDepartmentTree: AppointmentDepartmentTreeGateway;
	appointmentRecords: AppointmentRecordDirectoryGateway;
	appointmentPatientProfile: AppointmentPatientProfileGateway;
	appointmentWrites: AppointmentWriteGateway;
	outpatientPayments: OutpatientPaymentGateway;
	outpatientMedicalRecords: OutpatientMedicalRecordGateway;
	wechatPayment: WechatPaymentGateway;
	hospitalSettlement: HospitalSettlementGateway;
};

export function createNotConfiguredGateways(): NotConfiguredGateways {
	const wechatIdentity: WechatIdentityGateway = {
		exchangeCode: async (_input, _context) => unavailable("wechat-identity"),
	};
	const medicalInsurance: MedicalInsuranceGateway = {
		authorize: async (_input, _context) => unavailable("medical-insurance"),
		uploadFees: async (_input, _context) => unavailable("medical-insurance"),
		settle: async (_input, _context) => unavailable("medical-insurance"),
		query: async (_input, _context) => unavailable("medical-insurance"),
	};
	const patientDirectory: PatientDirectoryGateway = {
		listByIdentity: async (_input, _context) => unavailable("zhongyang"),
	};
	const appointmentDirectory: AppointmentDirectoryGateway = {
		listDepartments: async (_input, _context) => unavailable("zhongyang"),
		listSchedules: async (_input, _context) => unavailable("zhongyang"),
		listSources: async (_input, _context) => unavailable("zhongyang"),
	};
	const appointmentDepartmentTree: AppointmentDepartmentTreeGateway = {
		listDepartmentTree: async (_context) => unavailable("zhongyang"),
		listClinicDepartments: async (_input, _context) => unavailable("zhongyang"),
	};
	const appointmentRecords: AppointmentRecordDirectoryGateway = {
		listRecords: async (_input, _context) => unavailable("zhongyang"),
	};
	const appointmentPatientProfile: AppointmentPatientProfileGateway = {
		resolve: async (_input, _context) => unavailable("zhongyang"),
	};
	const appointmentWrites: AppointmentWriteGateway = {
		resolveSource: async (_input, _context) => unavailable("zhongyang"),
		getFactRegisterFee: async (_input, _context) => unavailable("zhongyang"),
		listActive: async (_input, _context) => unavailable("zhongyang"),
		create: async (_input, _context) => unavailable("zhongyang"),
		cancel: async (_input, _context) => unavailable("zhongyang"),
	};
	const outpatientPayments: OutpatientPaymentGateway = {
		listRecords: async (_input, _context) => unavailable("zhongyang"),
	};
	const outpatientMedicalRecords: OutpatientMedicalRecordGateway = {
		listRecords: async (_input, _context) => unavailable("zhongyang"),
	};
	const reportDirectory: ReportDirectoryGateway = {
		listReports: async (_input, _context) => unavailable("zhongyang"),
	};
	const wechatPayment: WechatPaymentGateway = {
		createJsapiOrder: async (_input, _context) => unavailable("wechat-pay"),
		query: async (_input, _context) => unavailable("wechat-pay"),
	};
	const hospitalSettlement: HospitalSettlementGateway = {
		writeBack: async (_input, _context) => unavailable("yunhealth"),
	};

	return {
		wechatIdentity,
		medicalInsurance,
		patientDirectory,
		reportDirectory,
		appointmentDirectory,
		appointmentDepartmentTree,
		appointmentRecords,
		appointmentPatientProfile,
		appointmentWrites,
		outpatientPayments,
		outpatientMedicalRecords,
		wechatPayment,
		hospitalSettlement,
	};
}
