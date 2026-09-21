import {
	ensurePatientHospitalContext,
	refreshPatientHospitalContext,
	subscribePatientHospitalContext,
} from "../../services/patient-hospital-context";

type PatientHospitalContextComponent = {
	data: {
		patient: unknown;
		patientName: string;
		patientCardLabel: string;
		hospitalName: string;
		loading: boolean;
		error: string;
		hospitalSelectable: boolean;
	};
	setData(data: Record<string, unknown>): void;
	triggerEvent(name: string): void;
};

const subscriptions = new WeakMap<object, () => void>();

Component({
	properties: {
		hospitalSelectable: {
			type: Boolean,
			value: false,
		},
	},
	data: {
		patient: null,
		patientName: "正在加载就诊人...",
		patientCardLabel: "就诊卡信息加载中",
		hospitalName: "高平市人民医院",
		loading: true,
		error: "",
	},
	lifetimes: {
		attached(this: PatientHospitalContextComponent) {
			const unsubscribe = subscribePatientHospitalContext((snapshot) => {
				this.setData({
					patient: snapshot.patient,
					patientName: snapshot.patientName,
					patientCardLabel: snapshot.patientCardLabel,
					hospitalName: snapshot.hospitalName,
					loading: snapshot.loading,
					error: snapshot.error,
				});
			});
			subscriptions.set(this, unsubscribe);
			void ensurePatientHospitalContext();
		},
		detached(this: PatientHospitalContextComponent) {
			const unsubscribe = subscriptions.get(this);
			unsubscribe?.();
			subscriptions.delete(this);
		},
	},
	methods: {
		onPatientTap(this: PatientHospitalContextComponent) {
			this.triggerEvent("changepatient");
		},
		onHospitalTap(this: PatientHospitalContextComponent) {
			if (!this.data.hospitalSelectable) return;
			this.triggerEvent("hospitaltap");
		},
		onRetry() {
			void refreshPatientHospitalContext();
		},
	},
});
