import type { NetworkObservation, QueryCapture } from "./types.ts";

type JsonObject = Record<string, unknown>;

export type NormalizedField = {
	path: string;
	name: string;
	type: string;
	required: boolean | null;
	length: string;
	source: string;
	sourceDescription: string;
	description: string;
};

export type NormalizedApiDocument = {
	schemaVersion: "zhongyang-api-doc-v1";
	query: string;
	status: QueryCapture["status"];
	capturedAt: string;
	source: {
		title: string;
		pageUrl: string;
		networkUrl: string;
	};
	api: {
		id: string;
		name: string;
		method: string;
		path: string;
		contentType: string;
		product: string;
		category: string;
		description: string;
		businessFunction: string;
		businessScope: string[];
		createdAt: string;
		updatedAt: string;
		preInterfaces: Array<{ name: string; path: string }>;
	};
	request: {
		fields: NormalizedField[];
		example: unknown;
		schema: JsonObject;
	};
	response: {
		fields: NormalizedField[];
		example: unknown;
		schema: JsonObject;
	};
};

function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function requiredValue(value: unknown): boolean | null {
	if (value === true || value === 1 || value === "1") return true;
	if (value === false || value === 0 || value === "0") return false;
	return null;
}

function parseExample(value: unknown): unknown {
	if (typeof value !== "string" || value.trim() === "") return value ?? null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function flattenFields(node: JsonObject): NormalizedField[] {
	const fields: NormalizedField[] = [];
	const visit = (parent: JsonObject, parentPath: string): void => {
		const children = parent.objectProps;
		if (!Array.isArray(children)) return;
		for (const childValue of children) {
			if (!isRecord(childValue)) continue;
			const name = stringValue(childValue.name);
			if (!name) continue;
			const path = parentPath
				? `${parentPath}${parent.type === "array" ? "[]" : ""}.${name}`
				: name;
			fields.push({
				path,
				name,
				type: stringValue(childValue.type) || "unknown",
				required: requiredValue(childValue.required),
				length: stringValue(childValue.lengthRange),
				source: stringValue(childValue.paramSource),
				sourceDescription: stringValue(childValue.sourceDesc),
				description: stringValue(childValue.desc),
			});
			visit(childValue, path);
		}
	};
	visit(node, "");
	return fields;
}

function findApiDetail(capture: QueryCapture):
	| {
			data: JsonObject;
			observation: NetworkObservation;
	  }
	| undefined {
	for (const observation of capture.network) {
		if (!isRecord(observation.body)) continue;
		const data = observation.body.data;
		if (
			isRecord(data) &&
			typeof data.interfaceName === "string" &&
			isRecord(data.reqBody) &&
			isRecord(data.resBody)
		) {
			return { data, observation };
		}
	}
	return undefined;
}

export function normalizeApiCapture(
	capture: QueryCapture,
): NormalizedApiDocument | undefined {
	const match = findApiDetail(capture);
	if (!match) return undefined;
	const { data, observation } = match;
	const reqBody = data.reqBody as JsonObject;
	const resBody = data.resBody as JsonObject;
	const preInterfaces = Array.isArray(data.preInterfaces)
		? data.preInterfaces
				.filter(isRecord)
				.map((item) => ({
					name: stringValue(item.interfaceName),
					path: stringValue(item.url),
				}))
				.filter((item) => item.name || item.path)
				.filter(
					(item, index, items) =>
						items.findIndex(
							(candidate) =>
								candidate.name === item.name && candidate.path === item.path,
						) === index,
				)
		: [];
	const businessScope = Array.isArray(data.businessScope)
		? data.businessScope
				.filter(isRecord)
				.map((item) => stringValue(item.name))
				.filter(Boolean)
		: [];

	return {
		schemaVersion: "zhongyang-api-doc-v1",
		query: capture.query,
		status: capture.status,
		capturedAt: capture.capturedAt,
		source: {
			title: capture.title,
			pageUrl: capture.pageUrl,
			networkUrl: observation.url,
		},
		api: {
			id: stringValue(data.id),
			name: stringValue(data.interfaceName),
			method: stringValue(data.interfaceType),
			path: stringValue(data.url || data.reqUrl),
			contentType: stringValue(data.interfaceDescription),
			product: stringValue(data.productName),
			category: stringValue(data.categoryName),
			description: stringValue(data.description),
			businessFunction: stringValue(data.businessFunctionName),
			businessScope,
			createdAt: stringValue(data.hisCreateTime),
			updatedAt: stringValue(data.hisUpdateTime),
			preInterfaces,
		},
		request: {
			fields: flattenFields(reqBody),
			example: parseExample(data.interfaceInputExample),
			schema: reqBody,
		},
		response: {
			fields: flattenFields(resBody),
			example: parseExample(data.interfaceOutputExample),
			schema: resBody,
		},
	};
}

function markdownCell(value: unknown): string {
	return stringValue(value)
		.replaceAll("|", "\\|")
		.replaceAll("\r", "")
		.replaceAll("\n", "<br>");
}

function requiredLabel(value: boolean | null): string {
	return value === true ? "是" : value === false ? "否" : "未标注";
}

function fieldTable(fields: readonly NormalizedField[]): string {
	const rows = fields.map(
		(field) =>
			`| \`${markdownCell(field.path)}\` | ${markdownCell(field.type)} | ${requiredLabel(field.required)} | ${markdownCell(field.length)} | ${markdownCell(field.source)} | ${markdownCell(field.description)} | ${markdownCell(field.sourceDescription)} |`,
	);
	return [
		"| 路径 | 类型 | 必填 | 长度 | 参数来源 | 描述 | 来源说明 |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...(rows.length > 0 ? rows : ["| - | - | - | - | - | 未提取到字段 | - |"]),
	].join("\n");
}

function codeBlock(value: unknown): string {
	const text =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return `\`\`\`json\n${text?.split("```").join("` ` `") ?? "null"}\n\`\`\``;
}

export function renderNormalizedMarkdown(
	document: NormalizedApiDocument,
): string {
	const { api } = document;
	const preInterfaces = api.preInterfaces.length
		? api.preInterfaces
				.map((item) => `- ${item.name}：\`${item.path}\``)
				.join("\n")
		: "- 无前置接口信息";
	return `# ${api.name}

> 结构化来源：众阳官方门户右侧接口详情；状态：\`${document.status}\`
> 整理时间：${document.capturedAt}

## 1. 接口概览

| 项目 | 内容 |
| --- | --- |
| 接口编号 | \`${document.query}\` |
| 接口名称 | ${markdownCell(api.name)} |
| 请求方法 | \`${markdownCell(api.method)}\` |
| Content-Type | \`${markdownCell(api.contentType)}\` |
| 请求路径 | \`${markdownCell(api.path)}\` |
| 产品/分类 | ${markdownCell(api.product)} / ${markdownCell(api.category)} |
| 业务功能 | ${markdownCell(api.businessFunction)} |
| 业务范围 | ${markdownCell(api.businessScope.join("、"))} |
| 创建时间 | ${markdownCell(api.createdAt)} |
| 最后更新时间 | ${markdownCell(api.updatedAt)} |

### 接口描述

${api.description || "未提供"}

### 前置接口

${preInterfaces}

## 2. 请求参数

${fieldTable(document.request.fields)}

### 请求示例

${codeBlock(document.request.example)}

## 3. 返回参数

${fieldTable(document.response.fields)}

### 返回示例

${codeBlock(document.response.example)}

## 4. 来源与边界

- 页面标题：${markdownCell(document.source.title)}
- 页面地址：${markdownCell(document.source.pageUrl)}
- 详情响应地址：${markdownCell(document.source.networkUrl)}
- 本文件是授权账号在官方门户可见内容的结构化整理，不等同于已完成业务联调或生产授权确认。
- 字段的必填、状态码、幂等、超时和错误处理仍需结合前置接口及真实只读验收复核。
`;
}
