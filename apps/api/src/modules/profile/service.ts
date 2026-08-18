import type {
	UserProfilePayload,
	UserProfileUpdatePayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	emptyUserProfile,
	MAX_USER_PROFILE_VERSION,
	normalizeUserProfileReadModel,
	type UserGender,
	type UserProfile,
	UserProfileInputError,
	UserProfileReadModelValidationError,
	type UserProfileRepository,
	UserProfileVersionConflictError,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type UserProfileServiceDependencies = {
	logger?: AppLogger;
};

function toPayload(profile: UserProfile): UserProfilePayload["data"] {
	return {
		displayName: profile.displayName,
		gender: profile.gender,
		age: profile.age,
		email: profile.email,
		version: profile.version,
	};
}

/**
 * 普通资料会被页面展示、写入数据库并参与日志关联；控制字符即使没有
 * 超过字段长度，也可能破坏排版、检索和导出边界。这里不静默删除，
 * 而是在服务端输入边界拒绝，避免绕过小程序页面的调用方写入脏资料。
 */
function containsControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
}

/**
 * 契约中的“字符”按 Unicode code point 计数，而不是 JavaScript 的 UTF-16
 * code unit。否则一个 emoji 会被算成两个字符，中文和特殊符号会在服务层
 * 被过早拒绝；数据库 utf8mb4 的 VARCHAR(64) 也不是按 UTF-16 code unit 限制。
 */
function characterCount(value: string): number {
	return Array.from(value).length;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (
		!normalized ||
		characterCount(normalized) > 64 ||
		containsControlCharacter(normalized)
	) {
		throw new UserProfileInputError("displayName is invalid");
	}
	return normalized;
}

function normalizeGender(
	value: UserGender | undefined,
): UserGender | undefined {
	if (value === undefined) return undefined;
	if (value !== "male" && value !== "female" && value !== "unknown") {
		throw new UserProfileInputError("gender is invalid");
	}
	return value;
}

function normalizeVersion(value: number): number {
	if (
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > MAX_USER_PROFILE_VERSION
	) {
		throw new UserProfileInputError("version is invalid");
	}
	return value;
}

function normalizeEmail(
	value: string | null | undefined,
): string | null | undefined {
	if (value === undefined || value === null) return value;
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > 320 ||
		containsControlCharacter(normalized) ||
		!/^\S+@\S+\.\S+$/.test(normalized)
	) {
		throw new UserProfileInputError("email is invalid");
	}
	return normalized;
}

function normalizeAge(
	value: number | null | undefined,
): number | null | undefined {
	if (value === undefined || value === null) return value;
	if (!Number.isSafeInteger(value) || value < 0 || value > 150) {
		throw new UserProfileInputError("age is invalid");
	}
	return value;
}

export class UserProfileService {
	private readonly logger: AppLogger;

