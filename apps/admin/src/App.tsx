import {
	CheckCircleFilled,
	CopyOutlined,
	DatabaseOutlined,
	FileSearchOutlined,
	IdcardOutlined,
	LockOutlined,
	LogoutOutlined,
	ReloadOutlined,
	SafetyCertificateOutlined,
	SearchOutlined,
	UserOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App as AntdApp,
	Button,
	Card,
	Col,
	Collapse,
	ConfigProvider,
	Descriptions,
	Empty,
	Flex,
	Form,
	Input,
	Layout,
	Menu,
	Radio,
	Row,
	Space,
	Statistic,
	Table,
	Tag,
	Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	clearSession,
	loadCaptcha,
	loadSession,
	login,
	logout,
	queryInsurance,
} from "./api";
import {
	formatBalance,
	INSURANCE_STATUS_LABELS,
	INSURANCE_TYPE_LABELS,
	maskIdentity,
	text,
} from "./insurance";
import { LogPanel } from "./LogPanel";
import type {
	CaptchaState,
	InsuranceRecord,
	LoginValues,
	Normalized1101Result,
	QueryMode,
	QueryValues,
	Session,
} from "./types";

const { Header, Content, Sider } = Layout;
const { Text, Title } = Typography;

const EMPTY_CAPTCHA: CaptchaState = { enabled: true, key: "", image: "" };

