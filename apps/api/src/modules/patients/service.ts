import type { PatientListPayload } from "@hospital/contracts";
import type { PatientRepository } from "@hospital/domain";

export class PatientService {
	constructor(private readonly repository: PatientRepository) {}

	/** 只按服务端解析出的 ownerUserId 查询，避免客户端传 userId 越权。 */
	async list(ownerUserId: string): Promise<PatientListPayload["data"]> {
		const items = await this.repository.listByOwner(ownerUserId);
		return {
			items: items.map(
				({ id, displayName, relationship, cardNumberMasked, source }) => ({
					id,
					displayName,
					relationship,
					cardNumberMasked,
					source,
				}),
			),
			total: items.length,
		};
	}
}
