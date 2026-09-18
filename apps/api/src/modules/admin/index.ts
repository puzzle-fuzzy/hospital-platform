import { success } from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import {
	AdminInsuranceQueryInputError,
	type AdminInsuranceQueryService,
} from "./insurance-query-service";

export { adminLogsModule } from "./logs";
export { adminWechatRefundModule } from "./refunds";
export { AdminWechatRefundService } from "./wechat-refund-service";

const AdminInsuranceQueryHeaders = t.Object({
	"x-admin-query-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AdminInsuranceQueryBody = t.Object(
	{
		mode: t.Union([
			t.Literal("identity-card"),
			t.Literal("electronic-credential"),
			t.Literal("social-security-card"),
		]),
		identityNumber: t.String({ minLength: 15, maxLength: 18 }),
		name: t.String({ minLength: 1, maxLength: 50 }),
		credentialNumber: t.Optional(t.String({ maxLength: 512 })),
		cardSerialNumber: t.Optional(t.String({ maxLength: 64 })),
	},
	{ additionalProperties: false },
);

function constantTimeEqual(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
}

/** 新服务独立 Admin 只读入口；不挂患者 Bearer，会话与支付路由互不共享。 */
export function adminInsuranceQueryModule(
	service: Pick<AdminInsuranceQueryService, "query">,
	adminQueryToken: string,
) {
	const expectedToken = adminQueryToken.trim();
	return new Elysia({ name: "admin-insurance-query-module" }).post(
		"/admin/insurance/1101",
		async ({ headers, body }) => {
			if (
				!constantTimeEqual(headers["x-admin-query-token"] ?? "", expectedToken)
			) {
				throw new HttpError(401, "unauthorized", "管理端查询令牌无效");
			}
			try {
				return success(
					await service.query(body, adapterContextFromHeaders(headers)),
				);
			} catch (error) {
				if (error instanceof AdminInsuranceQueryInputError) {
					throw new HttpError(400, "validation", "管理端医保查询参数不合法");
				}
				throw error;
			}
		},
		{
			headers: AdminInsuranceQueryHeaders,
			body: AdminInsuranceQueryBody,
			// Admin 路由不进入患者公共 API 文档；具体契约记录在管理端 README。
			detail: { hide: true },
		},
	);
}

export {
	type AdminInsuranceQueryGateway,
	type AdminInsuranceQueryInput,
	AdminInsuranceQueryService,
} from "./insurance-query-service";
