import {
	CodeOutlined,
	LockOutlined,
	LogoutOutlined,
	ReloadOutlined,
	SafetyCertificateOutlined,
	UserOutlined,
	WalletOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App as AntdApp,
	Button,
	Card,
	ConfigProvider,
	Flex,
	Form,
	Input,
	Layout,
	Menu,
	Space,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { clearSession, loadCaptcha, loadSession, login, logout } from "./api";
import { LogPanel } from "./LogPanel";
import { PaymentPanel } from "./PaymentPanel";
import type { CaptchaState, LoginValues, Session } from "./types";

const { Header, Sider } = Layout;
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
			<div className="login-frame">
				<section className="login-hero" aria-label="管理后台说明">
					<div className="login-hero-brand">
						<div className="brand-mark">
							<SafetyCertificateOutlined />
						</div>
						<div>
							<Text className="brand-name">高平市人民医院</Text>
							<Text className="brand-product">支付运营台</Text>
						</div>
					</div>
					<div className="login-hero-copy">
						<Text className="login-kicker">SECURE OPERATIONS CONSOLE</Text>
						<Title>
							把支付链路看清，
							<br />
							把每次退费做对。
						</Title>
						<Text>
							统一查看医保与微信支付事实，按订单追踪支付流程，并在授权范围内完成聚合退费。
						</Text>
					</div>
					<div className="login-hero-points">
						<div>
							<SafetyCertificateOutlined />
							<span>院内授权访问</span>
						</div>
						<div>
							<WalletOutlined />
							<span>医保 + 微信统一台账</span>
						</div>
						<div>
							<CodeOutlined />
							<span>低敏日志与链路审计</span>
						</div>
					</div>
				</section>
				<Card className="login-card" variant="borderless">
					<div className="login-card-eyebrow">院内授权入口</div>
					<Space orientation="vertical" size={4} className="login-heading">
						<Title level={2}>登录管理后台</Title>
						<Text type="secondary">实时日志与支付流程查看</Text>
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
						description="本页面不会保存接口请求或返回内容，关闭页面后登录状态自动清除。"
					/>
				</Card>
			</div>
		</div>
	);
}

function Console() {
	const { message } = AntdApp.useApp();
	const [session, setSession] = useState<Session | undefined>(() =>
		loadSession(),
	);
	const [activeKey, setActiveKey] = useState("payments");

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
					<div className="header-context">
						<Text className="header-eyebrow">高平市人民医院 / 管理后台</Text>
						<Text type="secondary" className="header-subtitle">
							{activeKey === "logs" ? "实时接口日志" : "支付数据"}
						</Text>
					</div>
				</div>
				<Space className="header-actions">
					<div className="user-chip">
						<span className="user-chip-icon">
							<UserOutlined />
						</span>
						<Text>{session.username}</Text>
					</div>
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
					<div className="sider-inner">
						<div className="sider-title">工作台</div>
						<Menu
							mode="inline"
							selectedKeys={[activeKey]}
							onClick={({ key }) => setActiveKey(key)}
							items={[
								{
									key: "logs",
									icon: <CodeOutlined />,
									label: "实时日志",
								},
								{
									key: "payments",
									icon: <WalletOutlined />,
									label: "支付数据",
								},
							]}
						/>
						<div className="sider-footer">
							<Tag color="blue">受控环境</Tag>
							<Text type="secondary">仅显示低敏业务元数据</Text>
						</div>
					</div>
				</Sider>
				{activeKey === "logs" ? (
					<LogPanel
						session={session}
						onExpired={() => {
							clearSession();
							setSession(undefined);
						}}
					/>
				) : activeKey === "payments" ? (
					<PaymentPanel
						session={session}
						onExpired={() => {
							clearSession();
							setSession(undefined);
						}}
					/>
				) : null}
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
