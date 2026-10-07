export type MedicalInsuranceAuthBusiness = {
	businessType: "registration" | "outpatient";
	businessId: string;
	patientId: string;
};

type MedicalInsuranceAuthIntent = MedicalInsuranceAuthBusiness & {
	startedAt: number;
};

type MedicalInsuranceAuthResult = MedicalInsuranceAuthBusiness & {
	authCode: string;
	receivedAt: number;
};

export type MedicalInsuranceAuthHandoffState = {
	medicalInsuranceAuthIntent: MedicalInsuranceAuthIntent | null;
	medicalInsuranceAuthResult: MedicalInsuranceAuthResult | null;
};

type MedicalInsuranceAuthApp = {
	globalData: MedicalInsuranceAuthHandoffState;
};

const AUTH_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

function currentState(): MedicalInsuranceAuthHandoffState | undefined {
	try {
		return getApp<MedicalInsuranceAuthApp>()?.globalData;
	} catch {
		return undefined;
	}
}

function matchesBusiness(
	left: MedicalInsuranceAuthBusiness,
	right: MedicalInsuranceAuthBusiness,
): boolean {
	return (
		left.businessType === right.businessType &&
		left.businessId === right.businessId &&
		left.patientId === right.patientId
	);
}

function isFresh(startedAt: number, now: number): boolean {
	const age = now - startedAt;
	return (
		Number.isSafeInteger(startedAt) &&
		age >= 0 &&
		age <= AUTH_HANDOFF_MAX_AGE_MS
	);
}

/**
 * 仅记录当前一次跨小程序授权的业务归属，不保存按钮状态、订单阶段或支付结果。
 * 新授权会覆盖旧意图，确保上一笔业务永远不能阻止下一次点击。
 */
export function beginMedicalInsuranceAuthHandoff(
	business: MedicalInsuranceAuthBusiness,
	startedAt = Date.now(),
): void {
	const state = currentState();
	if (!state) return;
	state.medicalInsuranceAuthIntent = { ...business, startedAt };
	state.medicalInsuranceAuthResult = null;
}

/** App.onShow 使用当前内存意图绑定回跳授权码；冷启动无意图时直接丢弃。 */
export function receiveMedicalInsuranceAuthReturn(
	state: MedicalInsuranceAuthHandoffState,
	authCode: string,
	receivedAt = Date.now(),
): void {
	const code = authCode.trim();
	const intent = state.medicalInsuranceAuthIntent;
	state.medicalInsuranceAuthResult = null;
	if (!code || !intent || !isFresh(intent.startedAt, receivedAt)) {
		state.medicalInsuranceAuthIntent = null;
		return;
	}
	state.medicalInsuranceAuthResult = {
		businessType: intent.businessType,
		businessId: intent.businessId,
		patientId: intent.patientId,
		authCode: code,
		receivedAt,
	};
}

export function hasMedicalInsuranceAuthReturn(
	business: MedicalInsuranceAuthBusiness,
	now = Date.now(),
): boolean {
	const state = currentState();
	const result = state?.medicalInsuranceAuthResult;
	if (!state || !result) return false;
	if (!isFresh(result.receivedAt, now) || !matchesBusiness(result, business)) {
		state.medicalInsuranceAuthIntent = null;
		state.medicalInsuranceAuthResult = null;
		return false;
	}
	return true;
}

/** 精确匹配当前业务和患者后消费一次；不匹配的旧结果绝不提交给服务端。 */
export function consumeMedicalInsuranceAuthReturn(
	business: MedicalInsuranceAuthBusiness,
	now = Date.now(),
): string {
	const state = currentState();
	const result = state?.medicalInsuranceAuthResult;
	if (!state || !result) return "";
	if (!isFresh(result.receivedAt, now)) {
		state.medicalInsuranceAuthIntent = null;
		state.medicalInsuranceAuthResult = null;
		return "";
	}
	if (!matchesBusiness(result, business)) {
		state.medicalInsuranceAuthIntent = null;
		state.medicalInsuranceAuthResult = null;
		return "";
	}
	state.medicalInsuranceAuthIntent = null;
	state.medicalInsuranceAuthResult = null;
	return result.authCode;
}

export function clearMedicalInsuranceAuthHandoff(
	business?: MedicalInsuranceAuthBusiness,
): void {
	const state = currentState();
	if (!state) return;
	if (business) {
		const intentMatches = Boolean(
			state.medicalInsuranceAuthIntent &&
				matchesBusiness(state.medicalInsuranceAuthIntent, business),
		);
		const resultMatches = Boolean(
			state.medicalInsuranceAuthResult &&
				matchesBusiness(state.medicalInsuranceAuthResult, business),
		);
		if (!intentMatches && !resultMatches) return;
	}
	state.medicalInsuranceAuthIntent = null;
	state.medicalInsuranceAuthResult = null;
}
