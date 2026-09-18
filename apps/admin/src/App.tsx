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
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { clearSession, loadCaptcha, loadSession, login, logout } from "./api";
import { LogPanel } from "./LogPanel";
import { PaymentPanel } from "./PaymentPanel";
import { RefundPanel } from "./RefundPanel";
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
			<div className="login-brand">
				<div className="brand-mark">
					<SafetyCertificateOutlined />
				</div>
				<Text className="brand-name">高平市人民医院</Text>
			</div>
			<Card className="login-card" variant="borderless">
				<Space orientation="vertical" size={4} className="login-heading">
					<Title level={2}>高平市人民医院管理后台</Title>
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
	);
}

function Console() {
	const { message } = AntdApp.useApp();
	const [session, setSession] = useState<Session | undefined>(() =>
		loadSession(),
	);
	const [activeKey, setActiveKey] = useState("logs");

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
							{activeKey === "logs"
								? "实时接口日志"
								: activeKey === "payments"
									? "支付流程查看"
									: "微信退费"}
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
								label: "查看支付",
							},
							{
								key: "refunds",
								icon: <WalletOutlined />,
								label: "微信退费",
							},
						]}
					/>
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
				) : (
					<RefundPanel
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
