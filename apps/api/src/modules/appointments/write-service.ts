import type {
	AppointmentHoldPayload,
	AppointmentRegistrationPayload,
} from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	type AppointmentPatientProfileGateway,
	type AppointmentWriteGateway,
	type AppointmentWriteRepository,
	type MedicalInsuranceOrderRepository,
	type PatientRepository,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { AppointmentScheduleReferenceExpiredError } from "./service";

export class AppointmentWriteInputError extends Error {
	constructor(message = "Appointment write input is invalid") {
		super(message);
		this.name = "AppointmentWriteInputError";
	}
}

export class AppointmentWritePatientNotFoundError extends Error {
	constructor() {
		super("Appointment write patient is not available");
		this.name = "AppointmentWritePatientNotFoundError";
	}
}

export class AppointmentHoldNotFoundError extends Error {
	constructor() {
		super("Appointment hold was not found");
		this.name = "AppointmentHoldNotFoundError";
	}
}

export class AppointmentHoldExpiredError extends Error {
	constructor() {
		super("Appointment hold has expired");
		this.name = "AppointmentHoldExpiredError";
	}
}

export class AppointmentRegistrationNotFoundError extends Error {
	constructor() {
		super("Appointment registration was not found");
		this.name = "AppointmentRegistrationNotFoundError";
	}
}

export class AppointmentCancellationMedicalPaymentActiveError extends Error {
	constructor() {
		super("Appointment has an active medical insurance payment and cannot be cancelled");
		this.name = "AppointmentCancellationMedicalPaymentActiveError";
	}
}

export type AppointmentWriteServiceDependencies = {
	repository: AppointmentWriteRepository;
	patients: PatientRepository;
	identityUsers: UserIdentityRepository;
	patientProfile: AppointmentPatientProfileGateway;
	gateway: AppointmentWriteGateway;
	medicalInsuranceOrders?: MedicalInsuranceOrderRepository;
	snapshots: {
		findActive(
			scheduleId: string,
			now: string,
		): Promise<
			| {
					schedule: {
						scheduleId: string;
						departmentId: string;
						departmentName: string;
						doctorId: string;
						doctorName: string;
						workDate: string;
						shiftName: string;
						totalSlots: number;
						availableSlots: number;
						timeGroup: "point" | "range" | "unknown";
					};
					providerScheduleId: string;
			  }
			| undefined
		>;
	};
	logger?: AppLogger;
	now?: () => Date;
	createId?: () => string;
};

type Context = { traceId: string; idempotencyKey: string };

function contextOf(value: unknown): Context {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new AppointmentWriteInputError(
			"Appointment write context is invalid",
		);
	return { traceId: context.traceId, idempotencyKey: context.idempotencyKey };
}

function id(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new AppointmentWriteInputError(`${label} is invalid`);
	return value;
}

function outputRegistration(
	registration: NonNullable<
		Awaited<ReturnType<AppointmentWriteRepository["findRegistration"]>>
	>,
	status: "booked" | "duplicate",
): AppointmentRegistrationPayload["data"] {
	return {
		appointmentId: registration.appointmentId,
		status,
		patientId: registration.patientId,
		departmentName: registration.departmentName,
		doctorName: registration.doctorName,
		workDate: registration.workDate,
		shiftName: registration.shiftName,
		sourceSerialNumber: registration.sourceSerialNumber,
		totalFen: registration.totalFen,
	};
}

