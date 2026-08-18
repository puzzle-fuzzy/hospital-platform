import { MAX_USER_PROFILE_VERSION as CONTRACT_MAX_USER_PROFILE_VERSION } from "@hospital/contracts";

/** 普通个人资料允许的性别枚举；实名资料不属于这个领域。 */
export type UserGender = "male" | "female" | "unknown";

/** 由 contracts 与 MySQL INT UNSIGNED 共同冻结的资料版本上限。 */
export const MAX_USER_PROFILE_VERSION = CONTRACT_MAX_USER_PROFILE_VERSION;

/**
 * 平台普通个人资料。
 *
 * 这里故意不包含 openid、unionId、手机号、身份证、真实姓名或头像 URL：
 * 这些字段分别属于微信身份、患者绑定或对象存储边界，不能借个人资料接口
 * “顺便”写入，避免旧端混合更新造成越权和敏感数据扩散。
 */
export type UserProfile = {
	userId: string;
	displayName: string;
	gender: UserGender;
	age: number | null;
	email: string | null;
	/** 版本用于防止两个设备互相覆盖最后一次修改。 */
	version: number;
};

/**
 * 普通资料读模型的固定失败原因。
 *
 * 请求体校验只能约束客户端提交，不能证明 MySQL、内存回放或未来仓储实现
 * 返回的对象仍符合公共 contract。若不在 service 再校验，坏资料会先记录
 * `user.profile.loaded/updated` 成功事件，随后才在 Elysia 响应校验阶段失败，
 * 形成“日志说成功、接口却失败”的错误事实链。
 */
export type UserProfileReadModelViolation =
	| "profile-not-object"
	| "profile-user-mismatch"
	| "profile-display-name-invalid"
	| "profile-gender-invalid"
	| "profile-age-invalid"
	| "profile-email-invalid"
	| "profile-version-invalid";

/** 仓储返回的普通资料不满足公共读模型时使用的固定错误。 */
export class UserProfileReadModelValidationError extends Error {
	readonly violation: UserProfileReadModelViolation;

	constructor(violation: UserProfileReadModelViolation) {
		super("User profile read model is invalid");
		this.name = "UserProfileReadModelValidationError";
		this.violation = violation;
	}
}

function invalidUserProfileReadModel(
	violation: UserProfileReadModelViolation,
): never {
	throw new UserProfileReadModelValidationError(violation);
}

/** 资料展示文本按 Unicode code point 限制，并拒绝首尾空白和控制字符。 */
function hasSafeUserProfileText(
	value: unknown,
	maxLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function isUserGender(value: unknown): value is UserGender {
	return value === "male" || value === "female" || value === "unknown";
}

function isUserEmail(value: unknown): value is string {
	return hasSafeUserProfileText(value, 320) && /^\S+@\S+\.\S+$/.test(value);
}

/**
 * 校验并重新构造仓储返回的普通资料。
 *
 * `expectedUserId` 始终来自当前 Bearer principal，而不是客户端参数。返回
 * 新对象而不是展开仓储对象，避免未来加入手机号、身份或内部审计字段后
 * 顺着资料接口泄漏；首次未持久化的 version=0 默认值不走此函数。
 */
export function normalizeUserProfileReadModel(
	value: unknown,
	expectedUserId: string,
): UserProfile {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidUserProfileReadModel("profile-not-object");
	}
	const record = value as Record<string, unknown>;
	if (record.userId !== expectedUserId) {
		invalidUserProfileReadModel("profile-user-mismatch");
	}
	if (!hasSafeUserProfileText(record.displayName, 64)) {
		invalidUserProfileReadModel("profile-display-name-invalid");
	}
	if (!isUserGender(record.gender)) {
		invalidUserProfileReadModel("profile-gender-invalid");
	}
	const age = record.age;
	if (
		age !== null &&
		(typeof age !== "number" ||
			!Number.isSafeInteger(age) ||
			age < 0 ||
			age > 150)
	) {
		invalidUserProfileReadModel("profile-age-invalid");
	}
	const email = record.email;
	if (email !== null && !isUserEmail(email)) {
		invalidUserProfileReadModel("profile-email-invalid");
	}
	const version = record.version;
	if (
		typeof version !== "number" ||
		!Number.isSafeInteger(version) ||
		version < 1 ||
		version > MAX_USER_PROFILE_VERSION
	) {
		invalidUserProfileReadModel("profile-version-invalid");
	}
	return {
		userId: expectedUserId,
		displayName: record.displayName,
		gender: record.gender,
		age,
		email,
		version,
	};
}

/** 普通个人资料更新命令；未出现的字段保持原值，null 表示清空可选值。 */
export type UserProfileUpdate = {
	userId: string;
	expectedVersion: number;
	displayName?: string;
	gender?: UserGender;
	age?: number | null;
	email?: string | null;
};

/** 还没有资料行时的安全默认值；version=0 代表首次写入需要插入。 */
export function emptyUserProfile(userId: string): UserProfile {
	return {
		userId,
		displayName: "微信用户",
		gender: "unknown",
		age: null,
		email: null,
		version: 0,
	};
}

/** 普通资料字段的语义校验失败，不应被映射成 provider 错误。 */
export class UserProfileInputError extends Error {
	readonly code = "user-profile-invalid" as const;

	constructor(message: string) {
		super(message);
		this.name = "UserProfileInputError";
	}
}

/** 版本条件更新未命中；客户端应重新读取后再决定是否覆盖。 */
export class UserProfileVersionConflictError extends Error {
	readonly code = "user-profile-conflict" as const;

	constructor() {
		super("User profile changed");
		this.name = "UserProfileVersionConflictError";
	}
}

/** 个人资料持久化必须按当前会话的 userId 读取，不能接受客户端 owner。 */
export interface UserProfileRepository {
	findByUserId(userId: string): Promise<UserProfile | undefined>;
	update(input: UserProfileUpdate): Promise<UserProfile>;
}
