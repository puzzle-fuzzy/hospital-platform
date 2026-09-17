type TestOption = { value: string; label: string };
type TestQuestion = {
	id: string;
	title: string;
	options: ReadonlyArray<TestOption>;
};
type TestConfig = { title: string; questions: ReadonlyArray<TestQuestion> };

const YES_NO: ReadonlyArray<TestOption> = Object.freeze([
	{ value: "yes", label: "是" },
	{ value: "no", label: "否" },
]);
const ABC: ReadonlyArray<TestOption> = Object.freeze([
	{ value: "A", label: "A" },
	{ value: "B", label: "B" },
	{ value: "C", label: "C" },
]);
const MENTAL_AGE_OPTIONS: ReadonlyArray<TestOption> = Object.freeze([
	{ value: "yes", label: "是" },
	{ value: "middle", label: "中间" },
	{ value: "no", label: "否" },
]);
const MENTAL_STRESS_OPTIONS: ReadonlyArray<TestOption> = Object.freeze([
	{ value: "A", label: "A、从未发生" },
	{ value: "B", label: "B、偶尔发生" },
	{ value: "C", label: "C、经常发生" },
]);

function questionsFromTitles(
	titles: ReadonlyArray<string>,
	options: ReadonlyArray<TestOption>,
): ReadonlyArray<TestQuestion> {
	return titles.map((title, index) => ({
		id: `q${index + 1}`,
		title: `${index + 1}. ${title}`,
		options,
	}));
}

const QUESTION_BANKS: Readonly<Record<string, TestConfig>> = Object.freeze({
	artery: {
		title: "动脉血管",
		questions: [
			{
				id: "tc",
				title: "1. 总胆固醇 (mmol/L)",
				options: ["<4.13", "4.13–5.17", "5.17–6.20", "6.20–7.23", ">=7.23"].map(
					(label) => ({ value: label, label }),
				),
			},
			{
				id: "hdl",
				title: "2. 高密度脂蛋白 (mmol/L)",
				options: ["<0.9", "0.9–1.16", "1.16–1.29", "1.29–1.55", ">=1.55"].map(
					(label) => ({ value: label, label }),
				),
			},
			{ id: "treatment", title: "3. 您是否有过动脉血管治疗?", options: YES_NO },
			{
				id: "sbp",
				title: "3-1. 未治疗收缩压范围 (mmHg)",
				options: [
					"<120",
					"120–129",
					"130–139",
					"140–149",
					"150–159",
					">=160",
				].map((label) => ({ value: label, label })),
			},
			{ id: "smoke", title: "4. 您是否吸烟?", options: YES_NO },
			{ id: "diabetes", title: "5. 您是否有糖尿病史?", options: YES_NO },
		],
	},
	diabetes: {
		title: "2型糖尿病",
		questions: [
			{
				id: "age",
				title: "1. 您的年龄是?",
				options: ["<45", "45–54", "54–64", ">=65"].map((label) => ({
					value: label,
					label,
				})),
			},
			{
				id: "bmi",
				title: "2. 体重指数 (kg/m²)?",
				options: ["<25", "25–30", ">30"].map((label) => ({
					value: label,
					label,
				})),
			},
			{
				id: "sex",
				title: "3. 您的性别是?",
				options: [
					{ value: "male", label: "男" },
					{ value: "female", label: "女" },
				],
			},
			{
				id: "waist",
				title: "3-1. 腹围下方腰围 (cm)",
				options: ["<94", "94–102", ">=102"].map((label) => ({
					value: label,
					label,
				})),
			},
			{ id: "exercise", title: "4. 每天至少运动30分钟?", options: YES_NO },
			{
				id: "fruit",
				title: "5. 您摄入蔬菜水果的频率是?",
				options: [
					{ value: "daily", label: "每天摄入" },
					{ value: "not-daily", label: "不是每天摄入" },
				],
			},
			{
				id: "medicine",
				title: "6. 您曾被服用降压药吗?",
				options: [
					{ value: "never", label: "从未" },
					{ value: "yes", label: "是" },
				],
			},
			{
				id: "glucose",
				title: "7. 您曾被发现过血糖偏高吗?",
				options: [
					{ value: "never", label: "从未" },
					{ value: "yes", label: "是" },
				],
			},
			{
				id: "family",
				title: "8. 您的直系亲属中是否有糖尿病?",
				options: [
					{ value: "none", label: "无" },
					{ value: "second", label: "二级亲属" },
					{ value: "first", label: "一级亲属" },
				],
			},
		],
	},
	lung: {
		title: "肺功能",
		questions: questionsFromTitles(
			[
				"牙齿变黄，口中有干燥异味感，出现短暂咳嗽?",
				"经常每天咳嗽数次，且经常有痰?",
				"比同年龄更容易气短、胸闷?",
				"年龄超过40岁，现在抽烟或曾经抽烟?",
				"记忆力减退、精神难以集中、易醒或睡眠差?",
			],
			YES_NO,
		),
	},
	heart: {
		title: "心脏功能",
		questions: questionsFromTitles(
			[
				"幼年患过流感、扁桃体炎、猩红热、中耳炎吗?",
				"性格是否不善于适应环境，情绪处于紧张激动之中?",
				"和家人朋友的关系是?",
				"经常参加体育锻炼吗?",
				"在饮食上倾向于?",
				"你的体重是否理想?",
				"你每天平均食盐量为?",
				"你每天吸烟量为?",
				"你的工作负荷是?",
				"你的脉搏每分钟跳多少次?",
				"你的血压正常吗?",
				"劳累或精神紧张时是否出现心悸、胸闷、胸痛?",
				"观察你的耳垂?",
				"平卧睡觉时感觉?",
				"观察你的嘴唇?",
			],
			ABC,
		),
	},
	"mental-age": {
		title: "心理年龄",
		questions: questionsFromTitles(
			[
				"对任何事都有探索精神。",
				"往往凭经验办事。",
				"下决心做某件事便立即去做。",
				"难以控制感情。",
				"日益固执起来。",
				"怕烦心、怕做事、不想活动。",
				"喜欢计较小事。",
				"说话慢且啰嗦。",
				"健忘。",
				"对什么事都有好奇心。",
				"有强烈的生活追求。",
				"喜欢参加各种活动。",
				"容易嫉妒别人，易悲伤。",
				"见到不合理的事不那么气愤了。",
				"不喜欢看推理小说。",
				"对电影和爱情小说日益失去兴趣。",
				"做事缺乏持久性。",
				"不愿意改变旧习惯。",
				"喜欢回忆过去。",
				"学习新鲜事物感到困难。",
				"十分注意自己的身体变化。",
				"生活兴趣的范围变小了。",
				"看书的速度加快。",
				"动作不够灵活。",
				"消除疲劳感很慢。",
				"晚上不如早晨和上午清醒。",
				"对生活的挫折感到烦恼。",
				"缺乏自信心。",
				"集中精力思考有困难。",
				"工作效率低。",
			],
			MENTAL_AGE_OPTIONS,
		),
	},
	dementia: {
		title: "老年痴呆",
		questions: questionsFromTitles(
			[
				"整天和衣躺着看电视。",
				"什么兴趣爱好都没有。",
				"没有一个可以亲密交谈的朋友。",
				"平时讨厌外出，常闷在家里。",
				"日常生活中没有属于自己干的工作或在家庭中没起什么作用。",
				"不关心世事，不读书也不读报。",
				"觉得活着没什么意义。",
				"身体懒得动，无精打采。",
				"讨厌听或说开玩笑。",
				"有高血压或低血压。",
				"平时净发牢骚或埋怨。",
				"将“想死”做为口头禅。",
				"被人说成神经过敏或过分认真。",
				"经常过分忧虑。",
				"经常焦虑，易发脾气。",
				"对任何事都不会激动，无动于衷。",
				"什么事若非亲自动手，便不放心。",
				"不听别人的意见，固执己见。",
				"沉默寡言。",
				"配偶去世5年以上。",
				"不轻易对人说谢谢。",
				"老讲自己过去值得自豪的事情。",
				"对新的事物缺乏兴趣。",
				"啥事都以自己为中心。",
				"对任何事情都缺乏忍耐。",
			],
			YES_NO,
		),
	},
	"mental-stress": {
		title: "心理压力",
		questions: questionsFromTitles(
			[
				"觉得手上工作太忙，无法应付。",
				"觉得没有时间消遣，终日记挂着工作。",
				"觉得时间不够，要争分夺秒。",
				"遇到挫败时易发脾气。",
				"担心别人对自己工作表现的评价。",
				"担心自己的经济状况。",
				"有头痛、胃痛、背痛的毛病，难以治愈。",
				"需要借烟酒、药物、零食等抑制不安的情绪。",
				"需要借助安眠药帮助入睡。",
				"觉得上司和家人都不欣赏自己。",
				"家人、朋友、同事的相处令你发脾气。",
				"做事急躁、任性，然后感到内疚。",
				"与人交谈时，打断对方的话题。",
				"上床后思潮起伏，很多事情牵挂，难以入睡。",
				"太多工作，不能每件事尽善尽美。",
				"空闲时轻松一下也会感到内疚。",
				"觉得自己不应该享乐。",
			],
			MENTAL_STRESS_OPTIONS,
		),
	},
});

