import { beforeAll, expect, test } from "bun:test";

type AvatarInstance = {
	data: { imageSrc: string };
	setData(data: { imageSrc: string }): void;
};

type AvatarDefinition = {
	properties: {
		src: {
			value: string;
			observer(this: AvatarInstance, src: string): void;
		};
		label: { value: string };
	};
	data: { imageSrc: string };
	methods: {
		onImageError(
			this: AvatarInstance,
			event: WechatMiniprogram.CustomEvent,
		): void;
	};
};

let definition: AvatarDefinition;

beforeAll(async () => {
	const runtime = globalThis as typeof globalThis & {
		Component?: typeof Component;
	};
	const originalComponent = runtime.Component;
	runtime.Component = ((options: AvatarDefinition) => {
		definition = options;
	}) as unknown as typeof Component;
	try {
		await import("../components/doctor-avatar/doctor-avatar");
	} finally {
		if (originalComponent) runtime.Component = originalComponent;
		else delete runtime.Component;
	}
});

function createAvatar(): AvatarInstance {
	return {
		data: { ...definition.data },
		setData(data) {
			Object.assign(this.data, data);
		},
	};
}

function imageError(avatar: AvatarInstance, src: string) {
	definition.methods.onImageError.call(avatar, {
		currentTarget: { dataset: { src } },
	} as unknown as WechatMiniprogram.CustomEvent);
}

test("医生头像未提供照片时直接展示本地默认头像", () => {
	const avatar = createAvatar();
	expect(definition.properties.label.value).toBe("医生照片");
	expect(avatar.data.imageSrc).toBe(
		"/assets/legacy-user/default-doctor-avatar.png",
	);
	definition.properties.src.observer.call(avatar, "   ");
	expect(avatar.data.imageSrc).toBe(
		"/assets/legacy-user/default-doctor-avatar.png",
	);
});

test("照片加载失败后回退默认头像，更换 URL 后恢复加载", () => {
	const avatar = createAvatar();
	const firstSrc = "https://hospital.example/photos/doctor-1.jpg";
	const nextSrc = "https://hospital.example/photos/doctor-2.jpg";
	definition.properties.src.observer.call(avatar, firstSrc);
	expect(avatar.data.imageSrc).toBe(firstSrc);
	imageError(avatar, firstSrc);
	expect(avatar.data.imageSrc).toBe(
		"/assets/legacy-user/default-doctor-avatar.png",
	);
	definition.properties.src.observer.call(avatar, nextSrc);
	expect(avatar.data.imageSrc).toBe(nextSrc);
});

test("旧照片迟到的错误事件不能覆盖已切换的新照片", () => {
	const avatar = createAvatar();
	const firstSrc = "https://hospital.example/photos/doctor-1.jpg";
	const nextSrc = "https://hospital.example/photos/doctor-2.jpg";
	definition.properties.src.observer.call(avatar, firstSrc);
	definition.properties.src.observer.call(avatar, nextSrc);
	imageError(avatar, firstSrc);
	expect(avatar.data.imageSrc).toBe(nextSrc);
	imageError(avatar, nextSrc);
	expect(avatar.data.imageSrc).toBe(
		"/assets/legacy-user/default-doctor-avatar.png",
	);
});

test("清空照片后旧错误被忽略，本地头像错误不会反复设置数据", () => {
	const avatar = createAvatar();
	const src = "https://hospital.example/photos/doctor-1.jpg";
	definition.properties.src.observer.call(avatar, src);
	definition.properties.src.observer.call(avatar, "");
	let updates = 0;
	avatar.setData = () => {
		updates += 1;
	};
	imageError(avatar, src);
	imageError(avatar, avatar.data.imageSrc);
	expect(updates).toBe(0);
});
