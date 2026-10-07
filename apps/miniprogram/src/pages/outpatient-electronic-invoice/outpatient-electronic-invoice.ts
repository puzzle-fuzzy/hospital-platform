import {
	getCurrentUser,
	issueOutpatientElectronicInvoice,
} from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	loadCurrentPatientForOwner,
	loadOutpatientElectronicInvoices,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	isPatientSelectionError,
	patientContextErrorMessage,
	preservedPatientForReload,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
import type {
	OutpatientElectronicInvoice,
	OutpatientElectronicInvoicePageData,
	OutpatientElectronicInvoiceView,
	Patient,
	ViewKeyEvent,
} from "../../types";

const INVOICE_QR_PREVIEW_PATH = `${wx.env.USER_DATA_PATH}/outpatient-electronic-invoice-qr.png`;

function findInvoice(
	items: readonly OutpatientElectronicInvoiceView[],
	viewKey: unknown,
): OutpatientElectronicInvoiceView | undefined {
	if (typeof viewKey !== "string" || !viewKey) return undefined;
	return items.find((item) => item.viewKey === viewKey);
}

function isIssued(invoice: OutpatientElectronicInvoice): boolean {
	return Boolean(invoice.billBatchCode && invoice.billNo);
}

function invoiceImageBase64(
	invoice: OutpatientElectronicInvoiceView,
): string | undefined {
	for (const candidate of [
		invoice.pictureNetUrl,
		invoice.pictureUrl,
		invoice.billQrCode,
	]) {
		if (typeof candidate !== "string") continue;
		const normalized = candidate.trim();
		const dataUrl =
			/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(
				normalized,
			);
		const base64 = dataUrl?.[1] ?? normalized;
		if (
			base64.length >= 4 &&
			base64.length <= 8_000_000 &&
			base64.length % 4 === 0 &&
			/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)
		) {
			return base64;
		}
	}
	return undefined;
}

function hasHospitalInvoiceLink(
	invoice: OutpatientElectronicInvoiceView,
): boolean {
	return [invoice.pictureNetUrl, invoice.pictureUrl].some(
		(value) => typeof value === "string" && /^https?:\/\//iu.test(value.trim()),
	);
}

function toView(
	invoice: OutpatientElectronicInvoice,
	index: number,
	renderGeneration: number,
): OutpatientElectronicInvoiceView {
	return {
		...invoice,
		viewKey: `outpatient-electronic-invoice-${renderGeneration}-${index}`,
		issueState: isIssued(invoice) ? "issued" : "ready",
		...(invoice.amountFen === undefined
			? {}
			: { amountLabel: formatOutpatientAmountLabel(invoice.amountFen) }),
	};
}

type OutpatientElectronicInvoicePageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onIssue(event: ViewKeyEvent): void;
	onView(event: ViewKeyEvent): void;
	issueInvoice(
		invoice: OutpatientElectronicInvoiceView,
		patient: Patient,
		expectedSessionGeneration: number,
	): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
};

Page<
	OutpatientElectronicInvoicePageData,
	OutpatientElectronicInvoicePageMethods