type SelfTestPageData = {
	typeKey: string;
	title: string;
	questions: ReadonlyArray<TestQuestion>;
	answers: Record<string, string>;
	message: string;
};

type SelfTestPageMethods = {
	onOptionTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBack(): void;
};

Page<SelfTestPageData, SelfTestPageMethods>({
	data: {
		typeKey: "",
		title: "健康自测",
		questions: [],
		answers: {},
		message: "",
	},

	onLoad(options: Record<string, string | undefined>) {
		const typeKey = String(options?.type ?? "");
		const config = QUESTION_BANKS[typeKey];
		if (!config) {
			this.setData({ typeKey, title: "健康自测", message: "未找到该题库配置" });
			return;
		}
		this.setData({
			typeKey,
			title: config.title,
			questions: config.questions,
			answers: {},
		});
		wx.setNavigationBarTitle({ title: config.title });
	},

	onOptionTap(event) {
		const questionId = String(event.currentTarget.dataset.questionId ?? "");
		const value = String(event.currentTarget.dataset.value ?? "");
		if (!questionId || !value) return;
		this.setData({
			answers: { ...this.data.answers, [questionId]: value },
			message: "",
		});
	},

	onSubmit() {
		const unanswered = this.data.questions.find(
			(question) => !this.data.answers[question.id],
		);
		if (unanswered) {
			this.setData({ message: `请完成“${unanswered.title}”` });
			return;
		}
		this.setData({
			message: "自测结果接口正在接入中，本次未提交，也未生成风险结论。",
		});
	},

	onBack() {
		wx.navigateBack();
	},
});