function LoginPanel({ onLogin }: { onLogin: (session: Session) => void }) {
	const { message } = AntdApp.useApp();
	const [form] = Form.useForm<LoginValues>();
	const [captcha, setCaptcha] = useState<CaptchaState>(EMPTY_CAPTCHA);
	const [captchaLoading, setCaptchaLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const refreshCaptcha = useCallback(async () => {
		setCaptchaLoading(true);
		try {
			setCaptcha(await loadCaptcha());
		} catch (error) {
			void message.error(
				error instanceof Error ? error.message : "验证码加载失败",
			);
		} finally {
			setCaptchaLoading(false);
		}
	}, [message]);

	useEffect(() => {
		void refreshCaptcha();
	}, [refreshCaptcha]);

	const submit = async (values: LoginValues) => {
		setSubmitting(true);
		try {
			const session = await login(values, captcha);
			onLogin(session);
			void message.success("登录成功");
		} catch (error) {
			void message.error(error instanceof Error ? error.message : "登录失败");
			form.setFieldValue("captcha", "");
			await refreshCaptcha();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="login-shell">
			<div className="login-brand">
				<div className="brand-mark">
					<SafetyCertificateOutlined />
				</div>
				<Text className="brand-name">高平市人民医院</Text>
			</div>
			<Card className="login-card" variant="borderless">
				<Space orientation="vertical" size={4} className="login-heading">
					<Title level={2}>医保参保余额查询</Title>
					<Text type="secondary">使用医院管理账号登录后查询 1101 参保信息</Text>
				</Space>
				<Form<LoginValues>
					form={form}
					layout="vertical"
					size="large"
					onFinish={submit}
					autoComplete="off"
					requiredMark={false}
				>
					<Form.Item
						name="username"
						label="账号"
						rules={[{ required: true, message: "请输入账号" }, { max: 64 }]}
					>
						<Input
							prefix={<UserOutlined />}
							placeholder="请输入管理账号"
							autoComplete="username"
						/>
					</Form.Item>
					<Form.Item
						name="password"
						label="密码"
						rules={[{ required: true, message: "请输入密码" }, { max: 256 }]}
					>
						<Input.Password
							prefix={<LockOutlined />}
							placeholder="请输入密码"
							autoComplete="current-password"
						/>
					</Form.Item>
					{captcha.enabled ? (
						<Form.Item label="验证码" required>
							<Flex className="captcha-row" gap={8} align="center">
								<Form.Item
									name="captcha"
									noStyle
									rules={[
										{ required: true, message: "请输入验证码" },
										{ max: 32 },
									]}
								>
									<Input placeholder="输入计算结果" />
								</Form.Item>
								<Button
									className="captcha-button"
									onClick={() => void refreshCaptcha()}
									loading={captchaLoading}
									aria-label="刷新验证码"
								>
									{captcha.image ? (
										<img src={captcha.image} alt="登录验证码" />
									) : (
										<ReloadOutlined />
									)}
								</Button>
							</Flex>
						</Form.Item>
					) : null}
					<Button type="primary" htmlType="submit" block loading={submitting}>
						登录管理端
					</Button>
				</Form>
				<Alert
					className="login-note"
					type="info"
					showIcon
					title="仅供院内授权人员使用"
					description="本页面不会保存查询条件或医保返回内容，关闭页面后登录状态自动清除。"
				/>
			</Card>
		</div>
	);
}

function modeFields(mode: QueryMode) {
	if (mode === "electronic-credential") {
		return {
			label: "电子凭证令牌",
			placeholder: "请输入真实电子凭证令牌",
			cardSerial: false,
		};
	}
	if (mode === "social-security-card") {
		return {
			label: "社会保障卡卡号",
			placeholder: "请输入社会保障卡卡号",
			cardSerial: true,
		};
	}
	return {
		label: "身份证号",
		placeholder: "请输入身份证号",
		cardSerial: false,
	};
}

function QueryPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const { message } = AntdApp.useApp();
	const [form] = Form.useForm<QueryValues>();
	const mode = Form.useWatch("mode", form) || "identity-card";
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<Normalized1101Result>();
	const [lastQuery, setLastQuery] = useState<QueryValues>();
	const fields = modeFields(mode);

	const submit = async (values: QueryValues) => {
		setSubmitting(true);
		setResult(undefined);
		try {
			const nextResult = await queryInsurance(values, session);
			setResult(nextResult);
			setLastQuery(values);
			void message.success(
				`查询完成，共返回 ${nextResult.insuranceRecords.length} 条参保记录`,
			);
		} catch (error) {
			if (loadSession() === undefined) onExpired();
			void message.error(error instanceof Error ? error.message : "查询失败");
		} finally {
			setSubmitting(false);
		}
	};

	const expectedPsnNo = String(lastQuery?.expectedPsnNo || "").trim();
	const psnNoMatched =
		!expectedPsnNo ||
		Boolean(
			result?.insuranceRecords.some((item) => item.psnNo === expectedPsnNo),
		);

	const columns = useMemo<ColumnsType<InsuranceRecord>>(
		() => [
			{ title: "序号", dataIndex: "index", width: 72, fixed: "left" },
			{
				title: "险种",
				dataIndex: "insuranceType",
				width: 210,
				render: (value: string) => (
					<Space size={6}>
						<Tag color="blue">{value || "未知"}</Tag>
						<Text>{INSURANCE_TYPE_LABELS[value] || "其他险种"}</Text>
					</Space>
				),
			},
			{
				title: "参保状态",
				dataIndex: "status",
				width: 130,
				render: (value: string) => (
					<Tag color={value === "1" ? "success" : "warning"}>
						{INSURANCE_STATUS_LABELS[value] || value || "未知"}
					</Tag>
				),
			},
			{
				title: "账户余额",
				dataIndex: "balance",
				width: 150,
				align: "right",
				render: (value: string) => <Text strong>{formatBalance(value)}</Text>,
			},
			{
				title: "PSN_NO",
				dataIndex: "psnNo",
				width: 250,
				render: (value: string) =>
					value ? <Text copyable={{}}>{value}</Text> : <Text>—</Text>,
			},
			{
				title: "参保地区划",
				dataIndex: "insuredArea",
				width: 130,
				render: (value: string) => value || "—",
			},
			{
				title: "人员类别",
				dataIndex: "personType",
				width: 120,
				render: (value: string) => value || "—",
			},
			{
				title: "参保单位",
				dataIndex: "employerName",
				width: 220,
				render: (value: string) => value || "—",
			},
		],
		[],
	);

	const basePsnNo = result ? text(result.baseInfo, ["psn_no", "psnNo"]) : "";
	const displayedPsnNo = basePsnNo || result?.insuranceRecords[0]?.psnNo || "";
	const baseName = result ? text(result.baseInfo, ["psn_name", "psnName"]) : "";
	const baseCertno = result ? text(result.baseInfo, ["certno", "certNo"]) : "";

	return (
		<Content className="console-content">
			<div className="content-heading">
				<div>
					<Title level={2}>人员参保信息查询</Title>
					<Text type="secondary">
						调用医保 1101，展示返回的全部险种、状态与账户余额
					</Text>
				</div>
				<Tag icon={<CheckCircleFilled />} color="success">
					新服务 1101 查询
				</Tag>
			</div>

			<Card
				title={
					<Space>
						<SearchOutlined />
						查询条件
					</Space>
				}
			>
				<Form<QueryValues>
					form={form}
					layout="vertical"
					size="large"
					initialValues={{ mode: "identity-card" }}
					onFinish={submit}
					requiredMark={false}
				>
					<Form.Item name="mode" label="查询凭证">
						<Radio.Group buttonStyle="solid">
							<Radio.Button value="identity-card">身份证</Radio.Button>
							<Radio.Button value="electronic-credential">
								电子凭证
							</Radio.Button>
							<Radio.Button value="social-security-card">
								社会保障卡
							</Radio.Button>
						</Radio.Group>
					</Form.Item>
					<Row gutter={16}>
						<Col xs={24} md={12} lg={8}>
							<Form.Item
								name="name"
								label="姓名"
								rules={[{ required: true, message: "请输入姓名" }, { max: 50 }]}
							>
								<Input
									prefix={<UserOutlined />}
									placeholder="请输入参保人姓名"
								/>
							</Form.Item>
						</Col>
						<Col xs={24} md={12} lg={8}>
							<Form.Item
								name="identityNumber"
								label="身份证号"
								rules={[
									{ required: true, message: "请输入身份证号" },
									{
										pattern: /^\d{15}$|^\d{17}[0-9Xx]$/,
										message: "身份证号格式不正确",
									},
								]}
							>
								<Input
									prefix={<IdcardOutlined />}
									placeholder="用于人员身份核验"
									maxLength={18}
								/>
							</Form.Item>
						</Col>
						<Col xs={24} md={12} lg={8}>
							<Form.Item
								name="expectedPsnNo"
								label="PSN_NO（可选）"
								extra="1101 不支持按 PSN_NO 直查；此处用于核对返回人员编号"
								rules={[{ max: 64 }]}
							>
								<Input
									prefix={<DatabaseOutlined />}
									placeholder="输入后校验返回结果"
								/>
							</Form.Item>
						</Col>
					</Row>
					{mode !== "identity-card" ? (
						<Row gutter={16}>
							<Col xs={24} md={12} lg={8}>
								<Form.Item
									name="credentialNumber"
									label={fields.label}
									rules={[
										{ required: true, message: `请输入${fields.label}` },
										{ max: 512 },
									]}
								>
									<Input.Password
										visibilityToggle={mode === "electronic-credential"}
										placeholder={fields.placeholder}
									/>
								</Form.Item>
							</Col>
							{fields.cardSerial ? (
								<Col xs={24} md={12} lg={8}>
									<Form.Item
										name="cardSerialNumber"
										label="卡识别码 CARD_SN"
										rules={[
											{ required: true, message: "请输入卡识别码" },
											{ max: 64 },
										]}
									>
										<Input placeholder="请输入社会保障卡识别码" />
									</Form.Item>
								</Col>
							) : null}
						</Row>
					) : null}
					<Flex justify="flex-end" gap={8}>
						<Button
							onClick={() => {
								form.resetFields();
								setResult(undefined);
								setLastQuery(undefined);
							}}
						>
							重置
						</Button>
						<Button
							type="primary"
							htmlType="submit"
							icon={<SearchOutlined />}
							loading={submitting}
						>
							查询 1101
						</Button>
					</Flex>
				</Form>
			</Card>

			{result ? (
				<Space orientation="vertical" size={16} className="result-stack">
					{!psnNoMatched ? (
						<Alert
							type="warning"
							showIcon
							title="PSN_NO 核对不一致"
							description="返回的参保记录中没有匹配到输入的人员编号，请先核对身份后再使用结果。"
						/>
					) : null}
					<Row gutter={[16, 16]}>
						<Col xs={24} sm={12} lg={6}>
							<Card>
								<Statistic
									title="参保记录"
									value={result.insuranceRecords.length}
									suffix="条"
								/>
							</Card>
						</Col>
						<Col xs={24} sm={12} lg={6}>
							<Card>
								<Statistic
									title="正常参保"
									value={
										result.insuranceRecords.filter(
											(item) => item.status === "1",
										).length
									}
									suffix="条"
								/>
							</Card>
						</Col>
						<Col xs={24} sm={12} lg={6}>
							<Card>
								<Statistic
									title="人员编号"
									value={basePsnNo || result.insuranceRecords[0]?.psnNo || "—"}
									styles={{ content: { fontSize: 18 } }}
								/>
							</Card>
						</Col>
						<Col xs={24} sm={12} lg={6}>
							<Card>
								<Statistic
									title="查询凭证"
									value={
										lastQuery?.mode === "identity-card"
											? "身份证"
											: lastQuery?.mode === "electronic-credential"
												? "电子凭证"
												: "社会保障卡"
									}
									styles={{ content: { fontSize: 18 } }}
								/>
							</Card>
						</Col>
					</Row>
					<Card title="人员基本信息">
						<Descriptions
							bordered
							size="small"
							column={{ xs: 1, sm: 2, lg: 3 }}
							items={[
								{
									key: "name",
									label: "姓名",
									children: baseName || lastQuery?.name || "—",
								},
								{
									key: "certno",
									label: "身份证号",
									children: maskIdentity(
										baseCertno || lastQuery?.identityNumber || "",
									),
								},
								{
									key: "psnNo",
									label: "PSN_NO",
									children: displayedPsnNo ? (
										<Text copyable={{}}>{displayedPsnNo}</Text>
									) : (
										"—"
									),
								},
							]}
						/>
					</Card>
					<Card
						title="全部参保记录"
						extra={<Text type="secondary">不按 310、390 或 330 预先过滤</Text>}
					>
						{result.insuranceRecords.length > 0 ? (
							<Table<InsuranceRecord>
								rowKey="key"
								columns={columns}
								dataSource={result.insuranceRecords}
								pagination={false}
								scroll={{ x: 1280 }}
							/>
						) : (
							<Empty description="1101 未返回参保记录" />
						)}
					</Card>
					<Collapse
						items={[
							{
								key: "raw",
								label: "1101 原始返回（仅供内部核验）",
								children: (
									<div className="raw-result">
										<Button
											size="small"
											icon={<CopyOutlined />}
											onClick={async () => {
												await navigator.clipboard.writeText(
													JSON.stringify(result.raw, null, 2),
												);
												void message.success("原始返回已复制");
											}}
										>
											复制 JSON
										</Button>
										<pre>{JSON.stringify(result.raw, null, 2)}</pre>
									</div>
								),
							},
						]}
					/>
				</Space>
			) : (
				<Card className="empty-card">
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description="填写查询条件后，这里会展示全部参保状态和余额"
					/>
				</Card>
			)}
		</Content>
	);
}

function Console() {
	const { message } = AntdApp.useApp();
	const [session, setSession] = useState<Session | undefined>(() =>
		loadSession(),
	);
	const [activeMenu, setActiveMenu] = useState<"insurance" | "logs">(
		"insurance",
	);

	const signOut = async () => {
		if (session) await logout(session).catch(() => undefined);
		clearSession();
		setSession(undefined);
		void message.success("已退出登录");
	};

	if (!session) return <LoginPanel onLogin={setSession} />;

	return (
		<Layout className="console-layout">
			<Header className="console-header">
				<div className="header-brand">
					<div className="header-logo">
						<SafetyCertificateOutlined />
					</div>
					<div>
						<Text strong>高平市人民医院</Text>
						<Text type="secondary" className="header-subtitle">
							{activeMenu === "logs" ? "接口调用日志" : "医保参保余额查询"}
						</Text>
					</div>
				</div>
				<Space>
					<Text type="secondary">
						<UserOutlined /> {session.username}
					</Text>
					<Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
						退出
					</Button>
				</Space>
			</Header>
			<Layout>
				<Sider
					className="console-sider"
					width={224}
					theme="light"
					breakpoint="lg"
					collapsedWidth={0}
				>
					<div className="sider-title">管理菜单</div>
					<Menu
						mode="inline"
						selectedKeys={[activeMenu]}
						onClick={({ key }) => setActiveMenu(key as "insurance" | "logs")}
						items={[
							{
								key: "insurance",
								icon: <IdcardOutlined />,
								label: "医保参保查询",
							},
							{
								key: "logs",
								icon: <FileSearchOutlined />,
								label: "接口调用日志",
							},
						]}
					/>
				</Sider>
				{activeMenu === "logs" ? (
					<LogPanel
						session={session}
						onExpired={() => {
							clearSession();
							setSession(undefined);
						}}
					/>
				) : (
					<QueryPanel
						session={session}
						onExpired={() => {
							clearSession();
							setSession(undefined);
						}}
					/>
				)}
			</Layout>
		</Layout>
	);
}

export default function RootApp() {
	return (
		<ConfigProvider theme={{ cssVar: {}, token: { borderRadius: 8 } }}>
			<AntdApp>
				<Console />
			</AntdApp>
		</ConfigProvider>
	);
}
