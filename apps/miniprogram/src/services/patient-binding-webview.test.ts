import { afterEach, expect, test } from "bun:test";
import { buildBailingPatientCardUrl } from "./bailing-patient-card";
import { notifySessionChanged } from "./session-events";

type BindingPage = {
	data: { webViewUrl: string; error: string };
	setData(patch: Partial<BindingPage["data"]>): void;
	onLoad(options?: Record<string, string>): void;
	openPatientCard(): void;
	onRetry(): void;
	onWebViewError(): void;
	onBack(): void;
	onUnload(): void;
};

const originals = new Map(
	["wx", "getApp", "getCurrentPages", "Page", "fetch"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
const activePages: BindingPage[] = [];
let definition: BindingPage | undefined;

afterEach(() => {
	for (const page of activePages.splice(0)) page.onUnload();
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

function expectFixedPatientCardUrl(value: string): void {
	const url = new URL(value);
	expect(url.origin).toBe("https://cx.o2o.bailingjk.net");
	expect(url.pathname).toBe("/wechat/");
	expect(url.search).toBe("");
	const [route, query] = url.hash.slice(1).split("?");
	expect(route).toBe("/bluser/userCard/index");
	const params = new URLSearchParams(query);
	expect([...params.keys()].sort()).toEqual(["_t", "publicNoCode"]);
	expect(params.get("publicNoCode")).toBe("gzh-048400_0001");
	expect(params.get("_t")).toMatch(/^\d+$/u);
}

async function bindingFixture(
	options: {
		hasSession?: boolean;
		backFails?: boolean;
		route?: Record<string, string>;
	} = {},
) {
	const forbiddenCalls: string[] = [];
	const navigations: string[] = [];
	let backCalls = 0;
	let setDataCalls = 0;
	const app = {
		globalData: {
			accessToken:
				options.hasSession === false ? "" : "patient-card-fixture-session",
			sessionStatus: "signed_in",
			sessionGeneration: 1,
		},
	};
	const forbidden = (name: string) => () => {
		forbiddenCalls.push(name);
		throw new Error(`Patient-card page must not call ${name}`);
	};
	Object.assign(globalThis, {
		getApp: () => app,
		getCurrentPages: () => [],
		Page: (page: BindingPage) => {
			definition = page;
		},
		fetch: forbidden("fetch"),
		wx: {
			getStorageSync: () => "",
			setNavigationBarTitle: () => undefined,
			request: forbidden("request"),
			login: forbidden("login"),
			requestPayment: forbidden("requestPayment"),
			requestMedicalInsurancePay: forbidden("requestMedicalInsurancePay"),
			setStorageSync: forbidden("setStorageSync"),
			navigateTo: forbidden("navigateTo"),
			showToast: () => undefined,
			navigateBack: (input?: { fail?: () => void }) => {
				backCalls += 1;
				if (options.backFails) input?.fail?.();
			},
			switchTab: (input: { url: string }) => navigations.push(input.url),
		},
	});
	if (!definition) {
		const path = "../pages/patient-binding/patient-binding";
		await import(`${path}.ts?bailing-patient-card-regression`);
	}
	if (!definition) throw new Error("Patient-card page was not registered");
	const page: BindingPage = {
		...definition,
		data: { ...definition.data },
		setData(patch) {
			setDataCalls += 1;
			Object.assign(this.data, patch);
		},
	};
	activePages.push(page);
	page.onLoad(options.route ?? {});
	return {
		page,
		app,
		forbiddenCalls,
		navigations,
		backCalls: () => backCalls,
		setDataCalls: () => setDataCalls,
	};
}

test("patient-card URL delegates user identity to the fixed Bailing page", () => {
	expectFixedPatientCardUrl(buildBailingPatientCardUrl());
	// 即使 JS 调用方多传了路由值，也不能成为身份、重定向或 token 参数。
	const url = Reflect.apply(buildBailingPatientCardUrl, undefined, [
		{
			userId: "90000000000",
			url: "https://untrusted.example.test/",
			redirectUrl: "https://untrusted.example.test/",
			access_token: "fixture-token-not-for-external-pages",
		},
	]);
	expectFixedPatientCardUrl(url);
	expect(url).not.toContain("90000000000");
	expect(url).not.toContain("untrusted.example.test");
	expect(url).not.toContain("fixture-token");
});

test("adding a patient ignores route identity and opens H5 without native binding writes", async () => {
	const fixture = await bindingFixture({
		route: {
			userId: "90000000000",
			url: "https://untrusted.example.test/",
			redirectUrl: "https://untrusted.example.test/",
		},
	});
	expectFixedPatientCardUrl(fixture.page.data.webViewUrl);
	expect(fixture.page.data.error).toBe("");
	expect(fixture.page.data.webViewUrl).not.toContain("90000000000");
	expect(fixture.forbiddenCalls).toEqual([]);
});

test("H5 loading failure removes the frame and retry only reopens the fixed page", async () => {
	const fixture = await bindingFixture();
	fixture.page.onWebViewError();
	expect(fixture.page.data.webViewUrl).toBe("");
	expect(fixture.page.data.error).toContain("公众号");
	fixture.page.onRetry();
	expectFixedPatientCardUrl(fixture.page.data.webViewUrl);
	expect(fixture.page.data.error).toBe("");
	expect(fixture.forbiddenCalls).toEqual([]);
});

test("no platform session keeps the patient-card frame closed without auto login", async () => {
	const fixture = await bindingFixture({ hasSession: false });
	expect(fixture.page.data.webViewUrl).toBe("");
	expect(fixture.page.data.error).toContain("登录");
	fixture.page.onRetry();
	expect(fixture.page.data.webViewUrl).toBe("");
	expect(fixture.forbiddenCalls).toEqual([]);
});

test("retry after session loss clears an already opened patient-card frame", async () => {
	const fixture = await bindingFixture();
	expectFixedPatientCardUrl(fixture.page.data.webViewUrl);
	fixture.app.globalData.accessToken = "";
	fixture.page.onRetry();
	expect(fixture.page.data.webViewUrl).toBe("");
	expect(fixture.page.data.error).toContain("登录");
	expect(fixture.forbiddenCalls).toEqual([]);
});

test("account switch clears H5 and unloading releases its reset listener", async () => {
	const fixture = await bindingFixture();
	notifySessionChanged("account-switched");
	expect(fixture.page.data.webViewUrl).toBe("");
	expect(fixture.page.data.error).toContain("登录");
	fixture.page.onUnload();
	const setDataCalls = fixture.setDataCalls();
	notifySessionChanged("account-switched");
	expect(fixture.setDataCalls()).toBe(setDataCalls);
	expect(fixture.forbiddenCalls).toEqual([]);
});

test("return normally pops the page and direct-entry fallback opens the home tab", async () => {
	const normal = await bindingFixture();
	normal.page.onBack();
	expect(normal.backCalls()).toBe(1);
	expect(normal.navigations).toEqual([]);
	const directEntry = await bindingFixture({ backFails: true });
	directEntry.page.onBack();
	expect(directEntry.backCalls()).toBe(1);
	expect(directEntry.navigations).toEqual(["/pages/index/index"]);
	expect(normal.forbiddenCalls).toEqual([]);
	expect(directEntry.forbiddenCalls).toEqual([]);
});
