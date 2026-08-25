import { resolve } from "node:path";
import { CLINICAL_DOMAIN_CATALOG } from "./clinical-domain-catalog.mjs";

/** 临床材料包只允许保存脱敏材料的外部引用，不允许把原始报文放进 Git。 */
export const REQUIRED_SAMPLE_KINDS = Object.freeze([
	"request",
	"success-non-empty",
	"success-empty",
	"rejected",
	"timeout",
]);

/**
 * 这些是材料包的固定结构，而不是 Provider 的运行时响应字段。
 * 任何额外字段都拒绝，避免操作者顺手把原始请求体或响应体塞进材料包。
 */
const ROOT_KEYS = [
	"schemaVersion",
	"domainId",
	"contractStatus",
	"source",
	"samples",
	"ownerMapping",
	"fieldAllowlist",
	"redactionRule",
	"errorMapping",
	"acceptanceGates",
	"nextAction",
];

const SOURCE_KEYS = ["documentId", "sha256", "version", "environment"];
const SAMPLE_KEYS = ["kind", "documentId", "sha256", "payloadLocation"];
const OWNER_MAPPING_KEYS = [
	"clientInput",
	"providerIdentity",
	"serverMappingEvidenceRef",
];
const FIELD_KEYS = [
	"name",
	"publicExposure",
	"publicType",
	"nullable",
	"sourceRef",
];
const REDACTION_KEYS = ["response", "logs", "storage"];
const ERROR_KEYS = ["kind", "publicCode", "retryable", "evidenceRef"];
const ACCEPTANCE_KEYS = [
	"ownerIsolation",
	"wrongPatient",
	"unknownProviderState",
	"traceLink",
	"logRedaction",
];

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path, message) {
	throw new Error(`${message}: ${path}`);
}

function assertRecord(value, path) {
	if (!isRecord(value)) fail(path, "expected object");
}

function assertAllowedKeys(value, allowedKeys, path) {
	assertRecord(value, path);
	for (const key of Object.keys(value)) {
		if (!allowedKeys.includes(key)) fail(`${path}.${key}`, "unknown field");
	}
}

function requiredString(value, path, { maxLength = 256 } = {}) {
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(path, "expected non-empty string");
	}
	if (value.length > maxLength) fail(path, "string is too long");
	return value;
}

function requiredBoolean(value, path) {
	if (typeof value !== "boolean") fail(path, "expected boolean");
	return value;
}

/** 控制字符不能出现在外部材料引用中，使用码点检查避免正则 lint 放行歧义。 */
function hasControlCharacter(value) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});
}

/**
 * 校验脱敏材料的外部引用，而不是校验材料正文。
 *
 * 材料包会进入公开仓库，`payloadLocation` 只能是受控材料库中的相对
 * opaque 路径。绝对路径、URL、路径穿越和控制字符都会让后续工具有机会
 * 读取仓库外的文件或把外部资源当成审计证据，因此在最早的准入层拒绝。
 */
function controlledPayloadLocation(value, path) {
	const location = requiredString(value, path, { maxLength: 512 });
	if (
		hasControlCharacter(location) ||
		/^(?:[\\/]|[A-Za-z]:[\\/]|~[\\/])/u.test(location) ||
		/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(location) ||
		location
			.split("/")
			.some(
				(segment) => segment === "" || segment === "." || segment === "..",
			) ||
		!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(location)
	) {
		fail(path, "must reference a controlled relative storage location");
	}
	return location;
}

function assertSha256(value, path) {
	if (
		!/^[a-f0-9]{64}$/iu.test(requiredString(value, path, { maxLength: 64 }))
	) {
		fail(path, "expected SHA-256 fingerprint");
	}
}

function assertStatus(value, path) {
	if (value !== "pending") {
		fail(path, "must remain pending before formal contract approval");
	}
}

