import { parseStrictIsoInstant } from "./date-range";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

export type MyDoctor = {
	ownerUserId: string;
	doctorId: string;
	doctorName: string;
	titleName?: string;
	expertise?: string;
	departmentLocation?: string;
	departmentName: string;
	introduction?: string;
	doctorAvatarUrl?: string;
	createdAt: string;
};

export type MyDoctorCreateInput = Omit<MyDoctor, "createdAt"> & {
	createdAt?: string;
};

export class MyDoctorInputError extends Error {
	readonly code = "my-doctor-query-invalid" as const;

	constructor(message = "My doctor input is invalid") {
		super(message);
		this.name = "MyDoctorInputError";
	}
}

export class MyDoctorAlreadyExistsError extends Error {
	readonly code = "my-doctor-already-followed" as const;

	constructor() {
		super("My doctor is already followed");
		this.name = "MyDoctorAlreadyExistsError";
	}
}

export class MyDoctorNotFoundError extends Error {
	readonly code = "my-doctor-not-found" as const;

	constructor() {
		super("My doctor was not found");
		this.name = "MyDoctorNotFoundError";
	}
}

export type MyDoctorReadModelViolation =
	| "not-object"
	| "owner-invalid"
	| "doctor-id-invalid"
	| "doctor-name-invalid"
	| "title-invalid"
	| "expertise-invalid"
	| "department-location-invalid"
	| "department-name-invalid"
	| "introduction-invalid"
	| "avatar-invalid"
	| "created-at-invalid";

export class MyDoctorReadModelValidationError extends Error {
	readonly violation: MyDoctorReadModelViolation;

	constructor(violation: MyDoctorReadModelViolation) {
		super("My doctor read model is invalid");
		this.name = "MyDoctorReadModelValidationError";
		this.violation = violation;
	}
}

const MAX_DISPLAY_TEXT = 128;
const MAX_DEPARTMENT_LOCATION = 256;
const MAX_EXPERTISE = 255;
const MAX_INTRODUCTION = 512;
const MAX_AVATAR_URL = 512;

function validText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Array.from(value).length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function optionalText(
	value: unknown,
	maxLength: number,
	violation: MyDoctorReadModelViolation,
): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (!validText(value, maxLength)) {
		throw new MyDoctorReadModelValidationError(violation);
	}
	return value;
}

export function normalizeMyDoctorReadModel(value: unknown): MyDoctor {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MyDoctorReadModelValidationError("not-object");
	}
	const record = value as Record<string, unknown>;
	if (!isBoundedOpaqueIdentifier(record.ownerUserId)) {
		throw new MyDoctorReadModelValidationError("owner-invalid");
	}
	if (!isBoundedOpaqueIdentifier(record.doctorId)) {
		throw new MyDoctorReadModelValidationError("doctor-id-invalid");
	}
	if (!validText(record.doctorName, MAX_DISPLAY_TEXT)) {
		throw new MyDoctorReadModelValidationError("doctor-name-invalid");
	}
	if (!validText(record.departmentName, MAX_DISPLAY_TEXT)) {
		throw new MyDoctorReadModelValidationError("department-name-invalid");
	}
	const createdAt = record.createdAt;
	if (
		typeof createdAt !== "string" ||
		parseStrictIsoInstant(createdAt) === undefined
	) {
		throw new MyDoctorReadModelValidationError("created-at-invalid");
	}
	const titleName = optionalText(
		record.titleName,
		MAX_DISPLAY_TEXT,
		"title-invalid",
	);
	const expertise = optionalText(
		record.expertise,
		MAX_EXPERTISE,
		"expertise-invalid",
	);
	const introduction = optionalText(
		record.introduction,
		MAX_INTRODUCTION,
		"introduction-invalid",
	);
	const departmentLocation = optionalText(
		record.departmentLocation,
		MAX_DEPARTMENT_LOCATION,
		"department-location-invalid",
	);
	const doctorAvatarUrl = optionalText(
		record.doctorAvatarUrl,
		MAX_AVATAR_URL,
		"avatar-invalid",
	);
	if (
		doctorAvatarUrl !== undefined &&
		!/^https?:\/\/[^\s]+$/u.test(doctorAvatarUrl)
	) {
		throw new MyDoctorReadModelValidationError("avatar-invalid");
	}
	return {
		ownerUserId: record.ownerUserId,
		doctorId: record.doctorId,
		doctorName: record.doctorName,
		...(titleName ? { titleName } : {}),
		...(expertise ? { expertise } : {}),
		...(departmentLocation ? { departmentLocation } : {}),
		departmentName: record.departmentName,
		...(introduction ? { introduction } : {}),
		...(doctorAvatarUrl ? { doctorAvatarUrl } : {}),
		createdAt,
	};
}

export function validateMyDoctorCreateInput(input: MyDoctorCreateInput): void {
	normalizeMyDoctorReadModel({
		...input,
		createdAt: input.createdAt ?? new Date().toISOString(),
	});
}

export interface MyDoctorRepository {
	listByOwner(ownerUserId: string): Promise<readonly MyDoctor[]>;
	findByOwnerAndDoctor(
		ownerUserId: string,
		doctorId: string,
	): Promise<MyDoctor | undefined>;
	create(input: MyDoctorCreateInput): Promise<MyDoctor>;
	deleteByOwnerAndDoctor(
		ownerUserId: string,
		doctorId: string,
	): Promise<boolean>;
}
