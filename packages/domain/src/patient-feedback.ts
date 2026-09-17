import { parseIsoCalendarDate, parseStrictIsoInstant } from "./date-range";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

/** 患者端旧服务的两类反馈；新服务只承接新提交，不回灌旧历史。 */
export type PatientFeedbackKind = "gift-banner" | "health-praise";
export type PatientFeedbackStatus =
	| "pending_review"
	| "approved"
	| "rejected"
	| "withdrawn";

export type PatientFeedback = {
	feedbackId: string;
	ownerUserId: string;
	patientId: string;
	appointmentId: string;
	kind: PatientFeedbackKind;
	content: string;
	displayPublic: boolean;
	status: PatientFeedbackStatus;
	donateDate: string;
	departmentName: string;
	doctorName: string;
	idempotencyKey: string;
	createdAt: string;
	updatedAt: string;
};

export type PatientFeedbackCreateInput = Omit<
	PatientFeedback,
	| "feedbackId"
	| "status"
	| "createdAt"
	| "updatedAt"
	| "departmentName"
	| "doctorName"
> & {
	feedbackId?: string;
	status?: PatientFeedbackStatus;
	createdAt?: string;
	updatedAt?: string;
	departmentName: string;
	doctorName: string;
};

export class PatientFeedbackInputError extends Error {
	readonly code = "patient-feedback-input-invalid" as const;
	constructor(message = "Patient feedback input is invalid") {
		super(message);
		this.name = "PatientFeedbackInputError";
	}
}

export class PatientFeedbackIdempotencyConflictError extends Error {
	readonly code = "patient-feedback-idempotency-conflict" as const;
	constructor() {
		super(
			"Patient feedback idempotency key conflicts with an existing request",
		);
		this.name = "PatientFeedbackIdempotencyConflictError";
	}
}

export interface PatientFeedbackRepository {
	findByOwnerAndIdempotencyKey(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<PatientFeedback | undefined>;
	create(input: PatientFeedbackCreateInput): Promise<PatientFeedback>;
	listByOwnerAndPatient(input: {
		ownerUserId: string;
		patientId: string;
		kind?: PatientFeedbackKind;
		donateDate?: string;
		displayPublic?: boolean;
	}): Promise<readonly PatientFeedback[]>;
}

const MAX_CONTENT_CODE_POINTS: Record<PatientFeedbackKind, number> = {
	"gift-banner": 10,
	"health-praise": 1000,
};

function text(value: unknown, max: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= max &&
		value === value.trim() &&
		!Array.from(value).some((char) => {
			const code = char.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

export function validatePatientFeedbackCreateInput(
	input: PatientFeedbackCreateInput,
): void {
	if (!isBoundedOpaqueIdentifier(input.ownerUserId))
		throw new PatientFeedbackInputError("ownerUserId is invalid");
	if (!isBoundedOpaqueIdentifier(input.patientId))
		throw new PatientFeedbackInputError("patientId is invalid");
	if (!isBoundedOpaqueIdentifier(input.appointmentId))
		throw new PatientFeedbackInputError("appointmentId is invalid");
	if (!isBoundedOpaqueIdentifier(input.idempotencyKey))
		throw new PatientFeedbackInputError("idempotencyKey is invalid");
	if (input.kind !== "gift-banner" && input.kind !== "health-praise")
		throw new PatientFeedbackInputError("kind is invalid");
	if (!text(input.content, MAX_CONTENT_CODE_POINTS[input.kind]))
		throw new PatientFeedbackInputError("content is invalid");
	if (typeof input.displayPublic !== "boolean")
		throw new PatientFeedbackInputError("displayPublic is invalid");
	if (!parseIsoCalendarDate(input.donateDate))
		throw new PatientFeedbackInputError("donateDate is invalid");
	if (!text(input.departmentName, 128))
		throw new PatientFeedbackInputError("departmentName is invalid");
	if (!text(input.doctorName, 128))
		throw new PatientFeedbackInputError("doctorName is invalid");
	if (
		input.feedbackId !== undefined &&
		!isBoundedOpaqueIdentifier(input.feedbackId)
	)
		throw new PatientFeedbackInputError("feedbackId is invalid");
	for (const value of [input.createdAt, input.updatedAt]) {
		if (value !== undefined && parseStrictIsoInstant(value) === undefined)
			throw new PatientFeedbackInputError("timestamp is invalid");
	}
}

/** 旧服务支持 YYYY-MM-DD 精确筛选和 YYYY-MM 整月筛选；只允许这两种形状。 */
export function validatePatientFeedbackDateFilter(value: string): void {
	if (/^\d{4}-\d{2}$/.test(value)) {
		const month = Number(value.slice(5));
		if (month >= 1 && month <= 12) return;
	}
	if (parseIsoCalendarDate(value) !== undefined) return;
	throw new PatientFeedbackInputError("donateDate filter is invalid");
}

export function matchesPatientFeedbackDate(
	donateDate: string,
	filter: string | undefined,
): boolean {
	if (filter === undefined) return true;
	return filter.length === 7
		? donateDate.startsWith(`${filter}-`)
		: donateDate === filter;
}

export function patientFeedbackPage(
	pageNo: number | undefined,
	pageSize: number | undefined,
): { pageNo: number; pageSize: number } {
	const normalizedPageNo = pageNo ?? 1;
	const normalizedPageSize = pageSize ?? 50;
	if (
		!Number.isSafeInteger(normalizedPageNo) ||
		normalizedPageNo < 1 ||
		!Number.isSafeInteger(normalizedPageSize) ||
		normalizedPageSize < 1 ||
		normalizedPageSize > 100
	) {
		throw new PatientFeedbackInputError("pagination is invalid");
	}
	return { pageNo: normalizedPageNo, pageSize: normalizedPageSize };
}

export function samePatientFeedbackRequest(
	left: PatientFeedback,
	right: Pick<
		PatientFeedback,
		| "ownerUserId"
		| "patientId"
		| "appointmentId"
		| "kind"
		| "content"
		| "displayPublic"
		| "donateDate"
	>,
): boolean {
	return (
		left.ownerUserId === right.ownerUserId &&
		left.patientId === right.patientId &&
		left.appointmentId === right.appointmentId &&
		left.kind === right.kind &&
		left.content === right.content &&
		left.displayPublic === right.displayPublic &&
		left.donateDate === right.donateDate
	);
}

export { MAX_CONTENT_CODE_POINTS };
