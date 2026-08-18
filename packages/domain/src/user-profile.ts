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