function parseSource(value) {
	assertAllowedKeys(value, SOURCE_KEYS, "source");
	const source = {
		documentId: requiredString(value.documentId, "source.documentId"),
		sha256: value.sha256,
		version: requiredString(value.version, "source.version", { maxLength: 64 }),
		environment: requiredString(value.environment, "source.environment", {
			maxLength: 64,
		}),
	};
	assertSha256(source.sha256, "source.sha256");
	return source;
}

function parseSamples(value) {
	if (!Array.isArray(value)) fail("samples", "expected array");
	const seen = new Set();
	const samples = value.map((sample, index) => {
		const path = `samples[${index}]`;
		assertAllowedKeys(sample, SAMPLE_KEYS, path);
		const kind = requiredString(sample.kind, `${path}.kind`, { maxLength: 32 });
		if (!REQUIRED_SAMPLE_KINDS.includes(kind)) {
			fail(`${path}.kind`, "unknown sample kind");
		}
		if (seen.has(kind)) fail(`${path}.kind`, "duplicate sample kind");
		seen.add(kind);
		const result = {
			kind,
			documentId: requiredString(sample.documentId, `${path}.documentId`),
			sha256: sample.sha256,
			payloadLocation: controlledPayloadLocation(
				sample.payloadLocation,
				`${path}.payloadLocation`,
			),
		};
		assertSha256(result.sha256, `${path}.sha256`);
		return result;
	});
	for (const kind of REQUIRED_SAMPLE_KINDS) {
		if (!seen.has(kind)) fail("samples", `missing sample kind: ${kind}`);
	}
	return samples;
}

function parseOwnerMapping(value) {
	assertAllowedKeys(value, OWNER_MAPPING_KEYS, "ownerMapping");
	const result = {
		clientInput: requiredString(value.clientInput, "ownerMapping.clientInput"),
		providerIdentity: requiredString(
			value.providerIdentity,
			"ownerMapping.providerIdentity",
		),
		serverMappingEvidenceRef: requiredString(
			value.serverMappingEvidenceRef,
			"ownerMapping.serverMappingEvidenceRef",
		),
	};
	if (result.clientInput !== "platform-patient-id") {
		fail("ownerMapping.clientInput", "must be platform-patient-id");
	}
	if (result.providerIdentity !== "server-only") {
		fail("ownerMapping.providerIdentity", "must be server-only");
	}
	return result;
}

function parseFieldAllowlist(value) {
	if (!Array.isArray(value) || value.length === 0) {
		fail("fieldAllowlist", "must be a non-empty array");
	}
	return value.map((field, index) => {
		const path = `fieldAllowlist[${index}]`;
		assertAllowedKeys(field, FIELD_KEYS, path);
		const publicExposure = requiredString(
			field.publicExposure,
			`${path}.publicExposure`,
		);
		if (!["public", "redacted", "server-only"].includes(publicExposure)) {
			fail(`${path}.publicExposure`, "unknown exposure policy");
		}
		return {
			name: requiredString(field.name, `${path}.name`),
			publicExposure,
			publicType: requiredString(field.publicType, `${path}.publicType`),
			nullable: requiredBoolean(field.nullable, `${path}.nullable`),
			sourceRef: requiredString(field.sourceRef, `${path}.sourceRef`),
		};
	});
}

function parseRedactionRule(value) {
	assertAllowedKeys(value, REDACTION_KEYS, "redactionRule");
	return Object.fromEntries(
		REDACTION_KEYS.map((key) => [
			key,
			requiredString(value[key], `redactionRule.${key}`, { maxLength: 512 }),
		]),
	);
}

