import { expect, test } from "bun:test";
import { getPageLatestRequestGuard } from "./page-instance-state";
import {
	disposePageSessionResetListener,
	notifySessionChanged,
	registerPageSessionResetListener,
} from "./session-events";

test("页面会话清理监听按页面实例注册并可卸载", () => {
	const firstPage = {};
	const secondPage = {};
	let firstResetCount = 0;
	let secondResetCount = 0;

	registerPageSessionResetListener(firstPage, () => {
		firstResetCount += 1;
	});
	registerPageSessionResetListener(secondPage, () => {
		secondResetCount += 1;
	});

	notifySessionChanged();
	expect(firstResetCount).toBe(1);
	expect(secondResetCount).toBe(1);

	disposePageSessionResetListener(firstPage);
	notifySessionChanged();
	expect(firstResetCount).toBe(1);
	expect(secondResetCount).toBe(2);

	disposePageSessionResetListener(secondPage);
});

test("同一页面重新注册时只保留最新清理回调", () => {
	const page = {};
	let oldResetCount = 0;
	let newResetCount = 0;

	registerPageSessionResetListener(page, () => {
		oldResetCount += 1;
	});
	registerPageSessionResetListener(page, () => {
		newResetCount += 1;
	});

	notifySessionChanged();
	expect(oldResetCount).toBe(0);
	expect(newResetCount).toBe(1);

	disposePageSessionResetListener(page);
});

test("页面会话清理先淘汰在途请求再执行回调", () => {
	const page = {};
	const guard = getPageLatestRequestGuard(page, "patients");
	const token = guard.begin();
	let resetCount = 0;

	registerPageSessionResetListener(page, () => {
		resetCount += 1;
	});
	notifySessionChanged();

	expect(resetCount).toBe(1);
	expect(guard.isCurrent(token)).toBe(false);
	disposePageSessionResetListener(page);
});

test("token 失效过渡不重置页面，真实账号切换才重置页面", () => {
	const page = {};
	let resetCount = 0;
	registerPageSessionResetListener(page, () => {
		resetCount += 1;
	});

	// GET 自动恢复会先短暂清理旧 token；这不是账号切换，不能让页面
	// 丢掉在途请求并显示一次误导性的“账号已切换”。
	notifySessionChanged("session-invalidated");
	expect(resetCount).toBe(0);

	notifySessionChanged("account-switched");
	expect(resetCount).toBe(1);
	disposePageSessionResetListener(page);
});
