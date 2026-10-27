import { afterEach, expect, test } from "bun:test";

type KeyboardPage = {
	data: {
		keyboardHeight: number;
		inputValue: string;
		messages: Array<{ id: string; content: string }>;
		scrollIntoView: string;
	};
	setData(patch: Partial<KeyboardPage["data"]>, callback?: () => void): void;
	onLoad(): void;
	onInputFocus(event: { detail: { height: unknown } }): void;
	onKeyboardHeightChange(event: { detail: { height: unknown } }): void;
	updateKeyboardHeight(height: number): void;
	onHide(): void;
	onUnload(): void;
};

const originals = new Map(
	["wx", "Page", "fetch"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
const activePages: KeyboardPage[] = [];
let definition: KeyboardPage | undefined;

afterEach(() => {
	for (const page of activePages.splice(0)) page.onUnload();
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

async function keyboardFixture(
	options: {
		data?: Partial<KeyboardPage["data"]>;
		deferCallbacks?: boolean;
	} = {},
) {
	const patches: Array<Partial<KeyboardPage["data"]>> = [];
	const callbacks: Array<() => void> = [];
	const forbidNetwork = () => {
		throw new Error("Keyboard regression cannot access the network");
	};
	Object.assign(globalThis, {
		Page: (page: KeyboardPage) => {
			definition = page;
		},
		fetch: forbidNetwork,
		wx: {
			request: forbidNetwork,
			getRecorderManager: () => ({
				onStop: () => undefined,
				onError: () => undefined,
			}),
		},
	});
	if (!definition) {
		const path = "../pages/smart-guide/smart-guide";
		await import(`${path}.ts?keyboard-regression`);
	}
	if (!definition) throw new Error("Smart-guide page was not registered");
	const page: KeyboardPage = {
		...definition,
		data: { ...definition.data, messages: [], ...options.data },
		setData(patch, callback) {
			patches.push({ ...patch });
			Object.assign(this.data, patch);
			if (!callback) return;
			if (options.deferCallbacks) callbacks.push(callback);
			else callback();
		},
	};
	activePages.push(page);
	page.onLoad();
	return { page, patches, callbacks };
}

// 原生事件替身只验证页面状态与回调顺序，不能证明真机键盘的视觉布局。
test("guide keyboard follows focus, height changes and native dismissal", async () => {
	const { page, patches } = await keyboardFixture();
	expect(page.data.keyboardHeight).toBe(0);

	page.onInputFocus({ detail: { height: 326 } });
	expect(page.data.keyboardHeight).toBe(326);
	page.onKeyboardHeightChange({ detail: { height: 352 } });
	expect(page.data.keyboardHeight).toBe(352);
	page.onKeyboardHeightChange({ detail: { height: 0 } });
	expect(page.data.keyboardHeight).toBe(0);
	expect(patches.map((patch) => patch.keyboardHeight)).toEqual([326, 352, 0]);
	expect(page.data.scrollIntoView).toBe("");
});

test("guide ignores duplicate keyboard heights without rewriting page data", async () => {
	const { page, patches } = await keyboardFixture();
	page.onKeyboardHeightChange({ detail: { height: 0 } });
	expect(patches).toHaveLength(0);
	page.onInputFocus({ detail: { height: 326 } });
	page.onKeyboardHeightChange({ detail: { height: 326 } });
	page.onInputFocus({ detail: { height: 326 } });
	expect(patches).toHaveLength(1);
});

test("guide ignores invalid native keyboard height values", async () => {
	const { page, patches } = await keyboardFixture();
	for (const height of [
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		"326",
		undefined,
		null,
	]) {
		page.onInputFocus({ detail: { height } });
		page.onKeyboardHeightChange({ detail: { height } });
	}
	expect(page.data.keyboardHeight).toBe(0);
	expect(patches).toHaveLength(0);
});

test("guide hiding restores layout while preserving the draft and conversation", async () => {
	const messages = [{ id: "fixture-message", content: "测试对话" }];
	const { page, patches, callbacks } = await keyboardFixture({
		data: { inputValue: "尚未发送的描述", messages },
		deferCallbacks: true,
	});
	page.onInputFocus({ detail: { height: 326 } });
	page.onHide();
	expect(page.data.keyboardHeight).toBe(0);
	expect(page.data.inputValue).toBe("尚未发送的描述");
	expect(page.data.messages).toEqual(messages);
	const writesAfterHide = patches.length;
	callbacks.shift()?.();
	expect(patches).toHaveLength(writesAfterHide);
});

test("guide keyboard state is isolated between stacked page instances", async () => {
	const first = await keyboardFixture();
	const second = await keyboardFixture();
	first.page.onInputFocus({ detail: { height: 326 } });
	expect(second.page.data.keyboardHeight).toBe(0);
	expect(second.patches).toHaveLength(0);
	second.page.onInputFocus({ detail: { height: 352 } });
	first.page.onHide();
	expect(first.page.data.keyboardHeight).toBe(0);
	expect(second.page.data.keyboardHeight).toBe(352);
});

test("guide scrolls existing messages into the resized content viewport", async () => {
	const { page, patches, callbacks } = await keyboardFixture({
		data: {
			messages: [{ id: "fixture-message", content: "测试对话" }],
			scrollIntoView: "fixture-message",
		},
		deferCallbacks: true,
	});
	page.onKeyboardHeightChange({ detail: { height: 326 } });
	expect(page.data.scrollIntoView).toBe("");
	expect(callbacks).toHaveLength(1);
	callbacks.shift()?.();
	expect(page.data.scrollIntoView).toBe("guide-message-end");
	expect(patches).toHaveLength(2);
});

test("guide rejects a delayed scroll callback for an older keyboard height", async () => {
	const { page, patches, callbacks } = await keyboardFixture({
		data: { messages: [{ id: "fixture-message", content: "测试对话" }] },
		deferCallbacks: true,
	});
	page.onKeyboardHeightChange({ detail: { height: 326 } });
	page.onKeyboardHeightChange({ detail: { height: 352 } });
	expect(callbacks).toHaveLength(2);
	callbacks.shift()?.();
	expect(page.data.scrollIntoView).toBe("");
	expect(patches).toHaveLength(2);
	callbacks.shift()?.();
	expect(page.data.scrollIntoView).toBe("guide-message-end");
	expect(patches).toHaveLength(3);
});

test("guide ignores native events and delayed layout callbacks after unload", async () => {
	const { page, patches, callbacks } = await keyboardFixture({
		data: { messages: [{ id: "fixture-message", content: "测试对话" }] },
		deferCallbacks: true,
	});
	page.onKeyboardHeightChange({ detail: { height: 326 } });
	page.onUnload();
	page.onInputFocus({ detail: { height: 352 } });
	page.onKeyboardHeightChange({ detail: { height: 0 } });
	page.updateKeyboardHeight(400);
	callbacks.shift()?.();
	expect(page.data.keyboardHeight).toBe(326);
	expect(page.data.scrollIntoView).toBe("");
	expect(patches).toHaveLength(1);
});
