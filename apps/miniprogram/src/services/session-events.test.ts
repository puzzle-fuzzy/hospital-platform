import { expect, test } from "bun:test";
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