function parseErrorMapping(value) {
	if (!Array.isArray(value) || value.length === 0) {
		fail("errorMapping", "must be a non-empty array");
	}
	const seen = new Set();
	return value.map((errorMapping, index) => {
		const path = `errorMapping[${index}]`;
		assertAllowedKeys(errorMapping, ERROR_KEYS, path);
		const kind = requiredString(errorMapping.kind, `${path}.kind`, {
			maxLength: 64,
		});
		if (seen.has(kind)) fail(`${path}.kind`, "duplicate error kind");
		seen.add(kind);
		return {
			kind,
			publicCode: requiredString(errorMapping.publicCode, `${path}.publicCode`),
			retryable: requiredBoolean(errorMapping.retryable, `${path}.retryable`),
			evidenceRef: requiredString(
				errorMapping.evidenceRef,
				`${path}.evidenceRef`,
			),
		};
	});
}

function parseAcceptanceGates(value) {
	assertAllowedKeys(value, ACCEPTANCE_KEYS, "acceptanceGates");
	return Object.fromEntries(
		ACCEPTANCE_KEYS.map((key) => {
			const status = requiredString(value[key], `acceptanceGates.${key}`, {
				maxLength: 32,
			});
			if (!["pending", "evidenced"].includes(status)) {
				fail(`acceptanceGates.${key}`, "must be pending or evidenced");
			}
			return [key, status];
		}),
	);
}

function domainExists(domainId) {
	return CLINICAL_DOMAIN_CATALOG.some((domain) => domain.id === domainId);
}

/**
 * 校验一个临床 contract 材料包的机器边界。
 *
 * 这个函数不验证 Provider 医学内容是否正确，也不把 `pending` 升级成
 * `confirmed`；它只确保正式材料到达后有完整的样例引用、owner 映射、
 * 字段白名单、错误分类和验收门，且原始报文不会进入新仓库。
 */
export function validateClinicalContractPacket(value) {
	assertAllowedKeys(value, ROOT_KEYS, "packet");
	if (value.schemaVersion !== 1) fail("schemaVersion", "must be 1");
	const domainId = requiredString(value.domainId, "domainId", {
		maxLength: 64,
	});
	if (!domainExists(domainId)) fail("domainId", "unknown clinical domain");
	assertStatus(value.contractStatus, "contractStatus");
	const nextAction = requiredString(value.nextAction, "nextAction", {
		maxLength: 512,
	});
	const packet = {
		schemaVersion: 1,
		domainId,
		contractStatus: "pending",
		source: parseSource(value.source),
		samples: parseSamples(value.samples),
		ownerMapping: parseOwnerMapping(value.ownerMapping),
		fieldAllowlist: parseFieldAllowlist(value.fieldAllowlist),
		redactionRule: parseRedactionRule(value.redactionRule),
		errorMapping: parseErrorMapping(value.errorMapping),
		acceptanceGates: parseAcceptanceGates(value.acceptanceGates),
		nextAction,
	};

	return {
		valid: true,
		domainId: packet.domainId,
		contractStatus: packet.contractStatus,
		sampleKinds: packet.samples.map((sample) => sample.kind),
		fieldCount: packet.fieldAllowlist.length,
		errorKinds: packet.errorMapping.map((errorMapping) => errorMapping.kind),
		acceptanceGates: packet.acceptanceGates,
		businessReady: false,
	};
}

function parseArguments(argv) {
	const normalized = argv[0] === "--" ? argv.slice(1) : argv;
	if (normalized.length !== 1 || normalized[0] === "--help") {
		return { help: normalized[0] === "--help", filePath: undefined };
	}
	return { help: false, filePath: normalized[0] };
}

if (import.meta.main) {
	const { help, filePath } = parseArguments(process.argv.slice(2));
	if (help || !filePath) {
		console.error(
			"用法：pnpm clinical:packet:audit -- <脱敏 contract 材料包.json>",
		);
		process.exitCode = help ? 0 : 2;
	} else {
		try {
			const value = await Bun.file(resolve(process.cwd(), filePath)).json();
			console.log(
				JSON.stringify(validateClinicalContractPacket(value), null, 2),
			);
		} catch (error) {
			console.error(
				error instanceof Error
					? error.message
					: "clinical contract packet audit failed",
			);
			process.exitCode = 1;
		}
	}
}
