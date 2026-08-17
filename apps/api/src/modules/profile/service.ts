import type {
	UserProfilePayload,
	UserProfileUpdatePayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	emptyUserProfile,
	UserProfileInputError,
	UserProfileVersionConflictError,
	type UserGender,
	type UserProfile,
	type UserProfileRepository,
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

function normalizeDisplayName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (!normalized || normalized.length > 64) {
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
	if (!Number.isSafeInteger(value) || value < 0) {
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
			const profile = await this.repository.findByUserId(userId);
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
		const { version, displayName, gender, age, email } = input;
		const normalizedVersion = normalizeVersion(version);
		if (
			displayName === undefined &&
			gender === undefined &&
			age === undefined &&
			email === undefined
		) {
			throw new UserProfileInputError("At least one profile field is required");
		}

		const normalizedDisplayName = normalizeDisplayName(displayName);
		const normalizedGender = normalizeGender(gender);
		const normalizedAge = normalizeAge(age);
		const normalizedEmail = normalizeEmail(email);
		const fields = [
			normalizedDisplayName !== undefined ? "displayName" : undefined,
			normalizedGender !== undefined ? "gender" : undefined,
			normalizedAge !== undefined ? "age" : undefined,
			normalizedEmail !== undefined ? "email" : undefined,
		].filter((field): field is string => Boolean(field));

		try {
			const profile = await this.repository.update({
				userId,
				expectedVersion: normalizedVersion,
				...(normalizedDisplayName !== undefined
					? { displayName: normalizedDisplayName }
					: {}),
				...(normalizedGender !== undefined ? { gender: normalizedGender } : {}),
				...(normalizedAge !== undefined ? { age: normalizedAge } : {}),
				...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
			});
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
			this.logger.error(
				{
					event: "user.profile.update_failed",
					traceId: context.traceId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"User profile update failed",
			);
			throw error;
		}
	}
}
