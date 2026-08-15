import type {
	AppointmentDirectoryGateway,
	AppointmentRecordDirectoryGateway,
	HospitalSettlementGateway,
	MedicalInsuranceGateway,
	OutpatientPaymentGateway,
	PatientDirectoryGateway,
	ReportDirectoryGateway,
	WechatIdentityGateway,
	WechatPaymentGateway,
} from "@hospital/domain";
import type { AdapterName } from "./context";
import { AdapterNotConfiguredError } from "./errors";

function unavailable(adapter: AdapterName): never {
	throw new AdapterNotConfiguredError(adapter);
}

export type NotConfiguredGateways = {
	wechatIdentity: WechatIdentityGateway;
	medicalInsurance: MedicalInsuranceGateway;
	patientDirectory: PatientDirectoryGateway;
	reportDirectory: ReportDirectoryGateway;
	appointmentDirectory: AppointmentDirectoryGateway;
	appointmentRecords: AppointmentRecordDirectoryGateway;
	outpatientPayments: OutpatientPaymentGateway;
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
	};
	const appointmentRecords: AppointmentRecordDirectoryGateway = {
		listRecords: async (_input, _context) => unavailable("zhongyang"),
	};
	const outpatientPayments: OutpatientPaymentGateway = {
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
		appointmentRecords,
		outpatientPayments,
		wechatPayment,
		hospitalSettlement,
	};
}
