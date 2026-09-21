import type { Patient } from "../types";
import { getCurrentUser } from "./api-client";
import { getRegisteredApp } from "./app-runtime-context";
import { loadCurrentPatientForOwner } from "./dashboard-service";
import { registerPatientSelectionChangedListener } from "./patient-selection-service";
import { patientSurfaceErrorMessage } from "./patient-surface-context";
import {
	registerSessionChangedListener,
	type SessionChangedEvent,
} from "./session-events";
import { getSessionGeneration } from "./session-generation";

/** 当前院区是平台级上下文，不随页面路径重复请求。 */
export const DEFAULT_HOSPITAL_NAME = "高平市人民医院";

/**
 * 门诊病历顶部“就诊人 + 当前院区”选择器的唯一共享快照。
 *
 * 快照放在 App.globalData，而不是某个页面的 data 或模块变量：微信会把
 * 页面和组件拆成不同 bundle，模块变量无法跨页面复用。它只保存已脱敏的
 * 展示字段和同一进程内的 Patient 对象，不写入持久化 storage。
 */
export type PatientHospitalContextSnapshot = {
	patient: Patient | null;
	patientName: string;
	patientCardLabel: string;
	hospitalName: string;
	loading: boolean;
	loaded: boolean;
	error: string;
	sessionGeneration: number;
};

export const INITIAL_PATIENT_HOSPITAL_CONTEXT: PatientHospitalContextSnapshot =
	{
		patient: null,
		patientName: "正在加载就诊人...",
		patientCardLabel: "就诊卡信息加载中",
		hospitalName: DEFAULT_HOSPITAL_NAME,
		loading: true,
		loaded: false,
		error: "",
		sessionGeneration: 0,
	};

type PatientHospitalContextListener = (
	snapshot: PatientHospitalContextSnapshot,
) => void;

type PatientHospitalContextStore = {
	snapshot: PatientHospitalContextSnapshot;
	inFlight: Promise<PatientHospitalContextSnapshot> | null;
	inFlightGeneration: number;
	listeners: Set<PatientHospitalContextListener>;
	subscriptionsInstalled: boolean;
};

type SharedAppData = {
	globalData?: Record<string, unknown>;
};

const STORE_KEY = "__hospitalPatientHospitalContext";
const fallbackStore: PatientHospitalContextStore = createStore();

function createStore(): PatientHospitalContextStore {
	return {
		snapshot: {
			...INITIAL_PATIENT_HOSPITAL_CONTEXT,
			sessionGeneration: getSessionGeneration(),
		},
		inFlight: null,
		inFlightGeneration: -1,
		listeners: new Set(),
		subscriptionsInstalled: false,
	};
}

function isStore(value: unknown): value is PatientHospitalContextStore {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PatientHospitalContextStore>;
	return (
		candidate.snapshot !== undefined &&
		candidate.listeners instanceof Set &&
		typeof candidate.subscriptionsInstalled === "boolean"
	);
}

function getStore(): PatientHospitalContextStore {
	try {
		const appData = getRegisteredApp<SharedAppData>()?.globalData;
		if (!appData) return fallbackStore;
		const existing = appData[STORE_KEY];
		if (isStore(existing)) return existing;
		const store = createStore();
		appData[STORE_KEY] = store;
		return store;
	} catch {
		// App 尚未注册或测试替身不完整时仍允许组件完成静态初始化。
		return fallbackStore;
	}
}

function emptySnapshot(
	sessionGeneration = getSessionGeneration(),
): PatientHospitalContextSnapshot {
	return {
		...INITIAL_PATIENT_HOSPITAL_CONTEXT,
		sessionGeneration,
	};
}

function snapshotForPatient(
	patient: Patient | null,
	sessionGeneration: number,
): PatientHospitalContextSnapshot {
	return {
		patient,
		patientName: patient?.displayName || "请先选择就诊人",
		patientCardLabel: patient?.cardNumberMasked || "请先选择就诊人",
		hospitalName: DEFAULT_HOSPITAL_NAME,
		loading: false,
		loaded: true,
		error: "",
		sessionGeneration,
	};
}

