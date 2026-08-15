import { request } from "../../services/api-client";

Page({
	data: {
		status: "加载中",
		service: "",
	},

	onLoad() {
		request({ url: "/health/live" })
			.then((payload) => {
				this.setData({
					status: payload.data.status,
					service: payload.data.service,
				});
			})
			.catch(() => {
				this.setData({ status: "服务不可用" });
			});
	},
});
