import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { App as AntdApp, Form, Table } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginCaptcha, loginModeFromSearch } from "./App";
import { PaymentSyncActions, paymentRecordColumns } from "./PaymentPanel";
import { RefundPanel } from "./RefundPanel";
import type {
	AdminPaymentSyncTask,
	AdminWechatRefundPaymentRecord,
	Session,
} from "./types";

const noop = () => {};
const operator: Session = {
	accessToken: "synthetic-session",
	refreshToken: "",
	tokenType: "Bearer",
	expiresIn: 3600,
	username: "synthetic-operator",
};
const viewer: Session = { ...operator, capabilities: { readOnly: true } };
const record: AdminWechatRefundPaymentRecord = {
	source: "payment_order",
	orderId: "synthetic-order",
	operationAggregateId: "synthetic-aggregate",
	business: "registration",
	totalFen: 1000,
	paymentState: "paid",
	cashPaymentConfirmed: true,
	cashFen: 1000,
	actualCashFen: 1000,
	hospitalDiscountFen: 0,
	actualPaidFen: 1000,
	amountBreakdownStatus: "confirmed",
	refundReservedFen: 0,
	refundableFen: 1000,
	refundCount: 1,
	refundRoute: "admin",
	createdAt: "2026-10-20T00:00:00Z",
	updatedAt: "2026-10-20T00:00:00Z",
	latestRefund: {
		merchantRefundNo: "synthetic-refund",
		status: "processing",
		refundFen: 1,
		updatedAt: "2026-10-20T00:00:00Z",
	},
};

test("viewer payment rows retain ledger access and hide refund and provider status actions", () => {
	const columns = paymentRecordColumns(
		noop,
		noop,
		noop,
		noop,
		undefined,
		new Set(),
		true,
	);
	const markup = renderToStaticMarkup(
		<Table
			columns={columns}
			dataSource={[record]}
			rowKey="orderId"
			pagination={false}
		/>,
	);
	expect(markup).toContain("查看账本");
	expect(markup).not.toContain("查看挂号");
	expect(markup).not.toContain("查询退款");
	expect(markup).not.toContain("payment-refund-button");
});

test("operator payment rows keep existing registration, ledger and refund actions", () => {
	const columns = paymentRecordColumns(noop, noop, noop, noop);
	const markup = renderToStaticMarkup(
		<Table
			columns={columns}
			dataSource={[record]}
			rowKey="orderId"
			pagination={false}
		/>,
	);
	expect(markup).toContain("查看账本");
	expect(markup).toContain("查看挂号");
	expect(markup).toContain("查询退款");
	expect(markup).toContain("payment-refund-button");
});

test("viewer sync rows hide retry and manual review while operator actions remain", () => {
	const task = { status: "failed" } as AdminPaymentSyncTask;
	const props = { task, loading: false, onRetry: noop, onManualReview: noop };
	expect(renderToStaticMarkup(<PaymentSyncActions {...props} readOnly />)).toBe(
		"",
	);
	const markup = renderToStaticMarkup(
		<PaymentSyncActions {...props} readOnly={false} />,
	);
	expect(markup).toContain("重新排队");
	expect(markup).toContain("转人工");
});

test("viewer login has no captcha field or validation, operator retains it", () => {
	const captcha = { enabled: true, key: "synthetic-captcha", image: "" };
	const render = (loginMode: "operator" | "viewer") =>
		renderToStaticMarkup(
			<Form>
				<LoginCaptcha
					loginMode={loginMode}
					captcha={captcha}
					loading={false}
					onRefresh={noop}
				/>
			</Form>,
		);
	expect(render("viewer")).not.toContain("captcha");
	expect(render("viewer")).not.toContain("验证码");
	expect(render("operator")).toContain("刷新验证码");
	expect(render("operator")).toContain("captcha");
});

