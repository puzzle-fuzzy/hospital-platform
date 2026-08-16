type HospitalListPageMethods = {
	onRegisterTap(): void;
	onRouteTap(): void;
};

/**
 * 旧端医院列表当前只有一张固定的高平市人民医院卡片。
 *
 * 这里故意不把医院名称、院区 ID、地址或坐标伪装成 provider API 返回值：
 * 在新的机构/院区 contract 到达前，它们只是已核对过的展示配置；预约目录
 * 仍由后端按当前会话和患者上下文提供真实科室、排班及可预约状态。
 */
const STATIC_HOSPITAL = Object.freeze({
	name: "高平市人民医院",
	address: "山西省高平市建设南路331号",
	image: "/assets/hospital-list/gaoping-hospital.jpg",
});

type HospitalListPageData = {
	hospital: typeof STATIC_HOSPITAL;
};

Page<HospitalListPageData, HospitalListPageMethods>({
	data: {
		hospital: STATIC_HOSPITAL,
	},

	/** 选择院区后进入既有的预约只读目录，不在此页创建预约或锁定号源。 */
	onRegisterTap() {
		wx.navigateTo({
			url: "/pages/appointment-directory/appointment-directory",
		});
	},

	/**
	 * 旧端没有路线接口，也没有可靠坐标；不能根据地址自行猜测经纬度并调用地图。
	 * 保留原按钮的视觉位置，同时明确告诉用户该能力尚未完成，避免误导。
	 */
	onRouteTap() {
		wx.showModal({
			title: "查看路线",
			content: "路线服务暂未开放，请以医院现场指引为准。",
			showCancel: false,
		});
	},
});