export class AppointmentWriteService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: AppointmentWriteServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async patientContext(
		ownerUserId: string,
		patientId: string,
		context: Context,
	) {
		const storedPatient =
			await this.dependencies.patients.listByOwner(ownerUserId);
		const patient = storedPatient.find((item) => item.id === patientId);
		if (!patient) throw new AppointmentWritePatientNotFoundError();
		const reference = await this.dependencies.patients.resolveProviderReference(
			{
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "directory",
			},
		);
		if (!reference) throw new AppointmentWritePatientNotFoundError();
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!identity?.unionId) throw new AppointmentWritePatientNotFoundError();
		const profile = await this.dependencies.patientProfile.resolve(
			{
				unionId: identity.unionId,
				providerPatientId: reference.providerPatientId,
			},
			context,
		);
		return { patient, reference, profile: profile.patient };
	}

	private async activeSnapshot(scheduleId: string) {
		const snapshot = await this.dependencies.snapshots.findActive(
			scheduleId,
			this.now().toISOString(),
		);
		if (!snapshot) throw new AppointmentScheduleReferenceExpiredError();
		return snapshot;
	}

	async hold(input: {
		ownerUserId: string;
		patientId: string;
		scheduleId: string;
		sourceSerialNumber: string;
		context: unknown;
	}): Promise<AppointmentHoldPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = id(input.ownerUserId, "ownerUserId");
		const patientId = id(input.patientId, "patientId");
		const scheduleId = id(input.scheduleId, "scheduleId");
		const sourceSerialNumber = id(
			input.sourceSerialNumber,
			"sourceSerialNumber",
		);
		const existing = await this.dependencies.repository.findHoldByIdempotency(
			ownerUserId,
			context.idempotencyKey,
		);
		if (existing) {
			if (
				existing.patientId !== patientId ||
				existing.scheduleId !== scheduleId ||
				existing.sourceSerialNumber !== sourceSerialNumber
			) {
				throw new AppointmentWriteInputError(
					"Appointment hold idempotency key conflicts with the request",
				);
			}
			if (
				existing.status === "held" &&
				Date.parse(existing.expiresAt) > this.now().getTime()
			) {
				return {
					holdId: existing.holdId,
					status: "held",
					totalFen: existing.totalFen,
					expiresAt: existing.expiresAt,
				};
			}
			throw new AppointmentHoldExpiredError();
		}
		this.logger.info(
			{
				event: "appointment.hold.requested",
				traceId: context.traceId,
				patientId,
				scheduleId,
				sourceSerialNumber,
			},
			"Appointment hold requested",
		);
		const snapshot = await this.activeSnapshot(scheduleId);
		const { profile } = await this.patientContext(
			ownerUserId,
			patientId,
			context,
		);
		const source = await this.dependencies.gateway.resolveSource(
			{ providerScheduleId: snapshot.providerScheduleId, sourceSerialNumber },
			context,
		);
		const fee = await this.dependencies.gateway.getFactRegisterFee(
			{
				providerScheduleId: snapshot.providerScheduleId,
				providerPatientId: profile.providerPatientId,
			},
			context,
		);
		const now = this.now();
		const hold = await this.dependencies.repository.insertHold({
			holdId: this.createId(),
			ownerUserId,
			patientId,
			scheduleId,
			providerScheduleId: snapshot.providerScheduleId,
			providerSourceId: source.providerSourceId,
			sourceSerialNumber: source.sourceSerialNumber,
			totalFen: fee.totalFen,
			status: "held",
			idempotencyKey: context.idempotencyKey,
			expiresAt: new Date(now.getTime() + 60_000).toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		this.logger.info(
			{
				event: "appointment.hold.created",
				traceId: context.traceId,
				holdId: hold.holdId,
				patientId,
				scheduleId,
				totalFen: hold.totalFen,
			},
			"Appointment hold created",
		);
		return {
			holdId: hold.holdId,
			status: "held",
			totalFen: hold.totalFen,
			expiresAt: hold.expiresAt,
		};
	}

	async register(input: {
		ownerUserId: string;
		patientId: string;
		holdId: string;
		context: unknown;
	}): Promise<AppointmentRegistrationPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = id(input.ownerUserId, "ownerUserId");
		const patientId = id(input.patientId, "patientId");
		const holdId = id(input.holdId, "holdId");
		const existingByIdempotency =
			await this.dependencies.repository.findRegistrationByIdempotency(
				ownerUserId,
				context.idempotencyKey,
			);
		if (existingByIdempotency) {
			if (
				existingByIdempotency.patientId !== patientId ||
				existingByIdempotency.holdId !== holdId
			) {
				throw new AppointmentWriteInputError(
					"Appointment registration idempotency key conflicts with the request",
				);
			}
			if (existingByIdempotency.status !== "booked") {
				throw new AppointmentWriteInputError(
					"Appointment registration idempotency key has already been completed",
				);
			}
			return outputRegistration(existingByIdempotency, "booked");
		}
		const hold = await this.dependencies.repository.findHold(
			ownerUserId,
			holdId,
		);
		if (!hold || hold.patientId !== patientId)
			throw new AppointmentHoldNotFoundError();
		if (hold.status !== "held") {
			if (hold.status === "consumed") {
				const snapshot = await this.activeSnapshot(hold.scheduleId);
				const existing =
					await this.dependencies.repository.findActiveRegistration({
						ownerUserId,
						patientId,
						workDate: snapshot.schedule.workDate,
						departmentName: snapshot.schedule.departmentName,
					});
				if (existing) return outputRegistration(existing, "booked");
			}
			throw new AppointmentHoldExpiredError();
		}
		if (Date.parse(hold.expiresAt) <= this.now().getTime()) {
			await this.dependencies.repository.updateHold(
				{ ...hold, status: "expired", updatedAt: this.now().toISOString() },
				"held",
			);
			throw new AppointmentHoldExpiredError();
		}
		this.logger.info(
			{
				event: "appointment.registration.requested",
				traceId: context.traceId,
				holdId,
				patientId,
			},
			"Appointment registration requested",
		);
		const snapshot = await this.activeSnapshot(hold.scheduleId);
		const { profile } = await this.patientContext(
			ownerUserId,
			patientId,
			context,
		);
		const active = await this.dependencies.gateway.listActive(
			{
				providerPatientId: profile.providerPatientId,
				workDate: snapshot.schedule.workDate,
			},
			context,
		);
		const duplicateProviderRecord = active.records.find(
			(record) =>
				record.departmentName === snapshot.schedule.departmentName ||
				!record.departmentName,
		);
		if (duplicateProviderRecord) {
			const duplicate =
				await this.dependencies.repository.findActiveRegistration({
					ownerUserId,
					patientId,
					workDate: snapshot.schedule.workDate,
					departmentName: snapshot.schedule.departmentName,
				});
			const registration =
				duplicate ??
				(await this.dependencies.repository.insertRegistration({
					appointmentId: this.createId(),
					ownerUserId,
					patientId,
					holdId,
					idempotencyKey: context.idempotencyKey,
					providerAppointmentId: duplicateProviderRecord.providerAppointmentId,
					providerPatientId: duplicateProviderRecord.providerPatientId,
					...(duplicateProviderRecord.providerRegisterId
						? { providerRegisterId: duplicateProviderRecord.providerRegisterId }
						: {}),
					...(duplicateProviderRecord.providerHisRegisterId
						? {
								providerHisRegisterId:
									duplicateProviderRecord.providerHisRegisterId,
							}
						: {}),
					departmentId: snapshot.schedule.departmentId,
					doctorId: snapshot.schedule.doctorId,
					departmentName: snapshot.schedule.departmentName,
					doctorName: snapshot.schedule.doctorName,
					workDate: snapshot.schedule.workDate,
					shiftName: snapshot.schedule.shiftName,
					sourceSerialNumber: hold.sourceSerialNumber,
					totalFen: hold.totalFen,
					status: "booked",
					createdAt: this.now().toISOString(),
					updatedAt: this.now().toISOString(),
				}));
			this.logger.warn(
				{
					event: "appointment.registration.duplicate",
					traceId: context.traceId,
					holdId,
					appointmentId: registration.appointmentId,
					patientId,
				},
				"Existing appointment detected; registration was not repeated",
			);
			return outputRegistration(registration, "duplicate");
		}
		const result = await this.dependencies.gateway.create(
			{
				patient: profile,
				target: {
					scheduleId: hold.scheduleId,
					providerScheduleId: hold.providerScheduleId,
					departmentId: snapshot.schedule.departmentId,
					departmentName: snapshot.schedule.departmentName,
					doctorId: snapshot.schedule.doctorId,
					doctorName: snapshot.schedule.doctorName,
					workDate: snapshot.schedule.workDate,
					shiftName: snapshot.schedule.shiftName,
					sourceSerialNumber: hold.sourceSerialNumber,
					providerSourceId: hold.providerSourceId,
				},
				totalFen: hold.totalFen,
				recordId: context.idempotencyKey
					.replace(/[^A-Za-z0-9]/g, "")
					.slice(0, 32),
			},
			context,
		);
		const registration = await this.dependencies.repository.insertRegistration({
			appointmentId: this.createId(),
			ownerUserId,
			patientId,
			holdId,
			idempotencyKey: context.idempotencyKey,
			providerAppointmentId: result.providerAppointmentId,
			providerPatientId: profile.providerPatientId,
			...(result.providerRegisterId
				? { providerRegisterId: result.providerRegisterId }
				: {}),
			...(result.providerHisRegisterId
				? { providerHisRegisterId: result.providerHisRegisterId }
				: {}),
			departmentId: snapshot.schedule.departmentId,
			doctorId: snapshot.schedule.doctorId,
			departmentName: snapshot.schedule.departmentName,
			doctorName: snapshot.schedule.doctorName,
			workDate: snapshot.schedule.workDate,
			shiftName: snapshot.schedule.shiftName,
			sourceSerialNumber: hold.sourceSerialNumber,
			totalFen: hold.totalFen,
			status: "booked",
			createdAt: this.now().toISOString(),
			updatedAt: this.now().toISOString(),
		});
		await this.dependencies.repository.updateHold(
			{ ...hold, status: "consumed", updatedAt: this.now().toISOString() },
			"held",
		);
		this.logger.info(
			{
				event: "appointment.registration.created",
				traceId: context.traceId,
				appointmentId: registration.appointmentId,
				holdId,
				patientId,
			},
			"Appointment registration created",
		);
		return outputRegistration(registration, "booked");
	}

	async cancel(input: {
		ownerUserId: string;
		appointmentId: string;
		context: unknown;
	}): Promise<{ appointmentId: string; status: "cancelled" }> {
		const context = contextOf(input.context);
		const ownerUserId = id(input.ownerUserId, "ownerUserId");
		const appointmentId = id(input.appointmentId, "appointmentId");
		const registration = await this.dependencies.repository.findRegistration(
			ownerUserId,
			appointmentId,
		);
		if (!registration) throw new AppointmentRegistrationNotFoundError();
		if (registration.status === "cancelled")
			return { appointmentId, status: "cancelled" };
		const medicalOrder = await this.dependencies.medicalInsuranceOrders?.findByOwnerAndAppointmentId(
			ownerUserId,
			appointmentId,
		);
		if (
			medicalOrder &&
			(medicalOrder.status !== "created" ||
				Boolean(medicalOrder.feeUploadId || medicalOrder.payOrdId))
		) {
			throw new AppointmentCancellationMedicalPaymentActiveError();
		}
		this.logger.info(
			{
				event: "appointment.cancellation.requested",
				traceId: context.traceId,
				appointmentId,
			},
			"Appointment cancellation requested",
		);
		await this.dependencies.gateway.cancel(
			{
				providerPatientId: registration.providerPatientId,
				providerAppointmentId: registration.providerAppointmentId,
			},
			context,
		);
		const updated = await this.dependencies.repository.updateRegistration(
			{
				...registration,
				status: "cancelled",
				updatedAt: this.now().toISOString(),
			},
			"booked",
		);
		if (!updated) throw new DependencyNotConfiguredError("appointment-writes");
		this.logger.info(
			{
				event: "appointment.cancellation.completed",
				traceId: context.traceId,
				appointmentId,
			},
			"Appointment cancellation completed",
		);
		return { appointmentId, status: "cancelled" };
	}
}
