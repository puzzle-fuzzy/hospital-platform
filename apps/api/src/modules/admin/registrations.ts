import { success } from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import {
	AdminRegistrationInputError,
	AdminRegistrationNotFoundError,
	type AdminRegistrationService,
	AdminRegistrationUnavailableError,
} from "./registration-service";

const Params = t.Object({
	source: t.Union([t.Literal("payment_order"), t.Literal("medical_insurance")]),
	orderId: t.String({
		minLength: 1,
		maxLength: 64,
		pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$",
	}),
});
const Headers = {
	"x-admin-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-admin-operator-ref": t.String({ pattern: "^admin-session:[a-f0-9]{40}$" }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
};
const CancelHeaders = t.Object({
	...Headers,
	"idempotency-key": t.String({
		minLength: 1,
		maxLength: 128,
		pattern: "^[A-Za-z0-9._:-]{1,128}$",
	}),
});
const CancelBody = t.Object(
	{ reason: t.String({ minLength: 2, maxLength: 80 }) },
	{ additionalProperties: false },
);

function authorize(expected: string, actual: string): void {
	if (!expected.trim())
		throw new HttpError(503, "admin-not-configured", "管理端挂号操作尚未配置");
	const left = new TextEncoder().encode(expected.trim());
	const right = new TextEncoder().encode(actual);
	let difference = left.length ^ right.length;
	for (let index = 0; index < left.length; index++)
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	if (difference !== 0)
		throw new HttpError(401, "unauthorized", "管理端操作令牌无效");
}

function mapError(error: unknown): never {
	if (error instanceof AdminRegistrationNotFoundError)
		throw new HttpError(404, "not_found", "未找到可关联的挂号记录");
	if (error instanceof AdminRegistrationInputError)
		throw new HttpError(400, "validation", error.message);
	if (error instanceof AdminRegistrationUnavailableError)
		throw new HttpError(409, "registration-unavailable", error.message);
	throw error;
}

/** Owner、患者和 HIS 引用均由原支付订单解析；本入口不接受这些字段。 */
export function adminRegistrationsModule(
	service: Pick<AdminRegistrationService, "query" | "cancel">,
	token: string,
) {
	return new Elysia({ name: "admin-registrations-module", normalize: false })
		.get(
			"/admin/registrations/:source/:orderId",
			async ({ headers, params }) => {
				authorize(token, headers["x-admin-refund-token"]);
				try {
					return success(
						await service.query({
							...params,
							context: adapterContextFromHeaders(headers),
							operatorRef: headers["x-admin-operator-ref"],
						}),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{ params: Params, headers: t.Object(Headers), detail: { hide: true } },
		)
		.post(
			"/admin/registrations/:source/:orderId/cancel",
			async ({ headers, params, body }) => {
				authorize(token, headers["x-admin-refund-token"]);
				try {
					return success(
						await service.cancel({
							...params,
							reason: body.reason,
							context: adapterContextFromHeaders(headers),
							operatorRef: headers["x-admin-operator-ref"],
						}),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{
				params: Params,
				headers: CancelHeaders,
				body: CancelBody,
				detail: { hide: true },
			},
		);
}
