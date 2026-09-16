import type { AdapterCallContext } from "./ports";

/** 知识检索只返回审核文档的分块，不返回患者报告或索引内部字段。 */
export type KnowledgeSearchMatch = {
	documentId: string;
	title: string;
	source: string;
	chunk: number;
	content: string;
	score: number;
};

/**
 * 受控知识检索端口。
 *
 * 具体索引可以是 Python SQLite、TS/MySQL 或未来的向量检索实现；调用方
 * 只依赖经过校验的文档分块，不依赖文件系统、embedding 或索引格式。
 */
export interface KnowledgeSearchGateway {
	search(
		query: string,
		context: AdapterCallContext,
	): Promise<{ matches: readonly KnowledgeSearchMatch[] }>;
}
