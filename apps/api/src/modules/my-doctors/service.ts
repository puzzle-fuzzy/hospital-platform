import type {
	MyDoctorDeletePayload,
	MyDoctorListPayload,
	MyDoctorPayload,
	MyDoctorResponsePayload,
} from "@hospital/contracts";
import {
	adapterContextTraceId,
	isBoundedOpaqueIdentifier,
	MyDoctorAlreadyExistsError,
	MyDoctorInputError,
	MyDoctorNotFoundError,
	normalizeAdapterCallContext,
	normalizeMyDoctorReadModel,
	type AdapterCallContext,
	type MyDoctorRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentService } from "../appointments/service";

export type MyDoctorServiceDependencies = {
	repository: MyDoctorRepository;
	appointments: AppointmentService;
	logger?: AppLogger;
	now?: () => Date;
};

const PROVIDER_TIME_ZONE = "Asia/Shanghai";
const FOLLOW_SCHEDULE_RANGE_DAYS = 7;

function shanghaiDate(date: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: PROVIDER_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function requireContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new MyDoctorInputError("My doctor call context is invalid");
	return context;
}

function requireOwner(ownerUserId: unknown): string {
	if (!isBoundedOpaqueIdentifier(ownerUserId)) {
		throw new MyDoctorInputError("My doctor owner is invalid");
	}
	return ownerUserId;
}

function requireDoctorId(value: unknown): string {
	if (!isBoundedOpaqueIdentifier(value)) {
		throw new MyDoctorInputError("My doctor identifier is invalid");
	}
	return value;
}

function requireFollowInput(value: unknown): string {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MyDoctorInputError("My doctor follow input is invalid");
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((key) => key !== "doctorId")) {
		throw new MyDoctorInputError("My doctor follow input is invalid");
	}
	return requireDoctorId(record.doctorId);
}

function toPayload(
	doctor: ReturnType<typeof normalizeMyDoctorReadModel>,
): MyDoctorResponsePayload["data"] {
	return {
		doctorId: doctor.doctorId,
		doctorName: doctor.doctorName,
		...(doctor.titleName ? { titleName: doctor.titleName } : {}),
		...(doctor.introduction ? { introduction: doctor.introduction } : {}),
		...(doctor.expertise ? { expertise: doctor.expertise } : {}),
		...(doctor.departmentLocation
			? { departmentLocation: doctor.departmentLocation }
			: {}),
		departmentName: doctor.departmentName,
		...(doctor.doctorAvatarUrl
			? { doctorAvatarUrl: doctor.doctorAvatarUrl }
			: {}),
		createdAt: doctor.createdAt,
	};
}

export class MyDoctorService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(private readonly dependencies: MyDoctorServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	async list(
		ownerUserId: string,
		context: AdapterCallContext,
	): Promise<MyDoctorListPayload["data"]> {
		const traceContext = requireContext(context);
		const owner = requireOwner(ownerUserId);
		try {
			const items = (await this.dependencies.repository.listByOwner(owner)).map(
				(doctor) => toPayload(normalizeMyDoctorReadModel(doctor)),
			);
			this.logger.info(
				{
					event: "my-doctors.loaded",
					traceId: adapterContextTraceId(traceContext),
					itemCount: items.length,
				},
				"My doctors loaded",
			);
			return { items, total: items.length };
		} catch (error) {
			this.logger.error(
				{
					event: "my-doctors.load_failed",
					traceId: adapterContextTraceId(traceContext),
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"My doctors load failed",
			);
			throw error;
		}
	}

	async get(
		ownerUserId: string,
		doctorId: string,
		context: AdapterCallContext,
	): Promise<MyDoctorPayload> {
		const traceContext = requireContext(context);
		const owner = requireOwner(ownerUserId);
		const doctor = requireDoctorId(doctorId);
		const stored = await this.dependencies.repository.findByOwnerAndDoctor(
			owner,
			doctor,
		);
		if (!stored) throw new MyDoctorNotFoundError();
		this.logger.info(
			{
				event: "my-doctor.loaded",
				traceId: adapterContextTraceId(traceContext),
			},
			"My doctor loaded",
		);
		return toPayload(normalizeMyDoctorReadModel(stored));
	}

	/**
	 * 关注动作只接收医生 ID；医生姓名、科室、头像由服务端重新读取当前
	 * 排班目录，避免客户端伪造旧端快照或把 provider 字段写入关系表。
	 */
	async follow(
		ownerUserId: string,
		input: unknown,
		context: AdapterCallContext,
	): Promise<MyDoctorPayload> {
		const traceContext = requireContext(context);
		const owner = requireOwner(ownerUserId);
		const doctorId = requireFollowInput(input);
		const existing = await this.dependencies.repository.findByOwnerAndDoctor(
			owner,
			doctorId,
		);
		if (existing) return toPayload(normalizeMyDoctorReadModel(existing));

		const startDate = shanghaiDate(this.now());
		const schedules = await this.dependencies.appointments.listSchedules(
			{
				startDate,
				endDate: addDays(startDate, FOLLOW_SCHEDULE_RANGE_DAYS - 1),
				doctorId,
			},
			traceContext,
		);
		const schedule = schedules.items.find((item) => item.doctorId === doctorId);
		if (!schedule) throw new MyDoctorNotFoundError();
		try {
			const created = await this.dependencies.repository.create({
				ownerUserId: owner,
				doctorId: schedule.doctorId,
				doctorName: schedule.doctorName,
				...(schedule.titleName ? { titleName: schedule.titleName } : {}),
				...(schedule.introduction
					? { introduction: schedule.introduction }
					: {}),
				...(schedule.expertise ? { expertise: schedule.expertise } : {}),
				...(schedule.departmentLocation
					? { departmentLocation: schedule.departmentLocation }
					: {}),
				departmentName: schedule.departmentName,
				...(schedule.doctorPhotoUrl
					? { doctorAvatarUrl: schedule.doctorPhotoUrl }
					: {}),
			});
			this.logger.info(
				{
					event: "my-doctor.followed",
					traceId: adapterContextTraceId(traceContext),
				},
				"My doctor followed",
			);
			return toPayload(normalizeMyDoctorReadModel(created));
		} catch (error) {
			if (!(error instanceof MyDoctorAlreadyExistsError)) throw error;
			const raced = await this.dependencies.repository.findByOwnerAndDoctor(
				owner,
				doctorId,
			);
			if (!raced) throw error;
			return toPayload(normalizeMyDoctorReadModel(raced));
		}
	}

	async unfollow(
		ownerUserId: string,
		doctorId: string,
		context: AdapterCallContext,
	): Promise<MyDoctorDeletePayload["data"]> {
		const traceContext = requireContext(context);
		const owner = requireOwner(ownerUserId);
		const doctor = requireDoctorId(doctorId);
		await this.dependencies.repository.deleteByOwnerAndDoctor(owner, doctor);
		this.logger.info(
			{
				event: "my-doctor.unfollowed",
				traceId: adapterContextTraceId(traceContext),
			},
			"My doctor unfollowed",
		);
		return { doctorId: doctor, followed: false };
	}
}
