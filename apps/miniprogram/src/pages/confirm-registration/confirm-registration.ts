import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import { logClientErrorTransformed } from "../../services/telemetry";
import type { ConfirmRegistrationPageData } from "../../types";

type ConfirmRegistrationPageMethods = {
	loadPatient(): void;
	onOpenPatientSelector(): void;
	onToggleAgree(): void;
	onOpenNotice(): void;
	onConfirmTap(): void;
};

/** 须知不复制旧端模板中的外院电话；取消/取号规则以医院现场公示为准。 */
const REGISTRATION_NOTICE = [
	"1、请确认就诊日期与时段后继续；当日挂号以医院实际安排为准。",
	"2、医院实行实名制就诊，请携带有效证件按时到院取号候诊。",
	"3、未按时取号的预约可能按爽约处理；取消规则以医院现场公示为准。",
	"4、挂号费用以下单时医院实际收费为准，本页面不展示报价。",
].join("\n");

/**
 * 对应旧项目 `/pagesB/hospital/confirm_registration`。
 *
 * 旧端在此页拼接 provider 号源 ID、挂号费并直接调用执行预约接口；新端
 * 只展示排班与号源的确认事实和当前就诊人脱敏上下文。“确定预约”进入
 * 统一的预约写入关闭态，不在客户端组装费用或写入参数；就诊人证件、
 * 手机号等敏感字段不进入本页。
 */
Page<ConfirmRegistrationPageData, ConfirmRegistrationPageMethods>({
	data: {
		hospitalName: "高平市人民医院",
		departmentName: "",
		doctorName: "",
		workDate: "",
		shiftName: "",
		timeLabel: "",
		serialNumber: "",
		patientName: "",
		patientCardLabel: "",
		patientLoading: true,
		agreed: false,
	},

	onLoad(options: Record<string, string | undefined>) {
		this.setData({
			departmentName: decodeRouteValue(options.departmentName) ?? "",
			doctorName: decodeRouteValue(options.doctorName) ?? "",
			workDate: decodeRouteValue(options.workDate) ?? "",
			shiftName: decodeRouteValue(options.shiftName) ?? "",
			timeLabel: decodeRouteValue(options.timeLabel) ?? "",
			serialNumber: decodeRouteValue(options.serialNumber) ?? "",
		});
		if (
			!this.data.departmentName ||
			!this.data.doctorName ||
			!/^\d{4}-\d{2}-\d{2}$/.test(this.data.workDate) ||
			!this.data.timeLabel
		) {
			wx.showToast({ title: "预约信息无效，请重新选择", icon: "none" });
			setTimeout(() => wx.navigateBack(), 600);
			return;
		}
		this.loadPatient();
	},

	onShow() {
		// 从统一就诊人选择页返回后重新确认，不沿用上一位就诊人卡片。
		if (!this.data.patientLoading) this.loadPatient();
	},

	loadPatient(): void {
		this.setData({ patientLoading: true });
		loadCurrentPatient()
			.then((patient) => {
				this.setData({
					patientName: patient.displayName,
					patientCardLabel:
						patient.cardNumberMasked === "未绑定"
							? "就诊卡未绑定"
							: `就诊卡：${patient.cardNumberMasked}`,
				});
			})
			.catch((error: unknown) => {
				// 就诊人上下文失败被静态文案替代；转换前留痕真实原因。
				logClientErrorTransformed(
					"confirm-registration.patient-context",
					error,
				);
				this.setData({
					patientName: "未选择就诊人",
					patientCardLabel: "请先选择就诊人",
				});
			})
			.finally(() => {
				this.setData({ patientLoading: false });
			});
	},

	onOpenPatientSelector(): void {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onToggleAgree(): void {
		this.setData({ agreed: !this.data.agreed });
	},

	onOpenNotice(): void {
		wx.showModal({
			title: "预约挂号须知",
			content: REGISTRATION_NOTICE,
			showCancel: false,
			confirmText: "我知道了",
		});
	},

	/** 写入未开放：进入统一关闭态，不在客户端伪造预约成功。 */
	onConfirmTap(): void {
		if (!this.data.agreed) {
			wx.showToast({ title: "请先阅读并同意预约挂号须知", icon: "none" });
			return;
		}
		if (this.data.patientName === "未选择就诊人") {
			wx.showToast({ title: "请先选择就诊人", icon: "none" });
			return;
		}
		navigateToFeatureStatus("appointment-write");
	},
});

/** 与门诊医生页同规则的路由解码：最多解三层百分号编码，畸形编码按空处理。 */
function decodeRouteValue(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	let decoded = value;
	for (let depth = 0; depth < 3; depth += 1) {
		if (!/%[0-9A-Fa-f]{2}/u.test(decoded)) break;
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			return undefined;
		}
	}
	return decoded;
}
