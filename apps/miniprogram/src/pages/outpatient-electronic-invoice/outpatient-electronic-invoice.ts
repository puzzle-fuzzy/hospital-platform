// 保留旧路由以承接历史入口；按医院要求仅展示线下打印指引。
Page<{ printHint: string }, Record<never, never>>({
	data: {
		printHint: "请前往导诊机自主打印发票",
	},
});