test("standalone refund panel gives viewer the safe payment view and keeps operator form", () => {
	const render = (session: Session) =>
		renderToStaticMarkup(
			<AntdApp>
				<RefundPanel session={session} onExpired={noop} />
			</AntdApp>,
		);
	const viewerMarkup = render(viewer);
	expect(viewerMarkup).toContain("支付数据");
	expect(viewerMarkup).not.toContain("提交微信退费");
	expect(viewerMarkup).not.toContain("确认取消挂号");
	expect(render(operator)).toContain("提交微信退费");
});

test("only an explicit viewer URL selects readonly login; existing links remain operator", () => {
	expect(loginModeFromSearch("?mode=viewer")).toBe("viewer");
	for (const search of [
		"",
		"?mode=operator",
		"?mode=unknown",
		"?viewer=true",
	]) {
		expect(loginModeFromSearch(search)).toBe("operator");
	}
});

type HookSlot = { value?: unknown; deps?: unknown[] };
type ViewNode = { type: unknown; props: Record<string, unknown> };

/** Execute the compiled real LoginPanel with an in-memory hook scheduler.
 * Captcha/login ports are synthetic; no browser, socket or request is opened. */
async function loginLifecycle(search: string) {
	const result = await Bun.build({
		entrypoints: [
			new URL("./App.tsx", import.meta.url).pathname.replace(
				/^\/([A-Za-z]:)/u,
				"$1",
			),
		],
		target: "node",
		format: "cjs",
		external: [
			"react",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
			"antd",
			"@ant-design/icons",
			"./api",
			"./LogPanel",
			"./PaymentPanel",
		],
		plugins: [
			{
				name: "synthetic-login-ports",
				setup(build) {
					build.onResolve(
						{ filter: /^\.\/(api|LogPanel|PaymentPanel)$/u },
						(args) => ({ path: args.path, external: true }),
					);
				},
			},
		],
	});
	if (!result.success || !result.outputs[0])
		throw new Error("LoginPanel fixture compile failed");
	const slots: HookSlot[] = [];
	let cursor = 0;
	let effects: Array<() => void> = [];
	let captchaCalls = 0;
	const loginCalls: unknown[] = [];
	const authenticated: Session[] = [];
	let rejectCaptcha = false;
	const depsChanged = (slot: HookSlot, deps: unknown[]) =>
		!slot.deps ||
		deps.some((value, index) => !Object.is(value, slot.deps?.[index]));
	const hooks = {
		useState(initial: unknown) {
			const index = cursor++;
			if (!slots[index])
				slots[index] = {
					value: typeof initial === "function" ? initial() : initial,
				};
			return [
				slots[index]?.value,
				(value: unknown) => {
					const slot = slots[index];
					if (slot)
						slot.value =
							typeof value === "function" ? value(slot.value) : value;
				},
			];
		},
		useCallback(callback: unknown, deps: unknown[]) {
			const index = cursor++;
			if (!slots[index]) slots[index] = {};
			const slot = slots[index];
			if (!slot) throw new Error("Missing hook slot");
			if (depsChanged(slot, deps)) {
				slot.value = callback;
				slot.deps = deps;
			}
			return slot.value;
		},
		useEffect(callback: () => void, deps: unknown[]) {
			const index = cursor++;
			if (!slots[index]) slots[index] = {};
			const slot = slots[index];
			if (!slot) throw new Error("Missing hook slot");
			if (depsChanged(slot, deps)) {
				effects.push(callback);
				slot.deps = deps;
			}
		},
	};
	const marker = () => null;
	const form = Object.assign(() => null, {
		Item: marker,
		useForm: () => [{ setFieldValue: noop }],
	});
	const message = { error: noop, success: noop };
	const antd = {
		App: Object.assign(marker, { useApp: () => ({ message }) }),
		Form: form,
		Layout: { Header: marker, Sider: marker },
		Typography: { Text: marker, Title: marker },
		Input: Object.assign(() => null, { Password: marker }),
		Select: "fixture-select",
	};
	const module = { exports: {} };
	const realRequire = createRequire(import.meta.url);
	const context = createContext({
		module,
		exports: module.exports,
		URLSearchParams,
		window: { location: { search } },
		require(id: string) {
			if (id === "react") return hooks;
			if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime")
				return realRequire(id);
			if (id === "antd") return antd;
			if (id === "@ant-design/icons")
				return new Proxy({}, { get: () => marker });
			if (id === "./api")
				return {
					async loadCaptcha() {
						captchaCalls++;
						if (rejectCaptcha) throw new Error("Synthetic captcha unavailable");
						return {
							enabled: true,
							key: "synthetic-key",
							image: "synthetic-image",
						};
					},
					async login(values: unknown) {
						loginCalls.push(values);
						return viewer;
					},
				};
			if (id === "./LogPanel" || id === "./PaymentPanel") return {};
			throw new Error(`Unexpected fixture import: ${id}`);
		},
	});
	runInContext(await result.outputs[0].text(), context);
	const exported = module.exports as {
		LoginPanel: (props: { onLogin: (session: Session) => void }) => ViewNode;
	};
	let tree: ViewNode;
	const render = () => {
		cursor = 0;
		tree = exported.LoginPanel({
			onLogin: (session) => authenticated.push(session),
		});
		const pending = effects;
		effects = [];
		for (const effect of pending) effect();
	};
	const find = (type: unknown): ViewNode => {
		const walk = (value: unknown): ViewNode | undefined => {
			if (Array.isArray(value)) {
				for (const child of value) {
					const found = walk(child);
					if (found) return found;
				}
				return undefined;
			}
			if (!value || typeof value !== "object" || !("props" in value))
				return undefined;
			const node = value as ViewNode;
			return node.type === type ? node : walk(node.props.children);
		};
		const node = walk(tree);
		if (!node) throw new Error("Missing login fixture element");
		return node;
	};
	return {
		render,
		settle: async () => {
			await Promise.resolve();
			await Promise.resolve();
			render();
		},
		captchaCalls: () => captchaCalls,
		loginCalls,
		authenticated,
		failCaptcha: () => {
			rejectCaptcha = true;
		},
		switchMode(mode: "operator" | "viewer") {
			(find(antd.Select).props.onChange as (value: string) => void)(mode);
			render();
		},
		async submitViewer() {
			await (find(form).props.onFinish as (values: unknown) => Promise<void>)({
				loginMode: "viewer",
				username: "synthetic-viewer",
				password: "synthetic-password",
			});
		},
	};
}

test("compiled LoginPanel loads operator captcha on mount and each switch back without focus", async () => {
	const page = await loginLifecycle("");
	page.render();
	expect(page.captchaCalls()).toBe(1);
	await page.settle();
	expect(page.captchaCalls()).toBe(1);
	page.switchMode("viewer");
	await page.settle();
	expect(page.captchaCalls()).toBe(1);
	page.switchMode("operator");
	expect(page.captchaCalls()).toBe(2);
	await page.settle();
	expect(page.captchaCalls()).toBe(2);
});

test("compiled viewer URL has no captcha dependency; failed operator captcha cannot block viewer login", async () => {
	const direct = await loginLifecycle("?mode=viewer");
	direct.render();
	await direct.settle();
	expect(direct.captchaCalls()).toBe(0);
	await direct.submitViewer();
	expect(direct.authenticated).toHaveLength(1);
	expect(direct.loginCalls).toHaveLength(1);
	const switched = await loginLifecycle("");
	switched.failCaptcha();
	switched.render();
	await switched.settle();
	expect(switched.captchaCalls()).toBe(1);
	switched.switchMode("viewer");
	await switched.submitViewer();
	expect(switched.authenticated).toHaveLength(1);
	expect(switched.captchaCalls()).toBe(1);
});