function publish(
	store: PatientHospitalContextStore,
	patch: Partial<PatientHospitalContextSnapshot>,
): PatientHospitalContextSnapshot {
	store.snapshot = { ...store.snapshot, ...patch };
	for (const listener of [...store.listeners]) {
		try {
			listener(store.snapshot);
		} catch {
			// 单个页面的 setData 异常不能阻断其它页面同步上下文。
		}
	}
	return store.snapshot;
}

function clearStore(store: PatientHospitalContextStore): void {
	store.inFlight = null;
	store.inFlightGeneration = -1;
	publish(store, emptySnapshot());
}

function installSharedSubscriptions(store: PatientHospitalContextStore): void {
	if (store.subscriptionsInstalled) return;
	store.subscriptionsInstalled = true;

	registerPatientSelectionChangedListener((event) => {
		if (event.sessionGeneration !== getSessionGeneration()) return;
		store.inFlight = null;
		store.inFlightGeneration = -1;
		publish(store, snapshotForPatient(event.patient, event.sessionGeneration));
	});

	registerSessionChangedListener((event: SessionChangedEvent) => {
		// token 失效的中间态会由认证层自动恢复，不能让页面闪现账号空态。
		if (event.reason === "session-invalidated") return;
		clearStore(store);
		if (store.listeners.size > 0) {
			setTimeout(() => {
				if (store.listeners.size > 0) void ensurePatientHospitalContext();
			}, 0);
		}
	});
}

/** 读取当前共享快照；不会触发网络请求。 */
export function getPatientHospitalContextSnapshot(): PatientHospitalContextSnapshot {
	const store = getStore();
	installSharedSubscriptions(store);
	const generation = getSessionGeneration();
	if (store.snapshot.sessionGeneration !== generation && !store.inFlight) {
		clearStore(store);
	}
	return store.snapshot;
}

/** 订阅共享快照；组件卸载时必须调用返回的取消函数。 */
export function subscribePatientHospitalContext(
	listener: PatientHospitalContextListener,
): () => void {
	const store = getStore();
	installSharedSubscriptions(store);
	store.listeners.add(listener);
	try {
		listener(getPatientHospitalContextSnapshot());
	} catch {
		// 订阅方尚未完成 setData 时，不影响其它组件实例。
	}
	return () => store.listeners.delete(listener);
}

/**
 * 确保共享上下文已经读取；同一会话内所有页面和组件共用 single-flight。
 * 已成功读取的快照直接返回，不会因页面切换再次请求 `/me` 或 `/patients`。
 */
export function ensurePatientHospitalContext(
	options: { force?: boolean } = {},
): Promise<PatientHospitalContextSnapshot> {
	const store = getStore();
	installSharedSubscriptions(store);
	const generation = getSessionGeneration();
	if (store.snapshot.sessionGeneration !== generation && !store.inFlight) {
		clearStore(store);
	}
	if (store.inFlight && store.inFlightGeneration === generation) {
		return store.inFlight;
	}
	if (!options.force && store.snapshot.loaded && !store.snapshot.error) {
		return Promise.resolve(store.snapshot);
	}

	const previousPatient = store.snapshot.patient;
	publish(store, {
		...snapshotForPatient(previousPatient, generation),
		loading: true,
		loaded: Boolean(previousPatient),
		error: "",
	});

	const request = getCurrentUser()
		.then((currentUser) => loadCurrentPatientForOwner(currentUser.data.user.id))
		.then(({ patient, sessionGeneration }) => {
			if (sessionGeneration !== getSessionGeneration()) {
				return getPatientHospitalContextSnapshot();
			}
			return publish(store, snapshotForPatient(patient, sessionGeneration));
		})
		.catch((error: unknown) => {
			const currentGeneration = getSessionGeneration();
			if (currentGeneration !== generation) {
				return getPatientHospitalContextSnapshot();
			}
			return publish(store, {
				...snapshotForPatient(previousPatient, currentGeneration),
				error: patientSurfaceErrorMessage(error),
			});
		})
		.finally(() => {
			if (store.inFlight === request) {
				store.inFlight = null;
				store.inFlightGeneration = -1;
			}
		});

	store.inFlight = request;
	store.inFlightGeneration = generation;
	return request;
}

/** 用户点击组件错误态的“重新读取”时调用，仍然只保留一个在途请求。 */
export function refreshPatientHospitalContext(): Promise<PatientHospitalContextSnapshot> {
	return ensurePatientHospitalContext({ force: true });
}
