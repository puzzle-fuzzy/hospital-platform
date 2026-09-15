import { expect, test } from "bun:test";
import { AdminInsuranceQueryService } from "./insurance-query-service";

const context = {
	traceId: "admin-query-trace-001",
	idempotencyKey: "admin-query-idem-001",
};

test("新服务 Admin 查询固定组装 1101 通用 FSI 请求", async () => {
	let request: Record<string, unknown> | undefined;
	const service = new AdminInsuranceQueryService({
		gateway: {
			async query1101(data) {
				request = data;
				return {
					data: { infcode: "0", baseinfo: {}, insuinfo: [] },
					trace: {
						provider: "legacy-fsi",
						operation: "legacy-fsi.1101",
						requestId: "provider-1101-001",
					},
				};
			},
		},
		institutionCode: "H14058101270",
		institutionName: "高平市人民医院",
		now: () => new Date("2026-09-15T02:03:04.000Z"),
		createId: () => "query-id-001",
	});

	await service.query(
		{
			mode: "identity-card",
			identityNumber: "11010519900101007x",
			name: "测试人A",
		},
		context,
	);

	expect(request).toMatchObject({
		infno: "1101",
		insuplc_admdvs: "140581",
		mdtrtarea_admvs: "140581",
		fixmedins_code: "H14058101270",
		fixmedins_name: "高平市人民医院",
		recer_sys_code: "msun",
		input: {
			data: {
				mdtrt_cert_type: "02",
				mdtrt_cert_no: "11010519900101007X",
				card_sn: "",
				psn_cert_type: "01",
				certno: "11010519900101007X",
				psn_name: "测试人A",
			},
		},
	});
	const msgid = request?.msgid;
	expect(msgid).toBeString();
	expect((msgid as string).startsWith("H1405810127020260915100304")).toBe(true);
});
