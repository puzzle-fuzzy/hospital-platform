import { access } from "node:fs/promises";
import { stdin, stdout } from "node:process";

/**
 * 受控只读验收的默认能力集合。
 *
 * 这里故意不包含 `patient-sync`：同步虽然是幂等 POST，但仍会触发 Provider
 * 读取和平台读模型写入，必须由运维人员明确选择，不能因为执行 smoke 就顺手发生。
 * 支付、医保、退款、预约写入和 HIS 回写也不属于这个工具的能力范围。
 */
const DEFAULT_CAPABILITIES =
	"session,profile-read,patients,appointment-directory,appointment-records,outpatient-payments";

type SmokeEnvironment = NodeJS.ProcessEnv & {
	HOSPITAL_ACCESS_TOKEN: string;
	HOSPITAL_PATIENT_ID: string;
	HOSPITAL_SMOKE_CAPABILITIES: string;
};

/**
 * 交互式终端中隐藏读取一行文本。
 *
 * token 和内部 patientId 都不应该出现在 shell 命令参数、shell history、
 * 临时文件或本工具自己的日志里。这里直接在 TTY 上逐字符读取，回车后只
 * 返回内存中的字符串给子进程环境；非 TTY 场景直接拒绝，避免调用方把密钥
 * 通过可被记录的管道误传进来。
 */
async function readHiddenLine(prompt: string): Promise<string> {
	if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
		throw new Error(
			"provider smoke secure wrapper requires an interactive TTY; no credential was read",
		);
	}

	stdout.write(prompt);
	stdin.setRawMode(true);
	stdin.resume();

	return await new Promise<string>((resolve, reject) => {
		let value = "";

		const cleanup = (): void => {
			stdin.removeListener("data", onData);
			stdin.setRawMode?.(false);
			stdin.pause();
		};

		const onData = (chunk: Buffer | string): void => {
			const text = String(chunk);
			for (const character of text) {
				if (character === "\r" || character === "\n") {
					cleanup();
					stdout.write("\n");
					resolve(value);
					return;
				}
				if (character === "\u0003") {
					cleanup();
					stdout.write("\n");
					reject(new Error("provider smoke secure wrapper was cancelled"));
					return;
				}
				if (character === "\u007f" || character === "\b") {
					value = value.slice(0, -1);
					continue;
				}
				// 控制字符不能进入环境变量；普通 token 字符不回显，避免终端录屏泄密。
				if (character >= " ") value += character;
			}
		};

		stdin.on("data", onData);
	});
}

function getBundlePath(): string {
	const bundleFlagIndex = Bun.argv.indexOf("--bundle");
	if (bundleFlagIndex >= 0) {
		const bundle = Bun.argv[bundleFlagIndex + 1]?.trim();
		if (!bundle || bundle.startsWith("--")) {
			throw new Error("--bundle requires the provider-directory-smoke.js path");
		}
		return bundle;
	}
	return "apps/worker/dist/provider-directory-smoke.js";
}

function printHelp(): void {
	stdout.write(`安全只读 smoke 凭据注入器\n\n`);
	stdout.write(
		"用法：bun tools/provider-smoke-secure.ts [--bundle <provider-directory-smoke.js>]\n",
	);
	stdout.write(
		"说明：token 和内部 patientId 只进入当前子进程环境，不写入文件或命令参数。\n",
	);
}

if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
	printHelp();
	process.exit(0);
}

const bundlePath = getBundlePath();
await access(bundlePath);

let accessToken = "";
let patientId = "";
try {
	accessToken = (
		await readHiddenLine("平台 Bearer token（不会回显）：")
	).trim();
	patientId = (
		await readHiddenLine("内部 opaque patientId（不会回显）：")
	).trim();
	if (!accessToken || !patientId) {
		throw new Error(
			"token and patientId are required; no smoke request was started",
		);
	}

	const childEnvironment: SmokeEnvironment = {
		...process.env,
		HOSPITAL_ACCESS_TOKEN: accessToken,
		HOSPITAL_PATIENT_ID: patientId,
		HOSPITAL_SMOKE_CAPABILITIES:
			process.env.HOSPITAL_SMOKE_CAPABILITIES || DEFAULT_CAPABILITIES,
	};

	/**
	 * 子进程继承 API 地址、版本前缀和 Provider readiness 配置，但不会把凭据
	 * 拼到 argv。smoke 自己仍负责格式、owner 归属和响应脱敏校验；wrapper
	 * 只负责缩小凭据生命周期，不绕过任何业务门禁。
	 */
	const child = Bun.spawn([process.execPath, bundlePath], {
		env: childEnvironment,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	process.exitCode = exitCode;
} finally {
	// 解除当前 wrapper 对字符串的引用；子进程退出后其环境随进程一起销毁。
	// 这不是对运行时内存的绝对擦除承诺，因此文档仍要求使用短时凭据。
	accessToken = "";
	patientId = "";
}