	constructor(
		private readonly repository: UserProfileRepository,
		dependencies: UserProfileServiceDependencies = {},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	/**
	 * 资料不存在时只返回安全默认值，不创建隐含副作用。
	 *
	 * 读取也要留下资料域事件：通用 HTTP 日志只能说明请求状态，不能区分
	 * “用户还没有资料行”和“仓储读取失败”。日志只使用 trace、是否已有持久化
	 * 记录和错误类型，不写入 userId、昵称、邮箱或任何资料正文。
	 */
	async get(
		userId: string,
		context: AdapterCallContext,
	): Promise<UserProfilePayload["data"]> {
		this.logger.info(
			{ event: "user.profile.requested", traceId: context.traceId },
			"User profile requested",
		);
		try {
			const storedProfile = await this.repository.findByUserId(userId);
			const profile = storedProfile
				? normalizeUserProfileReadModel(storedProfile, userId)
				: undefined;
			this.logger.info(
				{
					event: "user.profile.loaded",
					traceId: context.traceId,
					persisted: Boolean(profile),
				},
				"User profile loaded",
			);
			return toPayload(profile ?? emptyUserProfile(userId));
		} catch (error) {
			this.logger.error(
				{
					event: "user.profile.read_failed",
					traceId: context.traceId,
					errorType: error instanceof Error ? error.name : "unknown",
					...(error instanceof UserProfileReadModelValidationError
						? { readModelViolation: error.violation }
						: {}),
				},
				"User profile read failed",
			);
			throw error;
		}
	}

	/**
	 * 更新普通资料并使用 version 防止多设备互相覆盖。
	 *
	 * 该方法只处理展示资料；实名、患者关系、微信身份和头像资源必须走各自
	 * contract，不能因为旧端 update 接口曾经接受这些字段就扩大本接口边界。
	 */
	async update(
		userId: string,
		input: UserProfileUpdatePayload,
		context: AdapterCallContext,
	): Promise<UserProfilePayload["data"]> {
		// 更新请求必须先留下独立的开始事件，再进入字段校验和版本条件写入。
		// 这样日志才能区分“请求没有到达资料服务”“到达后输入被拒绝/版本冲突”
		// 和“已经成功写入”，而不是用 updated 或 conflict 反推请求是否发生。
		this.logger.info(
			{ event: "user.profile.update.requested", traceId: context.traceId },
			"User profile update requested",
		);
		try {
			const { version, displayName, gender, age, email } = input;
			const normalizedVersion = normalizeVersion(version);
			if (
				displayName === undefined &&
				gender === undefined &&
				age === undefined &&
				email === undefined
			) {
				throw new UserProfileInputError(
					"At least one profile field is required",
				);
			}
			if (normalizedVersion === MAX_USER_PROFILE_VERSION) {
				// version 必须在成功写入后递增；已经到达 MySQL INT UNSIGNED
				// 上限时，继续调用仓储会产生越界值，甚至可能出现“数据库已变更
				// 但响应校验失败”的半成功语义。这里在任何写入前 fail-closed。
				throw new UserProfileInputError("version cannot be incremented");
			}

			const normalizedDisplayName = normalizeDisplayName(displayName);
			const normalizedGender = normalizeGender(gender);
			const normalizedAge = normalizeAge(age);
			const normalizedEmail = normalizeEmail(email);
			// 字段数量统计请求中明确出现的字段，而不是归一化后的非 undefined 值；
			// null 是合法的清空语义，不能因为归一化后仍为 null 就被记成 0 个字段。
			const fields = [
				displayName !== undefined ? "displayName" : undefined,
				gender !== undefined ? "gender" : undefined,
				age !== undefined ? "age" : undefined,
				email !== undefined ? "email" : undefined,
			].filter((field): field is string => Boolean(field));

			const profile = normalizeUserProfileReadModel(
				await this.repository.update({
					userId,
					expectedVersion: normalizedVersion,
					...(normalizedDisplayName !== undefined
						? { displayName: normalizedDisplayName }
						: {}),
					...(normalizedGender !== undefined
						? { gender: normalizedGender }
						: {}),
					...(normalizedAge !== undefined ? { age: normalizedAge } : {}),
					...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
				}),
				userId,
			);
			this.logger.info(
				{
					event: "user.profile.updated",
					traceId: context.traceId,
					fieldCount: fields.length,
					version: profile.version,
				},
				"User profile updated",
			);
			return toPayload(profile);
		} catch (error) {
			if (error instanceof UserProfileVersionConflictError) {
				// 409 是可预期的并发事实，不应当伪装成服务异常；但仍需留下
				// trace 级低敏事件，方便定位多设备覆盖和客户端重试行为。
				// 这里不记录 userId、version、字段值或请求正文，避免把资料更新
				// 冲突日志变成另一条个人信息泄露路径。
				this.logger.warn(
					{
						event: "user.profile.conflict",
						traceId: context.traceId,
						errorType: error.name,
					},
					"User profile update conflicted with a newer version",
				);
				throw error;
			}
			if (error instanceof UserProfileInputError) {
				// 输入错误同样是资料域失败事实，但不能记录非法字段值、用户身份或
				// 原始请求；只保留固定错误类型供 trace 检索，避免日志成为泄露路径。
				this.logger.warn(
					{
						event: "user.profile.update_failed",
						traceId: context.traceId,
						errorType: error.name,
					},
					"User profile update rejected",
				);
				throw error;
			}
			this.logger.error(
				{
					event: "user.profile.update_failed",
					traceId: context.traceId,
					errorType: error instanceof Error ? error.name : "unknown",
					...(error instanceof UserProfileReadModelValidationError
						? { readModelViolation: error.violation }
						: {}),
				},
				"User profile update failed",
			);
			throw error;
		}
	}
}
