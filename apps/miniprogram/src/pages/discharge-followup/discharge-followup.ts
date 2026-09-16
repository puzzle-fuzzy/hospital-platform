import { ApiError } from "../../services/api-client";
import {
	loadAppointmentRecords,
	loadCurrentPatient,
} from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import { getSessionGeneration } from "../../services/session-generation";
import type { Patient } from "../../types";

type FollowupItem = {
	title: string;
	tableName: string;
};

type DischargePageData = {
	patient: Patient | null;
	loading: boolean;
	patientError: string;
	hasCompletedVisit: boolean;
	message: string;
	followupItems: ReadonlyArray<FollowupItem>;
};

type DischargePageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onFollowupTap(event: WechatMiniprogram.TouchEvent): void;
	onBackHome(): void;
};

export const DISCHARGE_FOLLOWUP_ITEMS: ReadonlyArray<FollowupItem> = Object.freeze([
	{ title: "高平市人民医院一级随访记录表", tableName: "高平市人民医院一级随访记录表" },
	{ title: "高平市人民医院四级手术随访记录表", tableName: "高平市人民医院四级手术随访记录表" },
	{ title: "心内科四级手术随访记录表", tableName: "心内科四级手术随访记录表" },
	{ title: "神经内科四级手术随访记录表", tableName: "神经内科四级手术随访记录表" },
	{ title: "高平市人民医院二级回访登记表", tableName: "高平市人民医院二级回访登记表" },
	{ title: "高平市人民医院日间手术随访记录表", tableName: "高平市人民医院日间手术随访记录表" },
	{ title: "高平市人民医院四级手术二次回访登记表", tableName: "高平市人民医院四级手术二次回访登记表" },
	{ title: "高平市人民医院日间手术二级回访登记表", tableName: "高平市人民医院日间手术二级回访登记表" },
]);

function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "patient-selection-required") {
		return "请先选择就诊人";
	}
	return "出院记录暂时无法获取，请稍后重试";
}

Page<DischargePageData, DischargePageMethods>({
	data: {
		patient: null,
		loading: true,
		patientError: "",
		hasCompletedVisit: false,
		message: "",
		followupItems: DISCHARGE_FOLLOWUP_ITEMS,
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "出院随访" });
		void this.loadPage();
	},

	onShow() {
		if (!this.data.loading) void this.loadPage();
	},

	async loadPage() {
		this.setData({ loading: true, patientError: "", message: "" });
		try {
			const patient = await loadCurrentPatient();
			const records = await loadAppointmentRecords(
				patient.id,
				new Date(),
				"history",
				getSessionGeneration(),
				"online",
			);
			const hasCompletedVisit = records.some((record) => record.status === "completed");
			this.setData({ patient, hasCompletedVisit, loading: false });
		} catch (error: unknown) {
			this.setData({ patient: null, hasCompletedVisit: false, loading: false, patientError: errorMessage(error) });
		}
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onFollowupTap(event) {
		const title = String(event.currentTarget.dataset.title ?? "");
		if (!title) return;
		// 当前平台还没有旧端八类表单的详情/提交 contract；保留旧入口
		// 语义，明确未提交，不把“查看”误报成随访已完成。
		this.setData({ message: `${title}详情接口正在接入中，本次未提交。` });
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
