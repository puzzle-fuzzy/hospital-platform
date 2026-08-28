import { connect, type TLSSocket } from "node:tls";
import { stdout } from "node:process";

export type ProviderTlsAuditResult = {
	host: string;
	port: number;
	status: "passed" | "failed";
	connected: boolean;
	elapsedMs: number;
	verificationError?: string;
	errorCode?: string;
	certificate?: {
		commonName?: string;
		validFrom?: string;
		validTo?: string;
	};
};

/**
 * TLS 诊断只接受 HTTPS origin，不接受用户名、密码或非标准协议。
 * 这样可以避免把凭据、业务路径或“跳过证书验证”的意图混入发布检查。
 */
export function parseProviderTlsUrl(input: string): URL {
	const url = new URL(input.trim());
	if (url.protocol !== "https:") {
		throw new Error("provider TLS audit requires an HTTPS URL");
	}
	if (url.username || url.password) {
		throw new Error("provider TLS audit does not accept URL credentials");
	}
	return url;
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code.length > 0 ? code : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "TLS handshake failed";
}

function certificateSummary(
	socket: TLSSocket,
): ProviderTlsAuditResult["certificate"] {
	const certificate = socket.getPeerCertificate();
	if (!certificate || Object.keys(certificate).length === 0) return undefined;

	const commonName =
		typeof certificate.subject?.CN === "string"
			? certificate.subject.CN
			: undefined;
	const validFrom =
		typeof certificate.valid_from === "string"
			? certificate.valid_from
			: undefined;
	const validTo =
		typeof certificate.valid_to === "string" ? certificate.valid_to : undefined;

	return {
		...(commonName ? { commonName } : {}),
		...(validFrom ? { validFrom } : {}),
		...(validTo ? { validTo } : {}),
	};
}

/**
 * 只执行一次带默认 CA 校验的 TLS 握手，不发送 HTTP 请求。
 *
 * `rejectUnauthorized: true` 是故意的：证书过期、主机名不匹配、链不完整
 * 都必须在这里失败，不能为了让业务 smoke 通过而降级成 `-k` 或自定义信任。
 */
export function auditProviderTls(
	input: string,
	options: { timeoutMs?: number } = {},
): Promise<ProviderTlsAuditResult> {
	const url = parseProviderTlsUrl(input);
	const timeoutMs = options.timeoutMs ?? 5_000;
	const port = Number(url.port || 443);
	const startedAt = Date.now();

	return new Promise((resolve) => {
		let settled = false;
		let socket: TLSSocket | undefined;

		const finish = (
			result: Omit<ProviderTlsAuditResult, "elapsedMs">,
		): void => {
			if (settled) return;
			settled = true;
			socket?.destroy();
			resolve({ ...result, elapsedMs: Date.now() - startedAt });
		};

		const finishFailure = (error: unknown): void => {
			const code = errorCode(error);
			finish({
				host: url.hostname,
				port,
				status: "failed",
				connected: false,
				...(code ? { errorCode: code } : {}),
				verificationError: errorMessage(error),
			});
		};

		try {
			socket = connect({
				host: url.hostname,
				port,
				servername: url.hostname,
				rejectUnauthorized: true,
			});
		} catch (error) {
			finishFailure(error);
			return;
		}
		socket.setTimeout(timeoutMs, () => {
			finishFailure(
				Object.assign(new Error("TLS handshake timed out"), {
					code: "TLS_TIMEOUT",
				}),
			);
		});
		socket.once("secureConnect", () => {
			if (!socket?.authorized) {
				finish({
					host: url.hostname,
					port,
					status: "failed",
					connected: true,
					...(socket?.authorizationError
						? { verificationError: socket.authorizationError }
						: {}),
				});
				return;
			}
			finish({
				host: url.hostname,
				port,
				status: "passed",
				connected: true,
				certificate: certificateSummary(socket),
			});
		});
		socket.once("error", finishFailure);
	});
}

function printResult(result: ProviderTlsAuditResult): void {
	const certificate = result.certificate;
	stdout.write(
		`${JSON.stringify(
			{
				...result,
				...(certificate
					? {
							certificate: {
								...(certificate.commonName
									? { commonName: certificate.commonName }
									: {}),
								...(certificate.validFrom
									? { validFrom: certificate.validFrom }
									: {}),
								...(certificate.validTo
									? { validTo: certificate.validTo }
									: {}),
							},
						}
					: {}),
			},
			null,
			2,
		)}\n`,
	);
}

function readCliUrl(): string {
	const urlFlagIndex = Bun.argv.indexOf("--url");
	if (urlFlagIndex >= 0) {
		const value = Bun.argv[urlFlagIndex + 1]?.trim();
		if (!value || value.startsWith("--")) {
			throw new Error("--url requires an HTTPS provider origin");
		}
		return value;
	}
	const configuredUrl = Bun.env.ZHONGYANG_BASE_URL?.trim();
	if (!configuredUrl) {
		throw new Error(
			"provider TLS audit requires --url <https://provider-host> or ZHONGYANG_BASE_URL",
		);
	}
	return configuredUrl;
}

if (import.meta.main) {
	try {
		const result = await auditProviderTls(readCliUrl());
		printResult(result);
		if (result.status !== "passed") process.exitCode = 1;
	} catch (error) {
		stdout.write(
			`${JSON.stringify(
				{
					status: "failed",
					errorCode: errorCode(error) ?? "INVALID_INPUT",
					verificationError: errorMessage(error),
				},
				null,
				2,
			)}\n`,
		);
		process.exitCode = 2;
	}
}