>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
		items: [],
		loading: true,
		issuingViewKey: "",
		error: "",
		canSelectPatient: false,
	},

	onLoad(): void {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(
			this,
			() => {
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					patientSessionGeneration: -1,
					items: [],
					loading: true,
					issuingViewKey: "",
					error: "",
					canSelectPatient: false,
				});
			},
			() => this.loadPage(),
		);
		void this.loadPage();
	},

	onShow(): void {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadPage();
	},

	/** 发票列表与开具命令都只绑定当前 owner、当前患者和当前会话代际。 */
	loadPage(): Promise<void> {
		const guard = getPageLatestRequestGuard(
			this,
			"outpatient-electronic-invoice",
		);
		const token = guard.begin();
		let expectedSessionGeneration = -1;
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			items: [],
			issuingViewKey: "",
			canSelectPatient: false,
		});
		return getCurrentUser()
			.then((currentUser) => {
				if (!guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(currentUser.data.user.id);
			})
			.then((patientContext) => {
				if (!patientContext || !guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Electronic invoice session changed before patient context was confirmed",
				);
				if (!isCurrentSelectedPatient(patient.id)) return undefined;
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
				});
				return loadOutpatientElectronicInvoices(
					patient.id,
					expectedSessionGeneration,
				);
			})
			.then((payload) => {
				if (!payload || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Electronic invoice session changed before records were committed",
				);
				const patientId = this.data.selectedPatient?.id;
				if (!patientId || !isCurrentSelectedPatient(patientId)) return;
				this.setData({
					items: payload.items.map((invoice, index) =>
						toView(invoice, index, token),
					),
					error: "",
					canSelectPatient: false,
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				const canSelectPatient = isPatientSelectionError(error);
				const clearPatient =
					shouldClearPatientContextAfterError(error, hasPlatformSession()) ||
					canSelectPatient;
				this.setData({
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					selectedPatient: clearPatient
						? null
						: preservedPatientForReload(this.data.selectedPatient),
					patientSessionGeneration: -1,
					items: [],
					issuingViewKey: "",
					canSelectPatient,
					error: errorMessageWithCode(
						error,
						patientContextErrorMessage(
							error,
							"门诊电子发票暂时无法获取，请稍后重试",
						),
					),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "请先完成登录验证", icon: "none" });
			return;
		}
		navigateToPatientSelector(this.data.sessionState);
	},

	onRetry(): void {
		void this.loadPage();
	},

	onIssue(event: ViewKeyEvent): void {
		if (this.data.issuingViewKey || this.data.loading) return;
		const patient = this.data.selectedPatient;
		const invoice = findInvoice(
			this.data.items,
			event.currentTarget?.dataset?.viewKey,
		);
		if (
			!patient ||
			!invoice ||
			invoice.issueState === "issued" ||
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(patient.id)
		) {
			return;
		}
		wx.showModal({
			title: "确认开具电子发票",
			content: "确认后将向医院开具个人抬头电子发票，开具后不能重复操作。",
			confirmText: "确认开具",
			success: ({ confirm }) => {
				if (!confirm) return;
				void this.issueInvoice(
					invoice,
					patient,
					this.data.patientSessionGeneration,
				);
			},
		});
	},

	/**
	 * 已开具记录只查看 Provider 已返回的影像/二维码，绝不复用开票命令。
	 * 不能把 Provider 的任意 H5 地址作为通用 WebView 打开；这既会违反
	 * 微信业务域名限制，也会绕过小程序的外部地址边界。
	 */
	onView(event: ViewKeyEvent): void {
		const invoice = findInvoice(
			this.data.items,
			event.currentTarget?.dataset?.viewKey,
		);
		if (invoice?.issueState !== "issued") return;

		const base64 = invoiceImageBase64(invoice);
		if (base64) {
			try {
				wx.getFileSystemManager().writeFileSync(
					INVOICE_QR_PREVIEW_PATH,
					base64,
					"base64",
				);
				wx.previewImage({
					urls: [INVOICE_QR_PREVIEW_PATH],
					current: INVOICE_QR_PREVIEW_PATH,
					fail: () => wx.showToast({ title: "票据影像预览失败", icon: "none" }),
				});
			} catch {
				wx.showToast({ title: "票据影像预览失败", icon: "none" });
			}
			return;
		}

		wx.showModal({
			title: "暂不能在小程序内查看",
			content: hasHospitalInvoiceLink(invoice)
				? "医院返回的是票据网页地址，但尚未配置为小程序可用的电子票据业务域名。请医院提供可配置的 HTTPS 域名后再开通。"
				: "医院尚未返回可预览的票据影像或二维码，请稍后刷新电子发票记录。",
			showCancel: false,
			confirmText: "知道了",
		});
	},

	async issueInvoice(
		invoice: OutpatientElectronicInvoiceView,
		patient: Patient,
		expectedSessionGeneration: number,
	): Promise<void> {
		if (
			this.data.issuingViewKey ||
			!isCurrentSelectedPatient(patient.id) ||
			expectedSessionGeneration !== getSessionGeneration()
		) {
			return;
		}
		const guard = getPageLatestRequestGuard(
			this,
			"outpatient-electronic-invoice",
		);
		const token = guard.begin();
		this.setData({ issuingViewKey: invoice.viewKey, error: "" });
		try {
			const result = await issueOutpatientElectronicInvoice(
				invoice.recordId,
				patient.id,
			);
			assertSessionGeneration(
				expectedSessionGeneration,
				"Electronic invoice session changed while issuing",
			);
			if (!guard.isCurrent(token) || !isCurrentSelectedPatient(patient.id))
				return;
			this.setData({
				items: this.data.items.map((item) =>
					item.viewKey !== invoice.viewKey
						? item
						: {
								...item,
								issueState: "issued" as const,
								...(result.data.invoice.billBatchCode === undefined
									? {}
									: { billBatchCode: result.data.invoice.billBatchCode }),
								...(result.data.invoice.billNo === undefined
									? {}
									: { billNo: result.data.invoice.billNo }),
								...(result.data.invoice.createTime === undefined
									? {}
									: { invoiceTime: result.data.invoice.createTime }),
								...(result.data.invoice.pictureNetUrl === undefined
									? {}
									: { pictureNetUrl: result.data.invoice.pictureNetUrl }),
								...(result.data.invoice.pictureUrl === undefined
									? {}
									: { pictureUrl: result.data.invoice.pictureUrl }),
								...(result.data.invoice.billQrCode === undefined
									? {}
									: { billQrCode: result.data.invoice.billQrCode }),
								...(result.data.invoice.random === undefined
									? {}
									: { random: result.data.invoice.random }),
							},
				),
			});
			wx.showToast({ title: "电子发票已开具", icon: "success" });
		} catch (error) {
			if (guard.isCurrent(token)) {
				this.setData({
					error: errorMessageWithCode(
						error,
						patientContextErrorMessage(error, "电子发票开具失败，请稍后重试"),
					),
				});
			}
		} finally {
			if (guard.isCurrent(token)) this.setData({ issuingViewKey: "" });
		}
	},

	onPullDownRefresh(): void {
		void this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
