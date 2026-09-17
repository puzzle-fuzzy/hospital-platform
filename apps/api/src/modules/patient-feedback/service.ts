import type {
	PatientFeedbackCreateRequestPayload,
	PatientFeedbackListResponsePayload,
	PatientFeedbackPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentWriteRepository,
	adapterContextTraceId,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	PatientFeedbackInputError,
	type PatientFeedbackRepository,
	type PatientRepository,
	patientFeedbackPage,
	samePatientFeedbackRequest,
	validatePatientFeedbackCreateInput,
	validatePatientFeedbackDateFilter,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export class PatientFeedbackAppointmentNotFoundError extends Error {
	constructor() {
		super("Patient feedback appointment is not available");
		this.name = "PatientFeedbackAppointmentNotFoundError";
	}
}

function requireContext(value: unknown): AdapterCallContext {
	if (
		typeof value !== "object" ||
		value === null ||
		!isBoundedOpaqueIdentifier((value as Record<string, unknown>).traceId) ||
		!isBoundedOpaqueIdentifier(
			(value as Record<string, unknown>).idempotencyKey,
		)
	)
		throw new PatientFeedbackInputError("feedback context is invalid");
	return value as AdapterCallContext;
}

function toPayload(
	record: Awaited<ReturnType<PatientFeedbackRepository["create"]>>,
): PatientFeedbackPayload {
	return {
		feedbackId: record.feedbackId,
		patientId: record.patientId,
		appointmentId: record.appointmentId,
		kind: record.kind,
		content: record.content,
		displayPublic: record.displayPublic,
		status: record.status,
		donateDate: record.donateDate,
		departmentName: record.departmentName,
		doctorName: record.doctorName,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export type PatientFeedbackServiceDependencies = {
	repository: PatientFeedbackRepository;
	patients: PatientRepository;
	appointments: AppointmentWriteRepository;
	logger?: AppLogger;
	now?: () => Date;
	createId?: () => string;
};

export class PatientFeedbackService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: PatientFeedbackServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	async create(
		ownerUserId: string,
		input: PatientFeedbackCreateRequestPayload,
		context: AdapterCallContext,
	): Promise<PatientFeedbackPayload> {
		const traceContext = requireContext(context);
		if (!isBoundedOpaqueIdentifier(ownerUserId))
			throw new PatientFeedbackInputError("owner is invalid");
		if (
			!this.dependencies.repository ||
			!this.dependencies.patients ||
			!this.dependencies.appointments
		)
			throw new DependencyNotConfiguredError("patient-feedback");

		const existing =
			await this.dependencies.repository.findByOwnerAndIdempotencyKey(
				ownerUserId,
				traceContext.idempotencyKey,
			);
		if (existing) {
			if (!samePatientFeedbackRequest(existing, { ...input, ownerUserId }))
				throw new PatientFeedbackInputError(
					"feedback idempotency key conflicts",
				);
			return toPayload(existing);
		}

		const patient = (
			await this.dependencies.patients.listByOwner(ownerUserId)
		).find(
			(item) => item.id === input.patientId && item.clinicalAccess === "ready",
		);
		if (!patient) throw new PatientFeedbackAppointmentNotFoundError();
		const appointment = await this.dependencies.appointments.findRegistration(
			ownerUserId,
			input.appointmentId,
		);
		if (
			!appointment ||
			appointment.patientId !== patient.id ||
			appointment.status !== "booked"
		)
			throw new PatientFeedbackAppointmentNotFoundError();

		const payload = {
			ownerUserId,
			patientId: patient.id,
			appointmentId: appointment.appointmentId,
			kind: input.kind,
			content: input.content.trim(),
			displayPublic: input.displayPublic,
			donateDate: input.donateDate,
			departmentName: appointment.departmentName,
			doctorName: appointment.doctorName,
			idempotencyKey: traceContext.idempotencyKey,
			feedbackId: this.createId(),
			createdAt: this.now().toISOString(),
			updatedAt: this.now().toISOString(),
		};
		validatePatientFeedbackCreateInput(payload);
		const created = await this.dependencies.repository.create(payload);
		this.logger.info(
			{
				event: "patient-feedback.submitted",
				traceId: adapterContextTraceId(traceContext),
				kind: created.kind,
				status: created.status,
			},
			"Patient feedback submitted for review",
		);
		return toPayload(created);
	}

	async list(
		ownerUserId: string,
		patientId: string,
		kind: PatientFeedbackCreateRequestPayload["kind"] | undefined,
		donateDate: string | undefined,
		displayPublic: boolean | undefined,
		pageNo: number | undefined,
		pageSize: number | undefined,
		context: AdapterCallContext,
	): Promise<PatientFeedbackListResponsePayload["data"]> {
		const traceContext = requireContext(context);
		if (
			!isBoundedOpaqueIdentifier(ownerUserId) ||
			!isBoundedOpaqueIdentifier(patientId)
		)
			throw new PatientFeedbackInputError("feedback scope is invalid");
		if (donateDate !== undefined) validatePatientFeedbackDateFilter(donateDate);
		const page = patientFeedbackPage(pageNo, pageSize);
		const patient = (
			await this.dependencies.patients.listByOwner(ownerUserId)
		).find((item) => item.id === patientId && item.clinicalAccess === "ready");
		if (!patient) throw new PatientFeedbackAppointmentNotFoundError();
		const allItems = (
			await this.dependencies.repository.listByOwnerAndPatient({
				ownerUserId,
				patientId,
				...(kind ? { kind } : {}),
				...(donateDate ? { donateDate } : {}),
				...(displayPublic === undefined ? {} : { displayPublic }),
			})
		).map(toPayload);
		const offset = (page.pageNo - 1) * page.pageSize;
		const items = allItems.slice(offset, offset + page.pageSize);
		this.logger.info(
			{
				event: "patient-feedback.loaded",
				traceId: adapterContextTraceId(traceContext),
				itemCount: items.length,
				total: allItems.length,
				pageNo: page.pageNo,
			},
			"Patient feedback loaded",
		);
		return {
			items,
			total: allItems.length,
			pageNo: page.pageNo,
			pageSize: page.pageSize,
			hasMore: offset + items.length < allItems.length,
		};
	}
}
