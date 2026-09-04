type AppGlobalData = {
	lastRequestId: string;
};

App<{ globalData: AppGlobalData }>({
	globalData: { lastRequestId: "" },
});
