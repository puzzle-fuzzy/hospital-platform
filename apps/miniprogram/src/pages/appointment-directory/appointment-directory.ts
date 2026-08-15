import { ApiError } from "../../services/api-client";
import { loadAppointmentDirectory } from "../../services/dashboard-service";
import type { AppointmentDirectoryPageData } from "../../types";

type AppointmentDirectoryPageMethods = {
	loadDirectory(): Promise<void>;
	onPullDownRefresh(): void;
	showError(error: unknown, fallback: string): void;
};

Page<AppointmentDirectoryPageData, AppointmentDirectoryPageMethods>({
	data: {
		departments: [],
		schedules: [],
		loading: true,
		error: "",
	},

	onLoad() {
		this.loadDirectory();
	},

	/** 预约目录只读取平台白名单后的科室和排班读模型。 */
	loadDirectory(): Promise<void> {
		this.setData({ loading: true, error: "" });
		return loadAppointmentDirectory()
			.then(({ departments, schedules }) =>
				this.setData({ departments, schedules, error: "" }),
			)
			.catch((error) => this.showError(error, "预约目录加载失败"))
			.finally(() => this.setData({ loading: false }));
	},

	onPullDownRefresh(): void {
		this.loadDirectory().finally(() => wx.stopPullDownRefresh());
	},

	showError(error: unknown, fallback: string): void {
		let message = fallback;
		if (error instanceof ApiError) {
			message =
				error.code === "dependency-not-configured"
					? "预约服务暂未配置完成，请联系管理员"
					: error.message;
		}
		this.setData({ error: message });
	},
});
