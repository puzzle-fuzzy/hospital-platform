import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { MedicalInsuranceNotificationService } from "./service";

/**
 * 6302 医保结算结果通知回调（平台 → 本服务，方向为入站）。
 *
 * 未配置 crypto/gateway 时模块不会被构造（组合根不注册路由），
 * 保持 fail-closed；请求体是 MbsCrypto 应用层封套（SM4+SM2），
 * 在 service 内验签解密后才进入订单状态机。
 */
export function medicalInsuranceModule(
	notificationService: MedicalInsuranceNotificationService,
) {
	return new Elysia({ name: "medical-insurance-module" }).post(
		"/payments/medical-insurance/notifications",
		async ({ request, headers }) => {
			const payload = (await request.json()) as Record<string, unknown>;
			return notificationService.receive({
				payload,
				context: adapterContextFromHeaders(headers),
			});
		},
		{
			headers: t.Object({
				"x-request-id": t.Optional(t.String({ maxLength: 128 })),
			}),
			response: {
				200: t.Object({
					success: t.Boolean(),
					message: t.String(),
				}),
			},
			tags: ["medical-insurance"],
		},
	);
}
