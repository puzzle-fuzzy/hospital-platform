import { resolve } from "node:path";
import type { AdapterCallContext } from "@hospital/domain";
import {
	LegacyFsiContractError,
	type LegacyFsiInfno,
} from "./legacy-fsi-contract";
import {
	type LegacyFsiCryptoGateway,
	type LegacyFsiOpenedPayload,
	type LegacyFsiSealedEnvelope,
	validateLegacyFsiSealedEnvelope,
} from "./legacy-fsi-crypto";

const SDK_MAIN_CLASS =
	"com.hospital.platform.medicalinsurance.OfficialFsiSdkCli";
const SDK_JAR_NAME = "med-request-data-sdk-2.1.4.jar";
const DEFAULT_SDK_DIRECTORY = resolve(
	process.cwd(),
	"packages/adapters/dist/java-sdk",
);
const DEFAULT_TIMEOUT_MS = 15_000;

export type OfficialJavaLegacyFsiConfig = {
	appId: string;
	appSecret: string;
	channelPrivateKeyB64: string;
	platformPublicKeyB64: string;
	/** 构建产物中的 java-sdk 目录；默认使用当前 release 的 adapters/dist。 */
	sdkDirectory?: string;
	javaBinary?: string;
	version?: string;
	/** 官方 SDK 默认开启；保留显式开关以便后续按 Provider 合同调整。 */
	stringValue?: boolean;
	verifyResponseStrict?: boolean;
	timeoutMs?: number;
};

function objectValue(
	value: unknown,
	infno: LegacyFsiInfno,
	field: string,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new LegacyFsiContractError(
			infno,
			`official Java SDK ${field} must be a JSON object`,
		);
	}
	return value as Record<string, unknown>;
}

function environment(
	config: OfficialJavaLegacyFsiConfig,
): Record<string, string> {
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	return {
		...inherited,
		MBS_APP_ID: config.appId,
		MBS_APP_SECRET: config.appSecret,
		MBS_SM2_PRIVATE_KEY_B64: config.channelPrivateKeyB64,
		MBS_SM2_PLATFORM_PUBLIC_B64: config.platformPublicKeyB64,
		MBS_JAVA_SDK_VERSION: config.version ?? "2.0.1",
		MBS_JAVA_SDK_STRING_VALUE: String(config.stringValue ?? true),
		MBS_SM2_VERIFY_STRICT: String(config.verifyResponseStrict === true),
	};
}

function classPath(sdkDirectory: string): string {
	const separator = process.platform === "win32" ? ";" : ":";
	return [
		resolve(sdkDirectory, "classes"),
		resolve(sdkDirectory, "lib", SDK_JAR_NAME),
		resolve(sdkDirectory, "lib", "*"),
	].join(separator);
}

async function invokeSdk(
	operation: "seal" | "open",
	input: string,
	config: OfficialJavaLegacyFsiConfig,
	infno: LegacyFsiInfno,
): Promise<string> {
	const sdkDirectory = resolve(config.sdkDirectory ?? DEFAULT_SDK_DIRECTORY);
	const processHandle = Bun.spawn(
		[
			config.javaBinary ?? "java",
			"-Dorg.apache.commons.logging.Log=org.apache.commons.logging.impl.NoOpLog",
			"-cp",
			classPath(sdkDirectory),
			SDK_MAIN_CLASS,
			operation,
		],
		{
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: environment(config),
		},
	);
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		processHandle.kill();
	}, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	try {
		await processHandle.stdin.write(input);
		processHandle.stdin.end();
		const [exitCode, stdout] = await Promise.all([
			processHandle.exited,
			new Response(processHandle.stdout).text(),
			new Response(processHandle.stderr).text(),
		]);
		if (timedOut || exitCode !== 0) {
			throw new LegacyFsiContractError(
				infno,
				timedOut
					? "official Java SDK timed out"
					: "official Java SDK process failed",
			);
		}
		return stdout.trim();
	} finally {
		clearTimeout(timeout);
	}
}

function parseSdkResult(
	value: string,
	infno: LegacyFsiInfno,
): Record<string, unknown> {
	try {
		return objectValue(JSON.parse(value), infno, "result");
	} catch (error) {
		if (error instanceof LegacyFsiContractError) throw error;
		throw new LegacyFsiContractError(
			infno,
			"official Java SDK returned non-JSON output",
		);
	}
}

/**
 * 新服务的官方 SDK crypto boundary。
 *
 * 业务层、固定 FSI 路由和 relay 不变；只有封套生成/回包解密通过官方
 * `med-request-data-sdk-2.1.4.jar` 执行。Bun 不直接加载 JAR，避免把 Java
 * SDK 的实现复制成第二套密码学实现。
 */
export function createOfficialJavaLegacyFsiCrypto(
	config: OfficialJavaLegacyFsiConfig,
): LegacyFsiCryptoGateway {
	return {
		async seal(
			input: { infno: LegacyFsiInfno; data: Record<string, unknown> },
			_context: AdapterCallContext,
		): Promise<LegacyFsiSealedEnvelope> {
			const result = parseSdkResult(
				await invokeSdk(
					"seal",
					JSON.stringify(input.data),
					config,
					input.infno,
				),
				input.infno,
			);
			return validateLegacyFsiSealedEnvelope(result, input.infno);
		},

		async open(
			input: {
				infno: LegacyFsiInfno;
				response: Record<string, unknown>;
			},
			_context: AdapterCallContext,
		): Promise<LegacyFsiOpenedPayload> {
			const result = parseSdkResult(
				await invokeSdk(
					"open",
					JSON.stringify(input.response),
					config,
					input.infno,
				),
				input.infno,
			);
			return {
				data: objectValue(result.data, input.infno, "data"),
				signVerified: config.verifyResponseStrict === true,
			};
		},
	};
}
