import { isPatientSyncInFlight } from "./patient-sync-coordinator";

/**
 * 统一进入就诊人选择页。
 *
 * 任何页面都可能在首页后台同步尚未结束时发起“更换就诊人”。统一门禁
 * 避免选择页再次产生第二条同步链；门禁只改善用户入口，真正的并发安全
 * 仍由进程级同步协调器和服务端幂等租约共同保证。
 */
export function navigateToPatientSelector(): void {
	if (isPatientSyncInFlight()) {
		wx.showToast({ title: "就诊人正在同步，请稍后", icon: "none" });
		return;
	}
	wx.navigateTo({ url: "/pages/patient-select/patient-select" });
}
